const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const DATASET_NAME = /^[A-Za-z0-9_]{1,128}$/;

function readName(env, key, pattern) {
  const raw = env[key];
  if (raw === undefined) return null;
  const value = raw.trim();
  if (!pattern.test(value)) throw new Error(`${key} is invalid.`);
  return value;
}

export function resourceOverrides(env, preview) {
  const previewDataset = readName(env, "PREVIEW_EVENTS_DATASET", DATASET_NAME);
  if (previewDataset && !preview) {
    throw new Error(
      "PREVIEW_EVENTS_DATASET applies only to the production deployment.",
    );
  }
  return {
    bucket: readName(env, "BACKUP_BUCKET", BUCKET_NAME),
    dataset: readName(env, "EVENTS_DATASET", DATASET_NAME),
    previewDataset,
  };
}

function rename(list, field, key, value) {
  if (!Array.isArray(list)) return false;
  let found = false;
  for (const binding of list) {
    if (binding?.binding !== key) continue;
    binding[field] = value;
    found = true;
  }
  return found;
}

export function applyResourceNames(config, overrides) {
  const next = structuredClone(config);
  if (overrides.bucket) {
    const renamed = rename(
      next.r2_buckets,
      "bucket_name",
      "BACKUPS",
      overrides.bucket,
    );
    const renamedPreview = rename(
      next.previews?.r2_buckets,
      "bucket_name",
      "BACKUPS",
      overrides.bucket,
    );
    if (!renamed && !renamedPreview) {
      throw new Error("Configuration has no BACKUPS binding.");
    }
  }
  if (overrides.dataset) {
    if (
      !rename(
        next.analytics_engine_datasets,
        "dataset",
        "EVENTS",
        overrides.dataset,
      ) ||
      next.vars?.BACKUP_DATASET === undefined
    ) {
      throw new Error("Configuration has no production dataset binding.");
    }
    next.vars.BACKUP_DATASET = overrides.dataset;
  }
  if (overrides.previewDataset) {
    if (
      !rename(
        next.previews?.analytics_engine_datasets,
        "dataset",
        "EVENTS",
        overrides.previewDataset,
      ) ||
      next.previews?.vars?.BACKUP_DATASET === undefined
    ) {
      throw new Error("Configuration has no preview dataset binding.");
    }
    next.previews.vars.BACKUP_DATASET = overrides.previewDataset;
  }
  return next;
}
