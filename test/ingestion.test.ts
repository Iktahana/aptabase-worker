import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "../src/analytics";
import { bodyLimit, parseApps, protectionLimit } from "../src/config";
import { normalize } from "../src/event";
import worker from "../src/index";
import swift from "./fixtures/swift.json";
import web from "./fixtures/web.json";

const APPS = JSON.stringify({
  "A-SH-WEB": { id: "web-app" },
  "A-SH-ROTATED": { id: "web-app" },
  "A-SH-IOS": { id: "ios-app", origins: ["https://example.com"] },
});
function setup() {
  const writeDataPoint = vi.fn<(point?: AnalyticsEngineDataPoint) => void>();
  const bindings: Env = { ...env, APPS, EVENTS: { writeDataPoint } };
  Reflect.set(bindings, "RATE_LIMIT_PER_SECOND", "0");
  Reflect.set(bindings, "MONTHLY_EVENT_LIMIT", "0");
  return { bindings, writeDataPoint };
}
function request(
  body: unknown = web,
  path = "/api/v0/event",
  headers: Record<string, string> = {},
) {
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "App-Key": "A-SH-WEB",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
afterEach(() => vi.restoreAllMocks());

describe("SDK ingestion", () => {
  it("runs through the deployed fetch entry point in workerd", async () => {
    const result = await SELF.fetch(
      request(web, "/api/v0/event", { "App-Key": "A-SH-TEST" }),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({});
  });
  it("freezes all columns, milliseconds, opaque sessions, and trusted geography", async () => {
    const { bindings, writeDataPoint } = setup();
    const req = new Request(request(), {
      cf: { country: "JP", region: "Tokyo" },
    });
    const result = await worker.fetch(req, bindings);
    expect(result.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      indexes: ["web-app"],
      blobs: [
        "1",
        "web-app",
        "button_clicked",
        web.sessionId,
        "en-US",
        "",
        "",
        "",
        "1.0.0",
        "",
        "aptabase-js@fixture",
        "",
        "",
        "JP",
        "Tokyo",
        JSON.stringify(web.props),
        "{}",
      ],
      doubles: [Date.parse(web.timestamp), 1],
    });
  });
  it("accepts Swift batches and absent props", async () => {
    const { bindings, writeDataPoint } = setup();
    expect(
      (
        await worker.fetch(
          request(swift, "/api/v0/events", { "App-Key": "A-SH-IOS" }),
          bindings,
        )
      ).status,
    ).toBe(200);
    const point = writeDataPoint.mock.calls[0]?.[0];
    expect(point?.indexes).toEqual(["ios-app"]);
    expect(point?.blobs?.slice(4, 11)).toEqual([
      "en_US",
      "iOS",
      "18.0",
      "iPhone",
      "1.0",
      "42",
      "aptabase-swift@fixture",
    ]);
    expect(point?.doubles?.[1]).toBe(0);
  });
  it("isolates apps and supports case insensitive rotation keys", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const key of ["A-SH-WEB", "a-sh-rotated", "A-SH-IOS"])
      await worker.fetch(request(web, undefined, { "App-Key": key }), bindings);
    expect(writeDataPoint.mock.calls.map(([p]) => p?.indexes)).toEqual([
      ["web-app"],
      ["web-app"],
      ["ios-app"],
    ]);
  });
  it("accepts defaults, null props, extra system fields and unknown top-level fields", async () => {
    const { bindings, writeDataPoint } = setup();
    const body = {
      timestamp: web.timestamp,
      sessionId: "opaque/not-a-number",
      eventName: "test",
      props: null,
      future: true,
      systemProps: {
        future: { value: 1 },
        engineName: "WebKit",
        engineVersion: "1",
      },
    };
    expect((await worker.fetch(request(body), bindings)).status).toBe(200);
    const point = writeDataPoint.mock.calls[0]?.[0];
    expect(point?.blobs?.slice(11)).toEqual([
      "WebKit",
      "1",
      "",
      "",
      "{}",
      '{"future":{"value":1}}',
    ]);
    expect(normalize({ ...body, systemProps: undefined })?.system.osName).toBe(
      "",
    );
  });
  it.each([undefined, "UNKNOWN"])(
    "drops rejected keys before reading the body: %s",
    async (key) => {
      const { bindings, writeDataPoint } = setup();
      const req = request();
      if (key) req.headers.set("App-Key", key);
      else req.headers.delete("App-Key");
      const result = await worker.fetch(req, bindings);
      expect(result.status).toBe(200);
      expect(await result.text()).toContain("Events are not being recorded.");
      expect(req.bodyUsed).toBe(false);
      expect(writeDataPoint).not.toHaveBeenCalled();
    },
  );
});

describe("validation and limits", () => {
  it.each([
    null,
    [],
    {},
    { ...web, timestamp: "2026-02-30T00:00:00Z" },
    { ...web, timestamp: "yesterday" },
    { ...web, timestamp: 123 },
    { ...web, eventName: " " },
    { ...web, sessionId: 123 },
    { ...web, props: { nested: {} } },
    { ...web, props: { null: null } },
    { ...web, systemProps: { isDebug: "true" } },
    { ...web, systemProps: { osName: 42 } },
  ])("rejects invalid single events", async (body) => {
    const { bindings, writeDataPoint } = setup();
    expect((await worker.fetch(request(body), bindings)).status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("rejects non-finite custom numbers", () =>
    expect(normalize({ ...web, props: { n: Infinity } })).toBeNull());
  it("skips invalid batch entries and accepts empty/all-invalid batches", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const body of [[web, null, { ...web, props: [] }], [], [null]])
      expect(
        (await worker.fetch(request(body, "/api/v0/events"), bindings)).status,
      ).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized batches and wrong endpoint shapes", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const body of [Array(26).fill(web), web, null])
      expect(
        (await worker.fetch(request(body, "/api/v0/events"), bindings)).status,
      ).toBe(400);
    expect(
      (
        await worker.fetch(
          request(Array(25).fill(web), "/api/v0/events"),
          bindings,
        )
      ).status,
    ).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(25);
  });
  it("rejects malformed JSON, invalid UTF-8 and unsupported content types", async () => {
    const { bindings } = setup();
    for (const body of ["{", new Uint8Array([255])]) {
      const req = new Request("https://worker.test/api/v0/event", {
        method: "POST",
        headers: { "App-Key": "A-SH-WEB", "Content-Type": "application/json" },
        body,
      });
      expect((await worker.fetch(req, bindings)).status).toBe(400);
    }
    expect(
      (
        await worker.fetch(
          request(web, undefined, { "Content-Type": "text/plain" }),
          bindings,
        )
      ).status,
    ).toBe(415);
  });
  it("caps streamed bytes without Content-Length and cancels oversized streams", async () => {
    const { bindings, writeDataPoint } = setup();
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(300000));
        controller.enqueue(new Uint8Array(300000));
      },
      cancel,
    });
    const req = new Request("https://worker.test/api/v0/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "App-Key": "A-SH-WEB",
        "Content-Length": "1",
      },
      body: stream,
    });
    expect((await worker.fetch(req, bindings)).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("counts Unicode blob bytes exactly at the 16 KiB boundary", () => {
    const event = normalize(web);
    if (!event) throw new Error("invalid_fixture");
    const base = encode(event, "app", {});
    const bytes = (base?.blobs ?? []).reduce<number>(
      (sum, blob) => sum + new TextEncoder().encode(String(blob)).length,
      0,
    );
    event.name += `${"a".repeat(16384 - bytes - 3)}猫`;
    expect(encode(event, "app", {})).not.toBeNull();
    event.name += "a";
    expect(encode(event, "app", {})).toBeNull();
  });
  it("drops oversized AE points independently in batches", async () => {
    const { bindings, writeDataPoint } = setup();
    const large = { ...web, props: { text: "猫".repeat(6000) } };
    expect((await worker.fetch(request(large), bindings)).status).toBe(400);
    expect(
      (await worker.fetch(request([large, web], "/api/v0/events"), bindings))
        .status,
    ).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });
});

describe("operations and privacy", () => {
  it("permits keyless preflights but enforces app origins on POST", async () => {
    const { bindings, writeDataPoint } = setup();
    const preflight = await worker.fetch(
      new Request("https://worker.test/api/v0/events", { method: "OPTIONS" }),
      bindings,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, App-Key",
    );
    const denied = await worker.fetch(
      request(web, undefined, {
        "App-Key": "A-SH-IOS",
        Origin: "https://evil.example",
      }),
      bindings,
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
    const allowed = await worker.fetch(
      request(web, undefined, {
        "App-Key": "A-SH-IOS",
        Origin: "https://example.com",
      }),
      bindings,
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://example.com",
    );
    expect(allowed.headers.has("Access-Control-Allow-Credentials")).toBe(false);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });
  it("health checks configuration and bindings without writing", async () => {
    const { bindings, writeDataPoint } = setup();
    expect(
      (await worker.fetch(new Request("https://worker.test/healthz"), bindings))
        .status,
    ).toBe(200);
    for (const APPS of [
      "{",
      "{}",
      '{"key":{"id":"猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫猫"}}',
      '{"key":{"id":"app","origins":["*"]}}',
    ])
      expect(
        (await worker.fetch(request(), { ...bindings, APPS })).status,
      ).toBe(503);
    expect(writeDataPoint).not.toHaveBeenCalled();
    expect(() =>
      parseApps('{"key":{"id":"app"},"KEY":{"id":"app"}}'),
    ).toThrow();
  });
  it("reports write and missing binding failures as 503", async () => {
    const { bindings, writeDataPoint } = setup();
    writeDataPoint.mockImplementation(() => {
      throw new Error("secret failure");
    });
    expect((await worker.fetch(request(), bindings)).status).toBe(503);
    const broken = { ...bindings };
    Reflect.deleteProperty(broken, "EVENTS");
    expect(
      (await worker.fetch(new Request("https://worker.test/healthz"), broken))
        .status,
    ).toBe(503);
  });
  it("explains app setup only when APPS is missing or invalid", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const APPS of [undefined, "", "{", "{}"]) {
      const broken = { ...bindings };
      if (APPS === undefined) Reflect.deleteProperty(broken, "APPS");
      else broken.APPS = APPS;
      for (const req of [
        request(),
        new Request("https://worker.test/healthz"),
      ]) {
        const response = await worker.fetch(req, broken);
        expect(response.status).toBe(503);
        const body = await response.json<{ error: string }>();
        expect(body.error).toContain("APPS variable");
        expect(body.error).toContain("README.md#2-define-your-apps");
      }
    }
    const broken = { ...bindings };
    Reflect.deleteProperty(broken, "EVENTS");
    const response = await worker.fetch(request(), broken);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("emits only aggregate counts and fixed reason codes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { bindings } = setup();
    await worker.fetch(
      request([web, null], "/api/v0/events", {
        "User-Agent": "sensitive-agent",
        "X-Forwarded-For": "192.0.2.1",
      }),
      bindings,
    );
    const output = JSON.stringify(log.mock.calls);
    for (const secret of [
      "A-SH-WEB",
      web.sessionId,
      "button_clicked",
      "sensitive-agent",
      "192.0.2.1",
    ])
      expect(output).not.toContain(secret);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      type: "ingestion",
      received: 2,
      submitted: 1,
      dropped: 1,
      reasons: { invalid_event: 1 },
    });
  });
  it("returns explicit route and method failures", async () => {
    const { bindings } = setup();
    expect(
      (await worker.fetch(new Request("https://worker.test/nope"), bindings))
        .status,
    ).toBe(404);
    expect(
      (
        await worker.fetch(
          new Request("https://worker.test/api/v0/event"),
          bindings,
        )
      ).status,
    ).toBe(405);
  });
});

describe("stream and operational boundaries", () => {
  it("accepts exactly 512 KiB, rejects one extra byte, and decodes split Unicode", async () => {
    const { bindings } = setup();
    const text = JSON.stringify({ ...web, eventName: "猫" });
    const encoded = new TextEncoder().encode(text);
    const padded = new Uint8Array(524288).fill(32);
    padded.set(encoded);
    for (const [bytes, status] of [
      [padded, 200],
      [new Uint8Array(524289).fill(32), 413],
    ] as const) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Split every byte of the JSON header, including the three-byte character.
          for (let i = 0; i < encoded.length; i++)
            controller.enqueue(bytes.subarray(i, i + 1));
          controller.enqueue(bytes.subarray(encoded.length));
          controller.close();
        },
      });
      const req = new Request("https://worker.test/api/v0/event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "App-Key": "A-SH-WEB",
        },
        body: stream,
      });
      expect((await worker.fetch(req, bindings)).status).toBe(status);
    }
  });
  it("keeps 413 when stream cancellation throws", async () => {
    const { bindings } = setup();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(524289));
      },
      cancel() {
        throw new Error("cancel_failed");
      },
    });
    const req = new Request("https://worker.test/api/v0/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Key": "A-SH-WEB" },
      body: stream,
    });
    expect((await worker.fetch(req, bindings)).status).toBe(413);
  });
  it("rejects invalid configured limits without reading the body", async () => {
    const { bindings } = setup();
    for (const limit of ["0", "-1", "524289", "NaN", "1.5"]) {
      const broken = { ...bindings };
      Reflect.set(broken, "MAX_BODY_BYTES", limit);
      const req = request();
      expect((await worker.fetch(req, broken)).status).toBe(503);
      expect(req.bodyUsed).toBe(false);
    }
  });
  it("reports partial writes and does not keep submitting after failure", async () => {
    const { bindings, writeDataPoint } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeDataPoint
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("private error");
      });
    expect(
      (await worker.fetch(request([web, web, web], "/api/v0/events"), bindings))
        .status,
    ).toBe(503);
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      received: 3,
      submitted: 1,
      reasons: { write_failed: 1 },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private error");
  });
  it("does not reflect rejected keys in logs or responses", async () => {
    const { bindings } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await worker.fetch(
      request(web, undefined, { "App-Key": "private-unknown-key" }),
      bindings,
    );
    expect(await response.text()).not.toContain("private-unknown-key");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-unknown-key");
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).reasons).toEqual({
      unknown_key: 1,
    });
  });
  it("handles deeply nested extra system properties without throwing", async () => {
    const { bindings, writeDataPoint } = setup();
    const raw = `{"timestamp":"${web.timestamp}","sessionId":"opaque","eventName":"deep","systemProps":{"future":${"[".repeat(15000)}0${"]".repeat(15000)}}}`;
    const req = new Request("https://worker.test/api/v0/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Key": "A-SH-WEB" },
      body: raw,
    });
    expect((await worker.fetch(req, bindings)).status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("enforces empty origin policies and allows native clients", async () => {
    const { bindings } = setup();
    bindings.APPS = '{"A-SH-WEB":{"id":"web-app","origins":[]}}';
    expect(
      (
        await worker.fetch(
          request(web, undefined, { Origin: "null" }),
          bindings,
        )
      ).status,
    ).toBe(403);
    expect((await worker.fetch(request(), bindings)).status).toBe(200);
  });
});

describe("abuse protection", () => {
  it("limits requests per trusted IP before reading bodies, including unknown keys", async () => {
    const { bindings, writeDataPoint } = setup();
    Reflect.set(bindings, "RATE_LIMIT_PER_SECOND", "1");
    const ip = `test-${crypto.randomUUID()}`;
    const first = request(web, undefined, { "CF-Connecting-IP": ip });
    expect((await worker.fetch(first, bindings)).status).toBe(200);
    const second = request(web, undefined, {
      "CF-Connecting-IP": ip,
      "App-Key": "unknown",
      "X-Forwarded-For": "different",
    });
    const limited = await worker.fetch(second, bindings);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("1");
    expect(second.bodyUsed).toBe(false);
    expect(
      (
        await worker.fetch(
          request(web, undefined, { "CF-Connecting-IP": `other-${ip}` }),
          bindings,
        )
      ).status,
    ).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
  });

  it("reserves a strict quota concurrently, sharing rotated keys but isolating apps", async () => {
    const { bindings, writeDataPoint } = setup();
    const id = crypto.randomUUID();
    bindings.APPS = JSON.stringify({
      "A-SH-WEB": { id },
      "A-SH-ROTATED": { id },
      "A-SH-IOS": { id: `${id}-other` },
    });
    Reflect.set(bindings, "MONTHLY_EVENT_LIMIT", "3");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        worker.fetch(
          request(web, undefined, {
            "App-Key": i % 2 ? "A-SH-WEB" : "A-SH-ROTATED",
          }),
          bindings,
        ),
      ),
    );
    expect(writeDataPoint).toHaveBeenCalledTimes(3);
    expect(
      (
        await Promise.all(results.map((r) => r.json<{ error?: string }>()))
      ).filter(
        (b) =>
          b.error === "Owner account is locked. Events are not being recorded.",
      ),
    ).toHaveLength(7);
    const exhausted = request();
    expect(await (await worker.fetch(exhausted, bindings)).json()).toEqual({
      error: "Owner account is locked. Events are not being recorded.",
    });
    expect(exhausted.bodyUsed).toBe(false);
    await worker.fetch(
      request(web, undefined, { "App-Key": "A-SH-IOS" }),
      bindings,
    );
    expect(writeDataPoint).toHaveBeenCalledTimes(4);
  });

  it("charges valid events only, rejects batches that do not fit, and counts failed submissions conservatively", async () => {
    const { bindings, writeDataPoint } = setup();
    bindings.APPS = JSON.stringify({ "A-SH-WEB": { id: crypto.randomUUID() } });
    Reflect.set(bindings, "MONTHLY_EVENT_LIMIT", "2");
    await worker.fetch(request([web, null], "/api/v0/events"), bindings);
    expect(
      await (
        await worker.fetch(request([web, web], "/api/v0/events"), bindings)
      ).json(),
    ).toEqual({
      error: "Owner account is locked. Events are not being recorded.",
    });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    writeDataPoint.mockImplementationOnce(() => {
      throw new Error("failed");
    });
    expect((await worker.fetch(request(), bindings)).status).toBe(503);
    expect(await (await worker.fetch(request(), bindings)).json()).toEqual({
      error: "Owner account is locked. Events are not being recorded.",
    });
  });

  it("blocks disabled apps and their alternate keys before reading the body", async () => {
    const { bindings, writeDataPoint } = setup();
    bindings.APPS =
      '{"A-SH-WEB":{"id":"same","disabled":true},"A-SH-ROTATED":{"id":"same"}}';
    for (const key of ["A-SH-WEB", "A-SH-ROTATED"]) {
      const req = request(web, undefined, { "App-Key": key });
      expect(await (await worker.fetch(req, bindings)).json()).toEqual({
        error: "Owner account is locked. Events are not being recorded.",
      });
      expect(req.bodyUsed).toBe(false);
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
    expect(() => parseApps('{"key":{"id":"app","disabled":"yes"}}')).toThrow();
  });

  it("fails closed on invalid limits, missing guards and storage failures", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const value of ["-1", "1.5", "NaN", "", "9007199254740992"]) {
      const broken = { ...bindings };
      Reflect.set(broken, "MONTHLY_EVENT_LIMIT", value);
      expect((await worker.fetch(request(), broken)).status).toBe(503);
    }
    Reflect.set(bindings, "MONTHLY_EVENT_LIMIT", "1");
    Reflect.deleteProperty(bindings, "INGESTION_GUARD");
    expect((await worker.fetch(request(), bindings)).status).toBe(503);
    Reflect.set(bindings, "INGESTION_GUARD", {
      getByName() {
        throw new Error("private storage failure");
      },
    });
    const failed = await worker.fetch(request(), bindings);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "service_unavailable" });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("resets counters across periods and cleans up idle IP storage", async () => {
    const stub = env.INGESTION_GUARD.getByName(crypto.randomUUID());
    expect(await stub.reserve(2, 2)).toBe(true);
    expect(await stub.reserve(1, 2)).toBe(false);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE counter SET period = '2000-01' WHERE id = 1",
      );
    });
    expect(await stub.reserve(1, 2)).toBe(true);
    const rate = env.INGESTION_GUARD.getByName(crypto.randomUUID());
    expect(await rate.request(1)).toBe(true);
    await runInDurableObject(rate, (_instance, state) => {
      state.storage.sql.exec("UPDATE counter SET period = '0' WHERE id = 1");
    });
    expect(await rate.request(1)).toBe(true);
    expect(await runDurableObjectAlarm(rate)).toBe(true);
    expect(await rate.request(1)).toBe(true);
  });
});

describe("dashboard configuration", () => {
  it("uses safe defaults when optional runtime variables are absent", async () => {
    expect(bodyLimit(undefined)).toBe(524288);
    expect(protectionLimit(undefined, 20)).toBe(20);
    expect(protectionLimit(undefined, 20000)).toBe(20000);
    const { bindings, writeDataPoint } = setup();
    for (const key of [
      "MAX_BODY_BYTES",
      "RATE_LIMIT_PER_SECOND",
      "MONTHLY_EVENT_LIMIT",
    ])
      Reflect.deleteProperty(bindings, key);
    const response = await worker.fetch(
      request(web, undefined, { "CF-Connecting-IP": crypto.randomUUID() }),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });
});

describe("HTTP response contract", () => {
  it.each([
    [web, "/api/v0/event", 200, "application/json", "{}"],
    [[web], "/api/v0/events", 200, "application/json", "{}"],
    [[], "/api/v0/events", 200, "application/json", "{}"],
    [[null], "/api/v0/events", 200, "application/json", "{}"],
    [{}, "/api/v0/event", 400, "text/plain; charset=utf-8", "Invalid event."],
    [
      Array(26).fill(web),
      "/api/v0/events",
      400,
      "text/plain; charset=utf-8",
      "Too many events (26) in a single request. Maximum is 25.",
    ],
    [
      [],
      "/api/v0/event",
      400,
      "application/problem+json",
      '{"type":"about:blank","title":"Invalid request body shape.","status":400}',
    ],
    [
      web,
      "/api/v0/events",
      400,
      "application/problem+json",
      '{"type":"about:blank","title":"Invalid request body shape.","status":400}',
    ],
  ])(
    "returns the wire contract for %s",
    async (body, path, status, type, text) => {
      const { bindings } = setup();
      const result = await worker.fetch(request(body, String(path)), bindings);
      expect(result.status).toBe(status);
      expect(result.headers.get("Content-Type")).toBe(type);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await result.text()).toBe(text);
    },
  );

  it("returns fixed problems for parser and media failures without echoing input", async () => {
    const { bindings, writeDataPoint } = setup();
    for (const [body, type, status, title] of [
      ['{"private-payload":', "application/json", 400, "Invalid JSON body."],
      [
        "private-payload",
        "text/plain",
        415,
        "Content-Type must be application/json.",
      ],
    ] as const) {
      const result = await worker.fetch(
        new Request("https://worker.test/api/v0/event", {
          method: "POST",
          headers: { "App-Key": "A-SH-WEB", "Content-Type": type },
          body,
        }),
        bindings,
      );
      expect(result.status).toBe(status);
      expect(result.headers.get("Content-Type")).toBe(
        "application/problem+json",
      );
      expect(await result.json()).toEqual({
        type: "about:blank",
        title,
        status,
      });
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects keys and locked apps before media checks or body reads, without leaks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { bindings, writeDataPoint } = setup();
    bindings.APPS = JSON.stringify({
      "A-SH-WEB": { id: crypto.randomUUID() },
      DISABLED: { id: "disabled", disabled: true },
    });
    Reflect.set(bindings, "MONTHLY_EVENT_LIMIT", "1");
    await worker.fetch(request(), bindings);
    for (const [key, error] of [
      ["", "Missing App-Key header. Events are not being recorded."],
      [
        "PRIVATE-UNKNOWN",
        "Application not found with given app key. Events are not being recorded.",
      ],
      ["DISABLED", "Owner account is locked. Events are not being recorded."],
      ["A-SH-WEB", "Owner account is locked. Events are not being recorded."],
    ]) {
      const req = request({ privatePayload: "secret" }, undefined, {
        "App-Key": key ?? "",
        "Content-Type": "text/plain",
      });
      const result = await worker.fetch(req, bindings);
      expect(result.status).toBe(200);
      expect(result.headers.get("Content-Type")).toBe("application/json");
      expect(await result.json()).toEqual({ error });
      expect(req.bodyUsed).toBe(false);
    }
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /PRIVATE-UNKNOWN|privatePayload|secret/,
    );
  });

  it("returns an empty rate rejection and retains the Retry-After extension", async () => {
    const { bindings } = setup();
    Reflect.set(bindings, "RATE_LIMIT_PER_SECOND", "1");
    const headers = { "CF-Connecting-IP": crypto.randomUUID() };
    await worker.fetch(request(web, undefined, headers), bindings);
    const result = await worker.fetch(
      request(web, undefined, headers),
      bindings,
    );
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("1");
    expect(result.headers.has("Content-Type")).toBe(false);
    expect(await result.text()).toBe("");
  });
});

describe("platform failure response contracts", () => {
  it("keeps fixed JSON errors and never leaks exception messages", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { bindings, writeDataPoint } = setup();
    const cases: [Env, Request, number, string][] = [];
    const small = { ...bindings };
    Reflect.set(small, "MAX_BODY_BYTES", "1");
    cases.push([small, request(), 413, "body_too_large"]);
    const invalid = { ...bindings, APPS: "{}" };
    cases.push([
      invalid,
      request(),
      503,
      "Configure a valid APPS variable in Cloudflare Settings > Runtime variables and secrets. See https://github.com/Iktahana/aptabase-worker/blob/main/README.md#2-define-your-apps",
    ]);
    const unavailable = { ...bindings };
    Reflect.deleteProperty(unavailable, "EVENTS");
    cases.push([unavailable, request(), 503, "service_unavailable"]);
    const storage = { ...bindings };
    Reflect.set(storage, "MONTHLY_EVENT_LIMIT", "1");
    Reflect.set(storage, "INGESTION_GUARD", {
      getByName() {
        throw new Error("private-exception");
      },
    });
    cases.push([storage, request(), 503, "service_unavailable"]);
    for (const [env, req, status, error] of cases) {
      const result = await worker.fetch(req, env);
      expect(result.status).toBe(status);
      expect(result.headers.get("Content-Type")).toBe("application/json");
      expect(await result.json()).toEqual({ error });
    }
    writeDataPoint.mockImplementation(() => {
      throw new Error("private-exception");
    });
    const result = await worker.fetch(request(), bindings);
    expect(result.status).toBe(503);
    expect(result.headers.get("Content-Type")).toBe("application/json");
    expect(await result.json()).toEqual({ error: "write_failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-exception");
  });
});

describe("crawler directives", () => {
  it("serves keyless robots directives without configuration or storage access", async () => {
    const { bindings, writeDataPoint } = setup();
    bindings.APPS = "invalid";
    const getByName = vi.fn(() => {
      throw new Error("must not access counters");
    });
    Reflect.set(bindings, "INGESTION_GUARD", { getByName });
    for (const method of ["GET", "HEAD"]) {
      const result = await worker.fetch(
        new Request("https://worker.test/robots.txt", { method }),
        bindings,
      );
      expect(result.status).toBe(200);
      expect(result.headers.get("Content-Type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(result.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await result.text()).toBe(
        method === "GET" ? "User-agent: *\nDisallow: /\n" : "",
      );
    }
    expect(getByName).not.toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
  it("adds noindex to success, errors and CORS preflights", async () => {
    const { bindings } = setup();
    for (const req of [
      request(),
      request([]),
      new Request("https://worker.test/unknown"),
      new Request("https://worker.test/api/v0/events", { method: "OPTIONS" }),
    ]) {
      const result = await worker.fetch(req, bindings);
      expect(result.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });
});
