import { useEffect, useState } from 'react';
import { MapApp } from './MapApp.js';
import { LoginForm } from './components/LoginForm.js';
import { checkAuth, logout, type AuthStatus } from './api/client.js';

/**
 * Gates the real app behind a login check. /api/me is only routed at all when the server has
 * AUTH_* env vars set (see routes/auth.ts) — a 404 there means auth is off entirely (local dev
 * default), not "not logged in", so the map renders immediately with no login step.
 */
export function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    checkAuth().then(setStatus);
  }, []);

  if (!status) {
    return <div className="auth-loading">Loading…</div>;
  }

  if (status.enabled && !status.authenticated) {
    return <LoginForm onSuccess={() => setStatus({ enabled: true, authenticated: true })} />;
  }

  return (
    <MapApp
      onLogout={
        status.enabled
          ? () => {
              void logout();
              setStatus({ enabled: true, authenticated: false });
            }
          : undefined
      }
    />
  );
}
