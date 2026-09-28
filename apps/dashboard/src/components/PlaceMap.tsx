'use client';

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';

import type { FactStatus, PlaceMemoryRow } from '@/lib/types';

const STATUS_COLOR: Record<FactStatus, string> = {
  verified: '#1e5a45', // ok / LastMeter primary
  unverified: '#8a6a00', // warn
  superseded: '#8a8a8a',
};

export function PlaceMap({ places, onSelect, selectedId }: { places: PlaceMemoryRow[]; onSelect: (placeId: string) => void; selectedId: string | null }) {
  const center: [number, number] = places.length ? [places[0].lat, places[0].lon] : [12.9352, 77.6146]; // Koramangala, Bengaluru fallback

  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom style={{ height: 420, width: '100%' }}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {places.map((p) => (
        <CircleMarker
          key={p.placeId}
          center={[p.lat, p.lon]}
          radius={p.placeId === selectedId ? 11 : 8}
          pathOptions={{
            color: p.placeId === selectedId ? '#1c1f1e' : STATUS_COLOR[p.bestStatus],
            weight: p.placeId === selectedId ? 3 : 2,
            fillColor: STATUS_COLOR[p.bestStatus],
            fillOpacity: 0.85,
          }}
          eventHandlers={{ click: () => onSelect(p.placeId) }}>
          <Tooltip>{`${p.placeId} · ${p.factCount} fact${p.factCount === 1 ? '' : 's'} · ${p.bestStatus}`}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

/** Fixes Leaflet's default marker icon URLs, in case any L.marker() ever gets used instead of CircleMarker. */
export function fixLeafletIcons() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}
