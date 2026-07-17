import { MapContainer, TileLayer } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { GeoMarker, PolarMarker } from './FireMarker.js';

const GREECE_CENTER: [number, number] = [38.5, 24.0];
const INITIAL_ZOOM = 7;

export function FireMap({ polar, geo }: { polar: Detection[]; geo: GeoDetection[] }): JSX.Element {
  return (
    <MapContainer center={GREECE_CENTER} zoom={INITIAL_ZOOM} className="fire-map">
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {polar.map((detection) => (
        <PolarMarker key={detection.id} detection={detection} />
      ))}
      {geo.map((detection) => (
        <GeoMarker key={detection.id} detection={detection} />
      ))}
    </MapContainer>
  );
}
