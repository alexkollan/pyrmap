/** How far back a satellite-tier marker's age gradient runs before it's fully grey. */
export const SATELLITE_MAX_AGE_HOURS = 24;
/** Same idea for reported-incident markers, compressed to a shorter window per user request. */
export const INCIDENT_MAX_AGE_HOURS = 12;

interface ColorStop {
  fraction: number; // 0-1 position along the gradient
  rgb: readonly [number, number, number];
}

// Same red (#dc2626) and orange (#f97316) already used elsewhere in this app for satellite
// markers — the gradient starts at the colors a fresh detection already had, it just now also
// fades with age instead of staying fixed.
const STOPS: readonly ColorStop[] = [
  { fraction: 0, rgb: [220, 38, 38] }, // red
  { fraction: 0.25, rgb: [249, 115, 22] }, // orange
  { fraction: 0.5, rgb: [34, 197, 94] }, // green
  { fraction: 0.75, rgb: [59, 130, 246] }, // blue
  { fraction: 1, rgb: [107, 114, 128] }, // grey
];

/**
 * Maps an age in hours to a color on the red -> orange -> green -> blue -> grey gradient, where
 * `maxAgeHours` is fully grey. Ages beyond that (or negative, e.g. minor clock skew) clamp to the
 * nearest endpoint rather than extrapolating.
 */
export function ageToColor(ageHours: number, maxAgeHours: number): string {
  const fraction = Math.min(1, Math.max(0, ageHours / maxAgeHours));

  let lower = STOPS[0]!;
  let upper = STOPS[STOPS.length - 1]!;
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!;
    const b = STOPS[i + 1]!;
    if (fraction >= a.fraction && fraction <= b.fraction) {
      lower = a;
      upper = b;
      break;
    }
  }

  const span = upper.fraction - lower.fraction;
  const t = span === 0 ? 0 : (fraction - lower.fraction) / span;
  const [r, g, b] = lower.rgb.map((channel, i) => Math.round(channel + (upper.rgb[i]! - channel) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Hours elapsed between an ISO timestamp and `now` (injectable so callers stay testable). */
export function hoursSince(iso: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60);
}
