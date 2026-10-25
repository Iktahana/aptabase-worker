import { describe, expect, it } from "vitest";
import {
  applyResourceNames,
  resourceOverrides,
  wranglerCommand,
} from "../scripts/bindings.mjs";
import { workersDevUrlFromOutput } from "../scripts/health.mjs";
import { parseJsonc } from "../scripts/jsonc.mjs";

function config() {
  return {
    r2_buckets: [{ binding: "BACKUPS", bucket_name: "aptabase-events" }],
    analytics_engine_datasets: [
      { binding: "EVENTS", dataset: "aptabase_events_v1" },
    ],
    vars: {
      BACKUP_DATASET: "aptabase_events_v1",
      BACKUP_PREFIX: "production",
    },
    previews: {
      r2_buckets: [{ binding: "BACKUPS", bucket_name: "aptabase-events" }],
      analytics_engine_datasets: [
        { binding: "EVENTS", dataset: "aptabase_events_v1_preview" },
      ],
      vars: {
        BACKUP_DATASET: "aptabase_events_v1_preview",
        BACKUP_PREFIX: "preview",
      },
    },
  };
}

describe("deployment resource names", () => {
  it("keeps the committed names when build variables are absent", () => {
    const source = config();
    const next = applyResourceNames(source, resourceOverrides({}, true));
    expect(next).toEqual(source);
    expect(source.vars.BACKUP_DATASET).toBe("aptabase_events_v1");
  });

  it("replaces the shared bucket and each dataset from its own variable", () => {
    const next = applyResourceNames(
      config(),
      resourceOverrides(
        {
          BACKUP_BUCKET: "my-events",
          EVENTS_DATASET: "events_prod",
          PREVIEW_EVENTS_DATASET: "events_preview",
        },
        true,
      ),
    );
    expect(next.r2_buckets[0]?.bucket_name).toBe("my-events");
    expect(next.previews.r2_buckets[0]?.bucket_name).toBe("my-events");
    expect(next.analytics_engine_datasets[0]?.dataset).toBe("events_prod");
    expect(next.vars.BACKUP_DATASET).toBe("events_prod");
    expect(next.vars.BACKUP_PREFIX).toBe("production");
    expect(next.previews.analytics_engine_datasets[0]?.dataset).toBe(
      "events_preview",
    );
    expect(next.previews.vars.BACKUP_DATASET).toBe("events_preview");
    expect(next.previews.vars.BACKUP_PREFIX).toBe("preview");
  });

  it("sends preview names to wrangler preview and accepts JSONC", () => {
    expect(wranglerCommand("preview")).toBe("preview");
    expect(wranglerCommand("production")).toBe("deploy");
    const source = parseJsonc(`{
      // Preview names are published by wrangler preview, not wrangler deploy.
      "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "aptabase-events", }],
      "analytics_engine_datasets": [
        { "binding": "EVENTS", "dataset": "aptabase_events_v1" }
      ],
      "vars": { "BACKUP_DATASET": "aptabase_events_v1" },
      "previews": {
        "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "aptabase-events" }],
        "analytics_engine_datasets": [
          { "binding": "EVENTS", "dataset": "aptabase_events_v1_preview" }
        ],
        "vars": { "BACKUP_DATASET": "aptabase_events_v1_preview" }
      }
    }`) as ReturnType<typeof config>;
    const next = applyResourceNames(
      source,
      resourceOverrides(
        {
          BACKUP_BUCKET: "my-events",
          PREVIEW_EVENTS_DATASET: "events_preview",
        },
        true,
      ),
    );
    expect(next.previews.r2_buckets[0]?.bucket_name).toBe("my-events");
    expect(next.previews.analytics_engine_datasets[0]?.dataset).toBe(
      "events_preview",
    );
    expect(next.previews.vars.BACKUP_DATASET).toBe("events_preview");
  });

  it("rejects invalid names and a preview dataset on staging", () => {
    expect(() =>
      resourceOverrides({ BACKUP_BUCKET: "Bad_Name" }, true),
    ).toThrow("BACKUP_BUCKET is invalid.");
    expect(() =>
      resourceOverrides({ EVENTS_DATASET: "events-prod" }, true),
    ).toThrow("EVENTS_DATASET is invalid.");
    expect(() =>
      resourceOverrides({ PREVIEW_EVENTS_DATASET: "events_preview" }, false),
    ).toThrow("PREVIEW_EVENTS_DATASET applies only to the production");
  });
});

describe("deployment health URL", () => {
  const output = [
    JSON.stringify({ type: "upload", targets: [] }),
    "not json",
    JSON.stringify({
      type: "deploy",
      targets: [
        "https://illusions-stats-endpoint.illusions-lab.workers.dev",
        "schedule: 0 2 * * *",
      ],
    }),
  ].join("\n");

  it("uses the workers.dev target from the last deploy record", () => {
    expect(workersDevUrlFromOutput(output)).toBe(
      "https://illusions-stats-endpoint.illusions-lab.workers.dev",
    );
  });

  it("ignores an earlier deploy when the last one has no workers.dev URL", () => {
    const replaced = `${output}\n${JSON.stringify({
      type: "deploy",
      targets: ["schedule: 0 2 * * *", "stats.example.com/* (custom domain)"],
    })}`;
    expect(() => workersDevUrlFromOutput(replaced)).toThrow(
      "Deployment did not report a workers.dev URL.",
    );
  });

  it("rejects addresses that are not the deployed workers.dev host", () => {
    expect(() =>
      workersDevUrlFromOutput(
        JSON.stringify({
          type: "deploy",
          targets: [
            "https://user:secret@name.example.workers.dev",
            "https://name.example.workers.dev/healthz",
            "https://name.example.workers.dev.evil.com",
            "http://name.example.workers.dev",
          ],
        }),
      ),
    ).toThrow("Deployment did not report a workers.dev URL.");
  });
});
