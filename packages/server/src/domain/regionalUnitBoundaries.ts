import type { AlertAreaPolygon } from '@pyrmap/shared';
import boundariesData from './data/greeceRegionalUnitBoundaries.json' with { type: 'json' };

const boundariesByNominative = boundariesData as Record<string, AlertAreaPolygon>;

/**
 * Looks up a regional unit's pre-bundled boundary polygon by its exact nominative name (as found
 * in domain/data/greeceRegionalUnits.json). Returns null for the ~2 of 54 units with no single
 * corresponding OSM administrative polygon (periphery-level groupings like Κυκλάδες/Αττική) —
 * callers must treat this as "no polygon available", not an error.
 */
export function findRegionalUnitBoundary(nominative: string): AlertAreaPolygon | null {
  return boundariesByNominative[nominative] ?? null;
}
