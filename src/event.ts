import { isRecord } from "./config";

export const SYSTEM_FIELDS = [
  "locale",
  "osName",
  "osVersion",
  "deviceModel",
  "appVersion",
  "appBuildNumber",
  "sdkVersion",
  "engineName",
  "engineVersion",
] as const;
export interface NormalizedEvent {
  timestamp: number;
  name: string;
  sessionId: string;
  system: Record<string, string>;
  debug: boolean;
  props: Record<string, string | number | boolean>;
  extraSystem: Record<string, unknown>;
}

// SDKs serialize UTC ISO timestamps; reject ambiguous local dates and invalid calendar dates.
function timestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    return null;
  const result = Date.parse(value);
  if (
    !Number.isFinite(result) ||
    new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    return null;
  return result;
}

export function normalize(value: unknown): NormalizedEvent | null {
  if (!isRecord(value)) return null;
  const time = timestamp(value.timestamp);
  if (
    time === null ||
    typeof value.eventName !== "string" ||
    !value.eventName.trim() ||
    typeof value.sessionId !== "string"
  )
    return null;
  const props = value.props ?? {};
  const system = value.systemProps ?? {};
  if (!isRecord(props) || !isRecord(system)) return null;
  if (
    !Object.values(props).every(
      (v) =>
        typeof v === "string" ||
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v)),
    )
  )
    return null;
  if (system.isDebug !== undefined && typeof system.isDebug !== "boolean")
    return null;
  const known: Record<string, string> = {};
  for (const field of SYSTEM_FIELDS) {
    const v = system[field];
    if (v !== undefined && typeof v !== "string") return null;
    known[field] = v ?? "";
  }
  const extra = Object.fromEntries(
    Object.entries(system).filter(
      ([key]) =>
        key !== "isDebug" && !SYSTEM_FIELDS.some((field) => field === key),
    ),
  );
  return {
    timestamp: time,
    name: value.eventName,
    sessionId: value.sessionId,
    system: known,
    debug: system.isDebug === true,
    props: props as NormalizedEvent["props"],
    extraSystem: extra,
  };
}
