export interface App {
  id: string;
  origins?: string[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseApps(raw: string): Map<string, App> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || Object.keys(value).length === 0)
    throw new Error("invalid_config");
  const apps = new Map<string, App>();
  for (const [key, app] of Object.entries(value)) {
    if (
      !key.trim() ||
      key !== key.trim() ||
      !isRecord(app) ||
      typeof app.id !== "string" ||
      !app.id.trim() ||
      new TextEncoder().encode(app.id).length > 96
    )
      throw new Error("invalid_config");
    const origins = app.origins;
    if (
      origins !== undefined &&
      (!Array.isArray(origins) ||
        !origins.every((origin) => {
          if (typeof origin !== "string") return false;
          try {
            const url = new URL(origin);
            return (
              ["https:", "http:"].includes(url.protocol) &&
              url.origin === origin
            );
          } catch {
            return false;
          }
        }))
    )
      throw new Error("invalid_config");
    const normalizedKey = key.toUpperCase();
    if (apps.has(normalizedKey)) throw new Error("invalid_config");
    apps.set(normalizedKey, {
      id: app.id,
      ...(origins === undefined ? {} : { origins: origins as string[] }),
    });
  }
  return apps;
}

export function bodyLimit(raw: string): number {
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 524288)
    throw new Error("invalid_config");
  return limit;
}
