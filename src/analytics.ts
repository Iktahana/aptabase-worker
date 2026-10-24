import type { NormalizedEvent } from "./event";
import { SYSTEM_FIELDS } from "./event";

function cfField(cf: object | null | undefined, key: string): unknown {
  if (!cf || !(key in cf)) return undefined;
  return (cf as Record<string, unknown>)[key];
}

export function trustedLocation(cf: object | null | undefined): {
  country: string;
  region: string;
  regionCode: string;
} {
  const countryValue = cfField(cf, "country");
  const regionValue = cfField(cf, "region");
  const codeValue = cfField(cf, "regionCode");
  const country =
    typeof countryValue === "string" ? countryValue.trim().toUpperCase() : "";
  const region = typeof regionValue === "string" ? regionValue.trim() : "";
  const regionCode =
    typeof codeValue === "string" ? codeValue.trim().toUpperCase() : "";
  return {
    country: country === "T1" || /^[A-Z]{2}$/.test(country) ? country : "",
    region:
      region && new TextEncoder().encode(region).byteLength <= 64 ? region : "",
    regionCode: /^[A-Z0-9]{1,3}$/.test(regionCode) ? regionCode : "",
  };
}

export function encode(
  event: NormalizedEvent,
  appId: string,
  location: { country?: string; region?: string; regionCode?: string },
): AnalyticsEngineDataPoint | null {
  let properties: string;
  let extra: string;
  try {
    properties = JSON.stringify(event.props);
    extra = JSON.stringify(event.extraSystem);
  } catch {
    return null;
  }
  const blobs = [
    "1",
    appId,
    event.name,
    event.sessionId,
    ...SYSTEM_FIELDS.map((key) => event.system[key] ?? ""),
    location.country ?? "",
    location.region ?? "",
    properties,
    extra,
    location.regionCode ?? "",
  ];
  const bytes = blobs.reduce(
    (sum, value) => sum + new TextEncoder().encode(value).byteLength,
    0,
  );
  if (bytes > 16 * 1024) return null;
  return {
    indexes: [appId],
    blobs,
    doubles: [event.timestamp, Number(event.debug)],
  };
}

export function write(
  dataset: AnalyticsEngineDataset,
  points: AnalyticsEngineDataPoint[],
): number {
  let submitted = 0;
  for (const point of points) {
    try {
      dataset.writeDataPoint(point);
      submitted++;
    } catch {
      return submitted;
    }
  }
  return submitted;
}
