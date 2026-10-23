import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseApps } from "../src/config.ts";

if (process.env.GITHUB_ACTIONS !== "true")
  throw new Error("Publishing and rollback must run in GitHub Actions.");
for (const name of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WORKER_URL",
]) {
  if (!process.env[name]) throw new Error(`Missing release setting: ${name}.`);
}
const healthUrl = new URL(process.env.WORKER_URL);
if (healthUrl.protocol !== "https:" || healthUrl.username || healthUrl.password)
  throw new Error("WORKER_URL must be a public HTTPS base URL.");
const target = process.env.RELEASE_ENV;
if (!["staging", "production"].includes(target))
  throw new Error("Invalid release environment.");
const action = process.env.RELEASE_ACTION;
let args;
let directory;
try {
  if (action === "deploy") {
    try {
      parseApps(process.env.APPS);
    } catch {
      throw new Error("APPS configuration is invalid.");
    }
    directory = await mkdtemp(join(tmpdir(), "aptabase-release-"));
    const secrets = join(directory, "secrets.json");
    await writeFile(secrets, JSON.stringify({ APPS: process.env.APPS }), {
      mode: 0o600,
    });
    args = ["deploy", "--env", target, "--secrets-file", secrets];
  } else if (action === "rollback") {
    const version = process.env.ROLLBACK_VERSION;
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        version ?? "",
      )
    )
      throw new Error("A valid rollback version UUID is required.");
    args = [
      "rollback",
      version,
      "--env",
      target,
      "--yes",
      "--message",
      "GitHub Actions manual rollback",
    ];
  } else throw new Error("Invalid release action.");
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    { stdio: "inherit", env: process.env },
  );
  if (result.error || result.status !== 0)
    throw new Error("Release command failed.");
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
