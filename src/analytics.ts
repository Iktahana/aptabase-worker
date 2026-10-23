import type { NormalizedEvent } from "./event";
import { SYSTEM_FIELDS } from "./event";

export function encode(
  event: NormalizedEvent,
  appId: string,
  location: { country?: string; region?: string },
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
