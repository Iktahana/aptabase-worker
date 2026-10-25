import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  applyResourceNames,
  resourceOverrides,
  wranglerCommand,
} from "./bindings.mjs";
import { parseJsonc } from "./jsonc.mjs";

if (process.env.WORKERS_CI !== "1") {
  throw new Error("Publishing must run through Cloudflare Workers Builds.");
}

const target = process.argv[2];
let command;
try {
  command = wranglerCommand(target);
} catch (error) {
  throw new Error(error instanceof Error ? error.message : "Invalid target.");
}

const sourceName =
  target === "staging" ? "wrangler.staging.jsonc" : "wrangler.jsonc";
const config = applyResourceNames(
  parseJsonc(readFileSync(sourceName, "utf8")),
  resourceOverrides(process.env, target !== "staging"),
);
const generated = ".wrangler-deploy.jsonc";
writeFileSync(generated, `${JSON.stringify(config, null, 2)}\n`);
const bucket =
  target === "preview"
    ? config.previews?.r2_buckets?.[0]?.bucket_name
    : config.r2_buckets?.[0]?.bucket_name;
const dataset =
  target === "preview"
    ? config.previews?.vars?.BACKUP_DATASET
    : config.vars?.BACKUP_DATASET;
console.log(`Binding R2 bucket ${bucket} and dataset ${dataset}.`);
let result;
try {
  result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", command, "--config", generated],
    { stdio: "inherit", env: process.env },
  );
} finally {
  rmSync(generated, { force: true });
}
if (result?.error || result?.status !== 0) {
  throw new Error("Worker deployment failed.");
}

if (target !== "preview") await import("./health.mjs");
