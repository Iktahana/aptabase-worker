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

function ipv4(text: string): string | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets.join(".");
}

function hextets(text: string): number[] | null {
  if (text.includes("%")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const values: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part?.includes(".")) {
        if (i !== parts.length - 1) return null;
        const address = ipv4(part);
        if (!address) return null;
        const [a, b, c, d] = address.split(".").map(Number);
        values.push(((a ?? 0) << 8) | (b ?? 0), ((c ?? 0) << 8) | (d ?? 0));
        continue;
      }
      if (!part || !/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      values.push(Number.parseInt(part, 16));
    }
    return values;
  };
  if (halves.length === 1) {
    const full = parseSide(text);
    return full?.length === 8 ? full : null;
  }
  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves[1] ?? "");
  if (!left || !right || left.length + right.length >= 8) return null;
  return [
    ...left,
    ...Array<number>(8 - left.length - right.length).fill(0),
    ...right,
  ];
}

function compress(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let index = 0;
  while (index < groups.length) {
    if (groups[index] !== 0) {
      index++;
      continue;
    }
    const start = index;
    while (index < groups.length && groups[index] === 0) index++;
    const length = index - start;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

function clientAddress(header: string | null): string | null {
  const text = header?.trim() ?? "";
  if (!text) return null;
  const address = ipv4(text);
  if (address) return address;
  const groups = hextets(text);
  if (!groups) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return `${(groups[6] ?? 0) >> 8}.${(groups[6] ?? 0) & 255}.${(groups[7] ?? 0) >> 8}.${(groups[7] ?? 0) & 255}`;
  return `${compress([...groups.slice(0, 4), 0, 0, 0, 0])}/64`;
}

export async function ipGuardName(request: Request): Promise<string | null> {
  // Cloudflare supplies this header. Never trust X-Forwarded-For for counters.
  const address = clientAddress(request.headers.get("CF-Connecting-IP"));
  if (!address) return null;
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${day}:${address}`),
  );
  return `ip:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
