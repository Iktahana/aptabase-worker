export interface ResourceOverrides {
  bucket: string | null;
  dataset: string | null;
  previewDataset: string | null;
}

export function resourceOverrides(
  env: Record<string, string | undefined>,
  preview: boolean,
): ResourceOverrides;

export function applyResourceNames<T>(
  config: T,
  overrides: ResourceOverrides,
): T;
