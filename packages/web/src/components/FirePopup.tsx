import { Popup } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';

export type MarkerKind = 'polar' | 'geo-confirmed' | 'geo-unconfirmed';

function tierLabel(detection: Detection, kind: MarkerKind): string {
  if (kind === 'geo-unconfirmed') return 'Unconfirmed satellite hotspot (Meteosat)';
  if (kind === 'geo-confirmed') return 'Confirmed detection (Meteosat, corroborated)';
  return `Confirmed detection (${detection.instrument ?? detection.source})`;
}

export function FirePopup({ detection, kind }: { detection: Detection | GeoDetection; kind: MarkerKind }): JSX.Element {
  return (
    <Popup>
      <div className="fire-popup">
        <strong>{tierLabel(detection, kind)}</strong>
        <div>
          {formatAthensTime(detection.acquiredAt)} ({formatRelativeTime(detection.acquiredAt)})
        </div>
        {detection.frp !== null && <div>FRP: {detection.frp} MW</div>}
        <div>Source: {detection.source}</div>
        {detection.confidence !== null && <div>Confidence: {detection.confidence}</div>}
        {kind === 'geo-unconfirmed' && (
          <div className="fire-popup-caveat">
            <div>Low position accuracy (~3km). Awaiting confirmation from a high-resolution satellite.</div>
            <div lang="el">
              Χαμηλή ακρίβεια θέσης (~3 χλμ). Αναμένεται επιβεβαίωση από δορυφόρο υψηλής ανάλυσης.
            </div>
          </div>
        )}
      </div>
    </Popup>
  );
}
