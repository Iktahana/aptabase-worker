import { encode, trustedLocation, write } from "./analytics";
import { runBackup } from "./backup";
import { bodyLimit, parseApps, protectionLimit } from "./config";
import { normalize } from "./event";
import { ipGuardName } from "./guard";
import { ingestionResponse } from "./response";

export { IngestionGuard } from "./guard";

class BodyError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.body) throw new BodyError(400, "invalid_json");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        try {
          await reader.cancel();
        } catch {
          /* Preserve the size error if cancellation fails. */
        }
        throw new BodyError(413, "body_too_large");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(0, size),
      ),
    );
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, "invalid_json");
  } finally {
    reader.releaseLock();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const ingestion = path === "/api/v0/event" || path === "/api/v0/events";
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    });
    if (path === "/robots.txt" && ["GET", "HEAD"].includes(request.method)) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      return new Response(
        request.method === "HEAD" ? null : "User-agent: *\nDisallow: /\n",
        { status: 200, headers },
      );
    }
    let received = 0;
    let submitted = 0;
    let dropped = 0;
    const reasons: Record<string, number> = {};
    function response(status: number, code?: string): Response {
      if (code) reasons[code] = (reasons[code] ?? 0) + 1;
      if (ingestion && request.method === "POST")
        console.log(
          JSON.stringify({
            type: "ingestion",
            received,
            submitted,
            dropped,
            reasons,
          }),
        );
      return ingestionResponse(status, code, headers, received);
    }
    if (ingestion && request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, App-Key");
      headers.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers });
    }
    if (!ingestion && path !== "/healthz") return response(404, "not_found");
    if (request.method !== (ingestion ? "POST" : "GET")) {
      headers.set("Allow", ingestion ? "POST, OPTIONS" : "GET");
      return response(405, "method_not_allowed");
    }
    let apps: ReturnType<typeof parseApps>;
    let limit: number;
    let rateLimit: number;
    let monthlyLimit: number;
    try {
      apps = parseApps(env.APPS);
    } catch {
      return response(503, "apps_not_configured");
    }
    try {
      limit = bodyLimit(env.MAX_BODY_BYTES);
      rateLimit = protectionLimit(env.RATE_LIMIT_PER_SECOND, 20);
      monthlyLimit = protectionLimit(env.MONTHLY_EVENT_LIMIT, 20000);
      if (
        (rateLimit || monthlyLimit) &&
        typeof env.INGESTION_GUARD?.getByName !== "function"
      )
        throw new Error("binding_unavailable");
      if (typeof env.EVENTS?.writeDataPoint !== "function")
        throw new Error("binding_unavailable");
    } catch {
      return response(503, "service_unavailable");
    }
    if (!ingestion) return response(200);
    try {
      if (rateLimit) {
        const name = await ipGuardName(request);
        if (
          !name ||
          !(await env.INGESTION_GUARD.getByName(name).request(rateLimit))
        ) {
          headers.set("Retry-After", "1");
          return response(429, "rate_limited");
        }
      }
    } catch {
      return response(503, "service_unavailable");
    }
    const key = request.headers.get("App-Key")?.trim().toUpperCase();
    if (!key) return response(200, "missing_key");
    const app = apps.get(key);
    if (!app) return response(200, "unknown_key");
    if (
      app.disabled ||
      [...apps.values()].some((entry) => entry.id === app.id && entry.disabled)
    )
      return response(200, "app_disabled");
    const origin = request.headers.get("Origin");
    if (app.origins) {
      headers.delete("Access-Control-Allow-Origin");
      headers.set("Vary", "Origin");
      if (origin && !app.origins.includes(origin))
        return response(403, "origin_denied");
      if (origin) headers.set("Access-Control-Allow-Origin", origin);
    }
    let quota: DurableObjectStub<import("./guard").IngestionGuard> | undefined;
    try {
      quota = monthlyLimit
        ? env.INGESTION_GUARD.getByName(`app:${app.id}`)
        : undefined;
      if (quota && !(await quota.reserve(0, monthlyLimit)))
        return response(200, "monthly_quota_exceeded");
    } catch {
      return response(503, "service_unavailable");
    }
    if (
      request.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return response(415, "unsupported_media_type");
    let body: unknown;
    try {
      body = await readJson(request, limit);
    } catch (error) {
      return response(
        error instanceof BodyError ? error.status : 400,
        error instanceof BodyError ? error.code : "invalid_json",
      );
    }
    const batch = path === "/api/v0/events";
    if (
      batch
        ? !Array.isArray(body)
        : !body || typeof body !== "object" || Array.isArray(body)
    )
      return response(400, "invalid_body");
    if (batch && Array.isArray(body) && body.length > 25) {
      received = body.length;
      return response(400, "batch_too_large");
    }
    const values: unknown[] = batch && Array.isArray(body) ? body : [body];
    received = values.length;
    const points: AnalyticsEngineDataPoint[] = [];
    for (const value of values) {
      const event = normalize(value);
      const point = event
        ? encode(event, app.id, trustedLocation(request.cf))
        : null;
      if (point) points.push(point);
      else {
        dropped++;
        const code = event ? "event_too_large" : "invalid_event";
        reasons[code] = (reasons[code] ?? 0) + 1;
      }
    }
    if (!batch && dropped) return response(400, "invalid_single_event");
    try {
      if (
        points.length &&
        quota &&
        !(await quota.reserve(points.length, monthlyLimit))
      )
        return response(200, "monthly_quota_exceeded");
    } catch {
      return response(503, "service_unavailable");
    }
    submitted = write(env.EVENTS, points);
    if (submitted !== points.length) return response(503, "write_failed");
    return response(200);
  },
  async scheduled(controller, env): Promise<void> {
    try {
      await runBackup(env, controller.scheduledTime);
    } catch (error) {
      console.log(
        JSON.stringify({
          type: "backup",
          day: "",
          status: "failed",
          reason: "write_failed",
          rows: 0,
        }),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
