import { useState, type ReactNode } from 'react';
import { loadStoredConsent, setAnalyticsConsent, storeConsent } from '../lib/analytics.js';

type UiMode = 'closed' | 'editing';

/**
 * Wraps the whole app: children render ONLY once analytics consent is explicitly granted — a hard
 * cookie-wall, by explicit user request (not the usual "banner floats over a usable site"
 * pattern). Re-establishing a prior visit's consent happens in the lazy useState initializer (not
 * a useEffect) so it runs synchronously during this component's own render, before any descendant
 * even begins rendering — useEffect callbacks fire bottom-up (children before parents) on first
 * mount, which could otherwise let a child's own effect (e.g. FireMap's focus_target_opened) fire
 * before consent was re-granted. Mount this at the top of App.tsx, wrapping everything else.
 */
export function ConsentGate({ measurementId, children }: { measurementId?: string; children: ReactNode }): JSX.Element {
  const [consent, setConsent] = useState<boolean | null>(() => {
    const stored = loadStoredConsent();
    setAnalyticsConsent(stored?.analytics === true, measurementId);
    return stored?.analytics ?? null;
  });
  const [uiMode, setUiMode] = useState<UiMode>('closed');
  const [toggleOn, setToggleOn] = useState(true);

  function accept(): void {
    storeConsent({ analytics: true, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(true, measurementId);
    setConsent(true);
    setUiMode('closed');
  }

  function save(): void {
    storeConsent({ analytics: toggleOn, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(toggleOn, measurementId);
    setConsent(toggleOn);
    setUiMode('closed');
  }

  function openEditor(): void {
    setToggleOn(loadStoredConsent()?.analytics ?? true);
    setUiMode('editing');
  }

  if (consent === true) {
    return (
      <>
        {children}
        <button type="button" className="cookie-settings-link" onClick={openEditor}>
          Cookie settings
        </button>
        {uiMode === 'editing' && (
          <div className="consent-modal-overlay">
            <div className="consent-modal">
              <label className="consent-toggle-row">
                <input type="checkbox" checked={toggleOn} onChange={(event) => setToggleOn(event.target.checked)} />
                Analytics cookies
              </label>
              <div className="consent-modal-actions">
                <button type="button" onClick={save}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // consent is null (never decided) or false (explicitly declined) — block everything.
  return (
    <div className="consent-modal-overlay">
      <div className="consent-modal">
        {uiMode === 'editing' ? (
          <>
            <label className="consent-toggle-row">
              <input type="checkbox" checked={toggleOn} onChange={(event) => setToggleOn(event.target.checked)} />
              Analytics cookies
            </label>
            <div className="consent-modal-actions">
              <button type="button" onClick={save}>
                Save
              </button>
            </div>
          </>
        ) : consent === false ? (
          <>
            <span>This site requires cookies to work. Please enable analytics cookies to continue.</span>
            <div className="consent-modal-actions">
              <button type="button" onClick={accept}>
                Enable
              </button>
              <button type="button" onClick={openEditor}>
                Cookie settings
              </button>
            </div>
          </>
        ) : (
          <>
            <span>This site uses cookies for analytics.</span>
            <div className="consent-modal-actions">
              <button type="button" onClick={accept}>
                Accept
              </button>
              <button type="button" onClick={openEditor}>
                Edit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
