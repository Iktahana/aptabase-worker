import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { applyResourceNames, resourceOverrides } from "./bindings.mjs";

if (process.env.WORKERS_CI !== "1") {
  throw new Error("Publishing must run through Cloudflare Workers Builds.");
}

const target = process.argv[2];
if (!["staging", "production"].includes(target ?? "")) {
  throw new Error("Choose the staging or production deployment target.");
}

const sourceName =
  target === "staging" ? "wrangler.staging.jsonc" : "wrangler.jsonc";
const config = applyResourceNames(
  JSON.parse(readFileSync(sourceName, "utf8")),
  resourceOverrides(process.env, target === "production"),
);
const generated = ".wrangler-deploy.jsonc";
writeFileSync(generated, `${JSON.stringify(config, null, 2)}\n`);
const bucket = config.r2_buckets?.[0]?.bucket_name;
const dataset = config.vars?.BACKUP_DATASET;
const preview = config.previews?.vars?.BACKUP_DATASET;
console.log(
  preview
    ? `Binding R2 bucket ${bucket}, dataset ${dataset}, and preview dataset ${preview}.`
    : `Binding R2 bucket ${bucket} and dataset ${dataset}.`,
);
let result;
try {
  result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", generated],
    { stdio: "inherit", env: process.env },
  );
} finally {
  rmSync(generated, { force: true });
}
if (result?.error || result?.status !== 0) {
  throw new Error("Worker deployment failed.");
}

await import("./health.mjs");
