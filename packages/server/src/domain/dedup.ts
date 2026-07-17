export interface DedupInput {
  source: string;
  latitude: number;
  longitude: number;
  acquiredAt: string;
}

/** dedup_key = source|lat.toFixed(4)|lon.toFixed(4)|acquiredAt, dev-plan §6.1. Guards against overlapping dayRange=1 polls. */
export function computeDedupKey(input: DedupInput): string {
  return `${input.source}|${input.latitude.toFixed(4)}|${input.longitude.toFixed(4)}|${input.acquiredAt}`;
}
