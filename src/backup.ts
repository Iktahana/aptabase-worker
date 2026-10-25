export const ROW_LIMIT = 20_000;
const STALE_MS = 30 * 60 * 1000;
const COLUMNS = [
  "timestamp",
  "index1",
  "blob1",
  "blob2",
  "blob3",
  "blob4",
  "blob5",
  "blob6",
  "blob7",
  "blob8",
  "blob9",
  "blob10",
  "blob11",
  "blob12",
  "blob13",
  "blob14",
  "blob15",
  "blob16",
  "blob17",
  "blob18",
  "double1",
  "double2",
  "_sample_interval",
];

interface AnalyticsReader {
  query(request: {
    query: string;
    params?: Record<string, string>;
  }): Promise<{ data: Record<string, unknown>[]; rows: number }>;
}

export interface BackupEnv {
  BACKUPS?: R2Bucket;
  ANALYTICS?: AnalyticsReader;
  BACKUP_DATASET?: string;
  BACKUP_PREFIX?: string;
}

type Reason =
  | ""
  | "query_failed"
  | "truncated"
  | "too_many_rows"
  | "write_failed";
type Outcome = "complete" | "failed" | "busy" | "skipped";

export function targetDay(scheduledTime: number): string {
  const instant = new Date(scheduledTime);
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate() - 1,
    ),
  )
    .toISOString()
    .slice(0, 10);
}

export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
}

export function dayBounds(day: string): { start: string; end: string } {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86_400_000).toISOString(),
  };
}

export function backupQuery(dataset: string): string {
  return `SELECT ${COLUMNS.join(", ")} FROM events.analyticsEngine."${dataset}" WHERE timestamp >= $start AND timestamp < $end ORDER BY timestamp`;
}

function datasetName(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_]+$/.test(value) ? value : null;
}

function environmentPrefix(value: string | undefined): string | null {
  return value === "production" || value === "staging" || value === "preview"
    ? value
    : null;
}

function keys(
  environment: string,
  day: string,
): {
  events: string;
  complete: string;
  failed: string;
  lock: string;
} {
  const prefix = `${environment}/events/day=${day}`;
  return {
    events: `${prefix}/events.jsonl`,
    complete: `${prefix}/complete.json`,
    failed: `${prefix}/failed.json`,
    lock: `${prefix}/lock.json`,
  };
}

function log(day: string, status: string, reason: string, rows: number): void {
  console.log(JSON.stringify({ type: "backup", day, status, reason, rows }));
}

function lines(data: Record<string, unknown>[]): string {
  return data
    .map((row) => {
      const record: Record<string, unknown> = {};
      for (const column of COLUMNS) record[column] = row[column] ?? null;
      return JSON.stringify(record);
    })
    .join("\n");
}

async function marker(
  bucket: R2Bucket,
  key: string,
): Promise<{ startedAt?: string } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return object.json<{ startedAt?: string }>();
}

async function fail(
  bucket: R2Bucket,
  environment: string,
  day: string,
  reason: Reason,
  now: number,
): Promise<void> {
  const dayKeys = keys(environment, day);
  await bucket.delete(dayKeys.events);
  await bucket.put(
    dayKeys.failed,
    JSON.stringify({ reason, finishedAt: new Date(now).toISOString() }),
  );
  await bucket.delete(dayKeys.lock);
  log(day, "failed", reason, 0);
}

async function backupOne(
  bucket: R2Bucket,
  analytics: AnalyticsReader,
  dataset: string,
  environment: string,
  day: string,
  now: number,
  rowLimit: number,
): Promise<Outcome> {
  const dayKeys = keys(environment, day);
  if (await bucket.head(dayKeys.complete)) {
    log(day, "complete", "", 0);
    return "skipped";
  }
  const lock = await marker(bucket, dayKeys.lock);
  if (lock?.startedAt && now - Date.parse(lock.startedAt) < STALE_MS) {
    log(day, "running", "", 0);
    return "busy";
  }
  await bucket.put(
    dayKeys.lock,
    JSON.stringify({ startedAt: new Date(now).toISOString() }),
  );
  let read: { data: Record<string, unknown>[]; rows: number };
  try {
    read = await analytics.query({
      query: backupQuery(dataset),
      params: dayBounds(day),
    });
  } catch {
    await fail(bucket, environment, day, "query_failed", now);
    return "failed";
  }
  const reason: Reason | null =
    read.rows > read.data.length
      ? "truncated"
      : read.data.length > rowLimit
        ? "too_many_rows"
        : null;
  if (reason) {
    await fail(bucket, environment, day, reason, now);
    return "failed";
  }
  try {
    const body = lines(read.data);
    await bucket.put(dayKeys.events, body === "" ? "" : `${body}\n`, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
    await bucket.put(
      dayKeys.complete,
      JSON.stringify({
        rows: read.data.length,
        finishedAt: new Date(now).toISOString(),
      }),
    );
    await bucket.delete(dayKeys.failed);
    await bucket.delete(dayKeys.lock);
    log(day, "complete", "", read.data.length);
    return "complete";
  } catch {
    await fail(bucket, environment, day, "write_failed", now);
    return "failed";
  }
}

export async function runBackup(
  env: BackupEnv,
  scheduledTime: number,
  now = Date.now(),
  rowLimit = ROW_LIMIT,
): Promise<void> {
  const dataset = datasetName(env.BACKUP_DATASET);
  const environment = environmentPrefix(env.BACKUP_PREFIX);
  if (
    !dataset ||
    !environment ||
    !env.BACKUPS ||
    typeof env.ANALYTICS?.query !== "function"
  ) {
    log("", "failed", "not_configured", 0);
    return;
  }
  const bucket = env.BACKUPS;
  const analytics = env.ANALYTICS;
  const day = targetDay(scheduledTime);
  const prior = previousDay(day);
  const priorKeys = keys(environment, prior);
  const priorComplete = await bucket.head(priorKeys.complete);
  const priorFailed = await bucket.head(priorKeys.failed);
  const priorLock = await marker(bucket, priorKeys.lock);
  const interrupted = Boolean(
    priorLock?.startedAt && now - Date.parse(priorLock.startedAt) >= STALE_MS,
  );
  if (!priorComplete && (priorFailed || interrupted)) {
    try {
      await backupOne(
        bucket,
        analytics,
        dataset,
        environment,
        prior,
        now,
        rowLimit,
      );
    } catch {
      log(prior, "failed", "write_failed", 0);
    }
  }
  await backupOne(bucket, analytics, dataset, environment, day, now, rowLimit);
}
