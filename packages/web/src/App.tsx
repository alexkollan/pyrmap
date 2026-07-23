import { useEffect, useState } from 'react';
import { MapApp } from './MapApp.js';
import { LoginForm } from './components/LoginForm.js';
import { ConsentBanner } from './components/ConsentBanner.js';
import { checkAuth, logout, type AuthStatus } from './api/client.js';

/**
 * The map is always public: viewing never requires a login. `isAdmin` gates Re-scan/Edit-pins/
 * push-subscription controls (see MapApp/StatusBar) — true when auth isn't configured at all
 * (local-dev open-access convention, unchanged) or when this session is actually authenticated.
 * /api/me is only routed at all when the server has AUTH_* env vars set (see routes/auth.ts) — a
 * 404 there means auth is off entirely, not "not logged in".
 */
export function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

  useEffect(() => {
    checkAuth().then(setStatus);
  }, []);

  if (!status) {
    return <div className="auth-loading">Loading…</div>;
  }

  const isAdmin = !status.enabled || status.authenticated;

  return (
    <>
      <ConsentBanner measurementId={measurementId} />
      <MapApp
        isAdmin={isAdmin}
        onRequestLogin={status.enabled && !isAdmin ? () => setShowLogin(true) : undefined}
        onLogout={
          status.enabled && isAdmin
            ? () => {
                void logout();
                setStatus({ enabled: true, authenticated: false });
              }
            : undefined
        }
      />
      {showLogin && (
        <LoginForm
          onSuccess={() => {
            setStatus({ enabled: true, authenticated: true });
            setShowLogin(false);
          }}
          onCancel={() => setShowLogin(false)}
        />
      )}
    </>
  );
}
