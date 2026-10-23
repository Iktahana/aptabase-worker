import { DurableObject } from "cloudflare:workers";

export class IngestionGuard extends DurableObject<Env> {
  private consume(period: string, count: number, limit: number): boolean {
    // Alarms delete storage, so a still-live instance must recreate its table.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), period TEXT NOT NULL, used INTEGER NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ period: string; used: number }>(
        "SELECT period, used FROM counter WHERE id = 1",
      )
      .toArray()[0];
    const used = row?.period === period ? row.used : 0;
    if (used >= limit || count > limit - used) return false;
    if (count > 0)
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO counter (id, period, used) VALUES (1, ?, ?)",
        period,
        used + count,
      );
    return true;
  }

  async request(limit: number): Promise<boolean> {
    const allowed = this.consume(
      String(Math.floor(Date.now() / 1000)),
      1,
      limit,
    );
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return allowed;
  }

  reserve(count: number, limit: number): boolean {
    return this.consume(new Date().toISOString().slice(0, 7), count, limit);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export async function ipGuardName(request: Request): Promise<string> {
  // Cloudflare supplies this header. Never trust X-Forwarded-For for counters.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${day}:${ip}`),
  );
  return `ip:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
