'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { Map as MapLibre, Marker, NavigationControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

/**
 * The map (spec 0011-20b AC-4, AC-6): MapLibre GL on MapTiler's streets style, loaded only when a page opens it (see
 * `lib/maps/lazy.tsx`). Editable: a tap moves the pin and the pin drags; each settle calls `onPin` once. Read only:
 * one fixed pin. The style, tiles and glyphs come from api.maptiler.com (the CSP's connect-src); a failure to load
 * calls `onFail`, and the address fields never depend on it.
 */

export type Point = { lat: number; lng: number };

const STYLE = 'https://api.maptiler.com/maps/streets-v4/style.json';

export default function AddressMap({
  apiKey,
  center,
  zoom,
  pin,
  editable,
  label,
  onPin,
  onFail,
}: {
  apiKey: string;
  center: Point;
  zoom: number;
  pin: Point | null;
  editable: boolean;
  label: string;
  onPin?: (point: Point) => void;
  onFail?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const handlers = useRef({ onPin, onFail });
  useEffect(() => {
    handlers.current = { onPin, onFail };
  });

  // One map per mount; the centre and the pin move below without a new map.
  useEffect(() => {
    if (!box.current) return;
    let instance: MapLibre;
    try {
      instance = new MapLibre({
        container: box.current,
        style: `${STYLE}?key=${encodeURIComponent(apiKey)}`,
        center: [center.lng, center.lat],
        zoom,
        attributionControl: { compact: true },
        cooperativeGestures: !editable,
      });
    } catch {
      handlers.current.onFail?.();
      return;
    }
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.on('error', () => handlers.current.onFail?.());
    if (editable) {
      instance.on('click', (event) =>
        handlers.current.onPin?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
      );
    }
    return () => {
      marker.current = null;
      map.current = null;
      instance.remove();
    };
    // The map is made once; later centres and pins are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.easeTo({ center: [center.lng, center.lat], zoom });
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      // The semantic accent token, read from the page (no colour lives here).
      const color = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
      const next = new Marker({ draggable: editable, ...(color ? { color } : {}) });
      if (editable) {
        next.on('dragend', () => {
          const at = next.getLngLat();
          handlers.current.onPin?.({ lat: at.lat, lng: at.lng });
        });
      }
      marker.current = next.setLngLat([pin.lng, pin.lat]).addTo(instance);
    } else {
      marker.current.setLngLat([pin.lng, pin.lat]);
    }
  }, [pin, editable]);

  return <div ref={box} role="region" aria-label={label} className="size-full min-h-64 rounded-block" />;
}
