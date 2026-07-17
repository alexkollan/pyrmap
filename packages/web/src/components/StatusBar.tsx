import { formatLocalTime } from '../lib/formatting.js';
import type { Theme } from '../lib/theme.js';

const HOURS_OPTIONS = [6, 12, 24, 48, 72] as const;

export interface StatusBarProps {
  hours: number;
  onHoursChange: (hours: number) => void;
  lastSuccessAt: Date | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

/** Top bar: app name, last-updated time, time-window select, theme toggle, auto-refresh indicator, stale-data chip. */
export function StatusBar({
  hours,
  onHoursChange,
  lastSuccessAt,
  loading,
  error,
  onRefresh,
  theme,
  onToggleTheme,
}: StatusBarProps): JSX.Element {
  return (
    <div className="status-bar">
      <span className="app-name">PyrMap</span>
      <span className="last-updated">
        {lastSuccessAt ? `Last updated ${formatLocalTime(lastSuccessAt)}` : 'Loading…'}
      </span>
      <select
        className="hours-select"
        value={hours}
        onChange={(event) => onHoursChange(Number(event.target.value))}
        aria-label="Time window"
      >
        {HOURS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}h
          </option>
        ))}
      </select>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      <button type="button" onClick={onToggleTheme} aria-label="Toggle dark/light map">
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <span
        className={loading ? 'auto-refresh-indicator active' : 'auto-refresh-indicator'}
        title="Auto-refreshes every 5 minutes"
      />
      {error && (
        <span className="stale-chip">
          Data stale{lastSuccessAt ? ` — last update ${formatLocalTime(lastSuccessAt)}` : ''}
        </span>
      )}
    </div>
  );
}
