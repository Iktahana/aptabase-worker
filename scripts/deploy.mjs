import { spawnSync } from "node:child_process";

if (process.env.WORKERS_CI !== "1") {
  throw new Error("Publishing must run through Cloudflare Workers Builds.");
}

const target = process.argv[2];
if (!["staging", "production"].includes(target ?? "")) {
  throw new Error("Choose the staging or production deployment target.");
}

const result = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "deploy", "--env", target],
  { stdio: "inherit", env: process.env },
);
if (result.error || result.status !== 0) {
  throw new Error("Worker deployment failed.");
}

await import("./health.mjs");
