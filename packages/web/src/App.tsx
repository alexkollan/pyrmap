import { useState } from 'react';
import { FireMap } from './components/FireMap.js';
import { StatusBar } from './components/StatusBar.js';
import { Legend } from './components/Legend.js';
import { useFires } from './hooks/useFires.js';

const DEFAULT_HOURS = 24;

export function App(): JSX.Element {
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);
  const { data, loading, error, lastSuccessAt, refresh } = useFires(hours);

  return (
    <div className="app">
      <StatusBar
        hours={hours}
        onHoursChange={setHours}
        lastSuccessAt={lastSuccessAt}
        loading={loading}
        error={error}
        onRefresh={refresh}
      />
      <FireMap polar={data?.polar ?? []} geo={data?.geo ?? []} />
      <Legend />
    </div>
  );
}
