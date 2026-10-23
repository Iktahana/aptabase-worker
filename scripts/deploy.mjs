import { spawnSync } from "node:child_process";

if (process.env.WORKERS_CI !== "1") {
  throw new Error("Publishing must run through Cloudflare Workers Builds.");
}

const target = process.argv[2];
if (!["staging", "production"].includes(target ?? "")) {
  throw new Error("Choose the staging or production deployment target.");
}

const args = ["node_modules/wrangler/bin/wrangler.js", "deploy"];
if (target === "staging") args.push("--config", "wrangler.staging.jsonc");
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
if (result.error || result.status !== 0) {
  throw new Error("Worker deployment failed.");
}

await import("./health.mjs");
