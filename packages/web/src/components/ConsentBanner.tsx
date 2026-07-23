import { useState } from 'react';
import { loadStoredConsent, setAnalyticsConsent, storeConsent } from '../lib/analytics.js';

type BannerState = 'hidden' | 'prompt' | 'editing';

/**
 * Mount this BEFORE <MapApp/> in App.tsx's JSX. Re-establishing a prior visit's consent happens in
 * this component's lazy useState initializer (not a useEffect) so it runs synchronously during
 * this component's own render, before any descendant of MapApp even begins rendering — useEffect
 * callbacks fire bottom-up (children before parents) on first mount, which could otherwise let a
 * child's own effect (e.g. FireMap's focus_target_opened) fire before consent was re-granted.
 */
export function ConsentBanner({ measurementId }: { measurementId?: string }): JSX.Element {
  const [state, setState] = useState<BannerState>(() => {
    const stored = loadStoredConsent();
    setAnalyticsConsent(stored?.analytics ?? false, measurementId);
    return stored ? 'hidden' : 'prompt';
  });
  const [toggleOn, setToggleOn] = useState(true);

  function accept(): void {
    storeConsent({ analytics: true, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(true, measurementId);
    setState('hidden');
  }

  function save(): void {
    storeConsent({ analytics: toggleOn, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(toggleOn, measurementId);
    setState('hidden');
  }

  function reopen(): void {
    setToggleOn(loadStoredConsent()?.analytics ?? true);
    setState('editing');
  }

  if (state === 'hidden') {
    return (
      <button type="button" className="cookie-settings-link" onClick={reopen}>
        Cookie settings
      </button>
    );
  }

  return (
    <div className="consent-banner">
      {state === 'prompt' && (
        <>
          <span>This site uses cookies for analytics.</span>
          <div className="consent-banner-actions">
            <button type="button" onClick={accept}>
              Accept
            </button>
            <button type="button" onClick={() => setState('editing')}>
              Edit
            </button>
          </div>
        </>
      )}
      {state === 'editing' && (
        <>
          <label className="consent-toggle-row">
            <input type="checkbox" checked={toggleOn} onChange={(event) => setToggleOn(event.target.checked)} />
            Analytics cookies
          </label>
          <div className="consent-banner-actions">
            <button type="button" onClick={save}>
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}
