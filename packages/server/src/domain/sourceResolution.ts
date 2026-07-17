import type { Tier } from '@pyrmap/shared';

export interface SourceResolution {
  effective: Record<string, Tier>;
  warnings: string[];
}

/** Resolves configured FIRMS source ids against what the API currently reports available, dev-plan §3.4. */
export function resolveSources(
  configured: Record<string, Tier>,
  available: readonly string[],
): SourceResolution {
  const availableSet = new Set(available);
  const effective: Record<string, Tier> = {};
  const warnings: string[] = [];

  for (const [sourceId, tier] of Object.entries(configured)) {
    if (availableSet.has(sourceId)) {
      effective[sourceId] = tier;
      continue;
    }

    if (sourceId === 'MSG_NRT') {
      const fallback = available.find((id) => /msg|seviri/i.test(id));
      if (fallback) {
        effective[fallback] = tier;
        warnings.push(`MSG_NRT not available; using fallback source ${fallback}`);
        continue;
      }
    }

    warnings.push(`configured source ${sourceId} not available; skipping`);
  }

  return { effective, warnings };
}
