import { useState } from 'react';
import { FireMap } from './components/FireMap.js';
import { StatusBar } from './components/StatusBar.js';
import { Legend } from './components/Legend.js';
import { useFires } from './hooks/useFires.js';
import { loadStoredTheme, storeTheme, type Theme } from './lib/theme.js';

const DEFAULT_HOURS = 24;

export function App(): JSX.Element {
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);
  const [theme, setTheme] = useState<Theme>(loadStoredTheme);
  const { data, loading, error, lastSuccessAt, refresh } = useFires(hours);

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
  }

  return (
    <div className="app" data-theme={theme}>
      <StatusBar
        hours={hours}
        onHoursChange={setHours}
        lastSuccessAt={lastSuccessAt}
        loading={loading}
        error={error}
        onRefresh={refresh}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <FireMap polar={data?.polar ?? []} geo={data?.geo ?? []} theme={theme} />
      <Legend />
    </div>
  );
}
