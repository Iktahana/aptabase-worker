export interface App {
  id: string;
  origins?: string[];
  disabled?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseApps(raw: string | undefined): Map<string, App> {
  if (typeof raw !== "string") throw new Error("invalid_config");
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || Object.keys(value).length === 0)
    throw new Error("invalid_config");
  const apps = new Map<string, App>();
  for (const [key, app] of Object.entries(value)) {
    if (
      !key.trim() ||
      key !== key.trim() ||
      !isRecord(app) ||
      (app.disabled !== undefined && typeof app.disabled !== "boolean") ||
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
      disabled: app.disabled === true,
      ...(origins === undefined ? {} : { origins: origins as string[] }),
    });
  }
  return apps;
}

export function protectionLimit(
  raw: string | undefined,
  fallback: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!raw?.trim() && raw !== undefined) throw new Error("invalid_config");
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid_config");
  return value;
}

export function bodyLimit(raw: string | undefined): number {
  const limit = raw === undefined ? 524288 : Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 524288)
    throw new Error("invalid_config");
  return limit;
}
