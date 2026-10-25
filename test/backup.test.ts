import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backupQuery, previousDay, runBackup, targetDay } from "../src/backup";
import worker from "../src/index";

const AT = Date.parse("2026-10-25T02:00:00.000Z");
const DAY = "2026-10-24";
const statistics = { elapsed_ms: 1, rows_read: 1, bytes_read: 1 };

function row(index: number): Record<string, unknown> {
  return {
    timestamp: "2026-10-24T01:00:00.000Z",
    index1: "web-app",
    blob1: "1",
    blob2: "web-app",
    blob3: "button_clicked",
    blob4: `session-${index}`,
    blob14: "JP",
    blob18: "13",
    double1: 1,
    double2: index === 2 ? 1 : 0,
    _sample_interval: 1,
  };
}

function result(data: Record<string, unknown>[], rows = data.length) {
  return { data, rows, statistics };
}

function analytics(mode: "ok" | "truncate" | "fail" | "many" = "ok") {
  const calls: { query: string; params?: Record<string, string> }[] = [];
  return {
    calls,
    async query(request: { query: string; params?: Record<string, string> }) {
      calls.push(request);
      if (mode === "fail") throw new Error("unavailable");
      if (mode === "truncate") return result([row(0)], 2);
      if (mode === "many") return result([row(0), row(1), row(2)]);
      return result([row(0)]);
    },
  };
}

function bindings(source = analytics()) {
  return {
    ...env,
    BACKUP_DATASET: "aptabase_events_v1",
    BACKUP_PREFIX: "production",
    ANALYTICS: source,
  };
}

async function reset(): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.BACKUPS.list({ cursor });
    if (listed.objects.length)
      await env.BACKUPS.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function text(key: string): Promise<string | null> {
  const object = await env.BACKUPS.get(key);
  return object ? object.text() : null;
}

describe("daily backup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects the previous UTC day and reads every stored column", () => {
    expect(targetDay(AT)).toBe(DAY);
    expect(previousDay(DAY)).toBe("2026-10-23");
    const query = backupQuery("aptabase_events_v1");
    expect(query).toContain('events.analyticsEngine."aptabase_events_v1"');
    expect(query).toContain("blob18");
    expect(query).toContain("_sample_interval");
    expect(query).not.toContain("accountTag");
    expect(query).not.toContain("double2 = 0");
  });

  it("writes the closed day once and leaves it unchanged on the next run", async () => {
    await reset();
    const source = analytics();
    await runBackup(bindings(source), AT, AT, 100);
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toBe(
      `${JSON.stringify({
        timestamp: "2026-10-24T01:00:00.000Z",
        index1: "web-app",
        blob1: "1",
        blob2: "web-app",
        blob3: "button_clicked",
        blob4: "session-0",
        blob5: null,
        blob6: null,
        blob7: null,
        blob8: null,
        blob9: null,
        blob10: null,
        blob11: null,
        blob12: null,
        blob13: null,
        blob14: "JP",
        blob15: null,
        blob16: null,
        blob17: null,
        blob18: "13",
        double1: 1,
        double2: 0,
        _sample_interval: 1,
      })}\n`,
    );
    expect(source.calls[0]?.params).toEqual({
      start: "2026-10-24T00:00:00.000Z",
      end: "2026-10-25T00:00:00.000Z",
    });
    await runBackup(bindings(analytics("truncate")), AT, AT, 100);
    expect(source.calls).toHaveLength(1);
    expect(
      await env.BACKUPS.head(`production/events/day=${DAY}/complete.json`),
    ).not.toBe(null);
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toContain(
      '"blob18":"13"',
    );
  });

  it("does not store a partial object when the read is truncated or too large", async () => {
    await reset();
    await runBackup(bindings(analytics("truncate")), AT, AT, 100);
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toBeNull();
    expect(await text(`production/events/day=${DAY}/failed.json`)).toContain(
      "truncated",
    );
    await env.BACKUPS.delete(`production/events/day=${DAY}/failed.json`);
    await runBackup(bindings(analytics("many")), AT, AT, 2);
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toBeNull();
    expect(await text(`production/events/day=${DAY}/failed.json`)).toContain(
      "too_many_rows",
    );
  });

  it("retries only the adjacent failed day", async () => {
    await reset();
    await env.BACKUPS.put(
      "production/events/day=2026-10-23/failed.json",
      JSON.stringify({ reason: "query_failed" }),
    );
    await env.BACKUPS.put(
      "production/events/day=2026-10-22/failed.json",
      JSON.stringify({ reason: "query_failed" }),
    );
    const source = analytics();
    await runBackup(bindings(source), AT, AT, 100);
    expect(
      await env.BACKUPS.head("production/events/day=2026-10-23/complete.json"),
    ).not.toBe(null);
    expect(
      await env.BACKUPS.head("production/events/day=2026-10-22/complete.json"),
    ).toBe(null);
    expect(
      await env.BACKUPS.head(`production/events/day=${DAY}/complete.json`),
    ).not.toBe(null);
    expect(source.calls).toHaveLength(2);
  });

  it("backs up the closed day when the adjacent retry fails", async () => {
    await reset();
    await env.BACKUPS.put(
      "production/events/day=2026-10-23/failed.json",
      JSON.stringify({ reason: "query_failed" }),
    );
    const source = analytics();
    source.query = async (request) => {
      source.calls.push(request);
      if (source.calls.length === 1) throw new Error("unavailable");
      return result([row(0)]);
    };
    await runBackup(bindings(source), AT, AT, 100);
    expect(source.calls).toHaveLength(2);
    expect(await text("production/events/day=2026-10-23/events.jsonl")).toBe(
      null,
    );
    expect(
      await text("production/events/day=2026-10-23/failed.json"),
    ).toContain("query_failed");
    expect(
      await env.BACKUPS.head(`production/events/day=${DAY}/complete.json`),
    ).not.toBe(null);
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toContain(
      '"blob18":"13"',
    );
  });

  it("records both days when the retry and the closed day fail", async () => {
    await reset();
    await env.BACKUPS.put(
      "production/events/day=2026-10-23/failed.json",
      JSON.stringify({ reason: "query_failed" }),
    );
    const source = analytics("fail");
    await runBackup(bindings(source), AT, AT, 100);
    expect(source.calls).toHaveLength(2);
    expect(await text("production/events/day=2026-10-23/events.jsonl")).toBe(
      null,
    );
    expect(
      await text("production/events/day=2026-10-23/failed.json"),
    ).toContain("query_failed");
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toBeNull();
    expect(await text(`production/events/day=${DAY}/failed.json`)).toContain(
      "query_failed",
    );
  });

  it("leaves a fresh lock untouched and records a query failure", async () => {
    await reset();
    await env.BACKUPS.put(
      `production/events/day=${DAY}/lock.json`,
      JSON.stringify({ startedAt: new Date(AT).toISOString() }),
    );
    const source = analytics();
    await runBackup(bindings(source), AT, AT, 100);
    expect(source.calls).toHaveLength(0);
    await reset();
    await runBackup(bindings(analytics("fail")), AT, AT, 100);
    expect(await text(`production/events/day=${DAY}/failed.json`)).toContain(
      "query_failed",
    );
    expect(await text(`production/events/day=${DAY}/events.jsonl`)).toBeNull();
  });

  it("does not let a missing dataset affect ingestion", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await worker.scheduled(
      { scheduledTime: AT, cron: "0 2 * * *", noRetry() {} },
      { ...env, BACKUP_DATASET: "bad dataset" } as unknown as Env,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"not_configured"'),
    );
    const response = await worker.fetch(
      new Request("https://worker.test/healthz"),
      { ...env, APPS: JSON.stringify({ "A-SH-WEB": { id: "web-app" } }) },
    );
    expect(response.status).toBe(200);
  });
});
