const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "42 min ago" / "3 h ago" / "just now". Timezone conversion happens only in frontend display code. */
export function formatRelativeTime(acquiredAt: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(acquiredAt).getTime();
  const minutes = Math.round(diffMs / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diffMs / HOUR_MS);
  return `${hours} h ago`;
}

/** Acquired time rendered in local Greek time (Europe/Athens), e.g. "15/07 09:35". */
export function formatAthensTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** HH:MM in the viewer's local time, for the StatusBar "Last updated" display. */
export function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}
