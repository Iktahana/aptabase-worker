import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyResourceNames,
  resourceOverrides,
  wranglerCommand,
} from "./bindings.mjs";
import { checkHealth, workersDevUrlFromOutput } from "./health.mjs";
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
const outputDir = mkdtempSync(join(tmpdir(), "aptabase-deploy-"));
const outputPath = join(outputDir, "wrangler.jsonl");
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
    {
      stdio: "inherit",
      env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputPath },
    },
  );
} finally {
  rmSync(generated, { force: true });
}
if (result?.error || result?.status !== 0) {
  rmSync(outputDir, { recursive: true, force: true });
  throw new Error("Worker deployment failed.");
}

if (target === "preview") {
  rmSync(outputDir, { recursive: true, force: true });
} else {
  let reportedUrl;
  try {
    reportedUrl = workersDevUrlFromOutput(readFileSync(outputPath, "utf8"));
  } catch {
    throw new Error("Deployment did not report a workers.dev URL.");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
  await checkHealth(reportedUrl);
}
