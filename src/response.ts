// Public wire messages are independent of the aggregate log reason codes.
const errors: Record<string, string> = {
  missing_key: "Missing App-Key header. Events are not being recorded.",
  unknown_key:
    "Application not found with given app key. Events are not being recorded.",
  app_disabled: "Owner account is locked. Events are not being recorded.",
  monthly_quota_exceeded:
    "Owner account is locked. Events are not being recorded.",
  apps_not_configured:
    "Configure a valid APPS variable in Cloudflare Settings > Runtime variables and secrets. See https://github.com/Iktahana/aptabase-worker/blob/main/README.md#2-define-your-apps",
};
const problems: Record<string, string> = {
  invalid_json: "Invalid JSON body.",
  invalid_body: "Invalid request body shape.",
  unsupported_media_type: "Content-Type must be application/json.",
};

export function ingestionResponse(
  status: number,
  code: string | undefined,
  headers: Headers,
  received: number,
): Response {
  if (code === "rate_limited") return new Response(null, { status, headers });
  if (code === "invalid_single_event" || code === "batch_too_large") {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response(
      code === "batch_too_large"
        ? `Too many events (${received}) in a single request. Maximum is 25.`
        : "Invalid event.",
      { status, headers },
    );
  }
  if (code && problems[code]) {
    headers.set("Content-Type", "application/problem+json");
    return Response.json(
      { type: "about:blank", title: problems[code], status },
      { status, headers },
    );
  }
  return Response.json(code ? { error: errors[code] ?? code } : {}, {
    status,
    headers,
  });
}
