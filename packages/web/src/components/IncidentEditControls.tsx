import { useState } from 'react';
import type { IncidentReport, LocationSearchResult } from '@pyrmap/shared';
import { deleteIncident, hideIncident, searchLocations, updateIncidentLocation } from '../api/client.js';
import { trackEvent } from '../lib/analytics.js';

/**
 * Correction controls shown inside an incident pin's popup while the map is in edit mode: manual
 * lat/lon entry, place-name search-and-pick, and hide/delete-forever — see
 * docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md for the semantics of hide
 * vs. delete. All three ways of choosing new coordinates (this component's inputs, dragging the
 * marker itself, or picking a search result) call the same PATCH endpoint.
 */
export function IncidentEditControls({ incident }: { incident: IncidentReport }): JSX.Element {
  const [lat, setLat] = useState(String(incident.latitude));
  const [lon, setLon] = useState(String(incident.longitude));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError('Action failed — nothing changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleSaveCoordinates(): void {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      setError('Latitude/longitude must be numbers.');
      return;
    }
    trackEvent('incident_pin_manual_save');
    void run(() => updateIncidentLocation(incident.id, parsedLat, parsedLon).then(() => undefined));
  }

  function handleSearch(): void {
    if (!query.trim()) return;
    void run(() =>
      searchLocations(query).then((found) => {
        trackEvent('incident_location_search', { resultCount: found.length });
        setResults(found);
      }),
    );
  }

  function handlePickResult(result: LocationSearchResult): void {
    trackEvent('incident_pin_search_pick');
    void run(() => updateIncidentLocation(incident.id, result.latitude, result.longitude).then(() => undefined));
  }

  function handleHide(): void {
    if (!confirm('Hide this pin? It will be hidden forever, even if the same post is scanned again — this cannot be undone.')) return;
    trackEvent('incident_pin_hidden');
    void run(() => hideIncident(incident.id));
  }

  function handleDelete(): void {
    if (!confirm('Delete this pin forever? Unlike Hide, a future re-scan may re-add it if it fetches this same post again.')) return;
    trackEvent('incident_pin_deleted');
    void run(() => deleteIncident(incident.id));
  }

  return (
    <div className="incident-edit-controls">
      <div className="incident-edit-row">
        <input
          type="number"
          step="any"
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          aria-label="Latitude"
          disabled={busy}
        />
        <input
          type="number"
          step="any"
          value={lon}
          onChange={(event) => setLon(event.target.value)}
          aria-label="Longitude"
          disabled={busy}
        />
        <button type="button" onClick={handleSaveCoordinates} disabled={busy}>
          Save
        </button>
      </div>
      <div className="incident-edit-row">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a place name…"
          aria-label="Search place name"
          disabled={busy}
        />
        <button type="button" onClick={handleSearch} disabled={busy}>
          Search
        </button>
      </div>
      {results.length > 0 && (
        <ul className="incident-search-results">
          {results.map((result, index) => (
            <li key={index}>
              <button type="button" onClick={() => handlePickResult(result)} disabled={busy}>
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="incident-edit-row">
        <button type="button" onClick={handleHide} disabled={busy}>
          Hide
        </button>
        <button type="button" onClick={handleDelete} disabled={busy}>
          Delete forever
        </button>
      </div>
      {error && <div className="incident-edit-error">{error}</div>}
    </div>
  );
}
