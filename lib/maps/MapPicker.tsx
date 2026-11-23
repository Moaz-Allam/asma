'use client';

import { LocateFixedIcon, SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pinInTurkey, roundPin } from '@/lib/address/parts';

import AddressMap, { type Point } from './AddressMap';
import { forwardGeocode, reverseGeocode, type Candidate, type GeocodedParts } from './geocode';

/**
 * The map panel's body (spec 0011-20b AC-4, X-21): a search box (300 ms after the last key, at most five places in
 * Turkey), Use my location, and the map with a draggable pin. When the pin settles, one reverse geocode names the parts
 * and `onSettle` hands both to the form, which fills only what came back. Every failure is a short note; the fields
 * outside never depend on this panel. Loaded only when opened (`lib/maps/lazy.tsx`).
 */

const TURKEY: Point = { lat: 39.0, lng: 35.2 };
const SEARCH_WAIT_MS = 300;

export default function MapPicker({
  apiKey,
  place,
  pin,
  onSettle,
}: {
  apiKey: string;
  /** The zone's ilçe and il, to centre the map first (never stored, never priced). */
  place: { il: string | null; ilce: string | null };
  pin: Point | null;
  onSettle: (pin: Point, parts: GeocodedParts | null) => void;
}) {
  const t = useTranslations('Address.map');
  const [center, setCenter] = useState<Point>(pin ?? TURKEY);
  const [zoom, setZoom] = useState(pin ? 17 : 5);
  const [current, setCurrent] = useState<Point | null>(pin);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [locating, setLocating] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const settleId = useRef(0);
  const chosenLabel = useRef<string | null>(null);

  // The first centre: one forward geocode of the zone's ilçe and il, when there is no pin yet.
  useEffect(() => {
    if (pin || !place.ilce || !place.il) return;
    let live = true;
    forwardGeocode(apiKey, `${place.ilce}, ${place.il}`)
      .then((found) => {
        const first = found[0];
        if (live && first) {
          setCenter({ lat: first.lat, lng: first.lng });
          setZoom(13);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The search, 300 ms after the last key. A picked result's label is not searched again: the list would come back
  // under the map and push Done down while the pin settles.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3 || text === chosenLabel.current) return;
    let live = true;
    const timer = setTimeout(() => {
      forwardGeocode(apiKey, text, center)
        .then((found) => {
          if (live) setResults(found);
        })
        .catch(() => {
          if (live) setNote(t('unavailable'));
        });
    }, SEARCH_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The centre biases the search but does not start one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, apiKey]);

  async function settle(point: Point) {
    const at = { lat: roundPin(point.lat), lng: roundPin(point.lng) };
    if (!pinInTurkey(at.lat, at.lng)) {
      setNote(t('outside'));
      return;
    }
    setNote(null);
    setCurrent(at);
    const id = ++settleId.current;
    let parts: GeocodedParts | null = null;
    try {
      parts = await reverseGeocode(apiKey, at.lat, at.lng);
    } catch {
      setNote(t('unavailable'));
    }
    if (id !== settleId.current) return;
    onSettle(at, parts);
    setAnnounce(parts && Object.keys(parts).length > 0 ? t('filled') : t('pinned'));
  }

  function choose(candidate: Candidate) {
    chosenLabel.current = candidate.label.trim();
    setResults(null);
    setQuery(candidate.label);
    setCenter({ lat: candidate.lat, lng: candidate.lng });
    setZoom(17);
    void settle({ lat: candidate.lat, lng: candidate.lng });
  }

  function locate() {
    if (!('geolocation' in navigator)) {
      setNote(t('locationDenied'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setCenter(point);
        setZoom(17);
        void settle(point);
      },
      () => {
        setLocating(false);
        setNote(t('locationDenied'));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
      <div className="relative">
        <label htmlFor="map-search" className="sr-only">
          {t('search')}
        </label>
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
        />
        <Input
          id="map-search"
          type="search"
          value={query}
          placeholder={t('search')}
          autoComplete="off"
          className="ps-9"
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 3) setResults(null);
          }}
        />
      </div>
      {results ? (
        results.length > 0 ? (
          <ul
            aria-label={t('results')}
            className="flex flex-col divide-y divide-border-light rounded-block border border-border-light"
          >
            {results.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="min-h-11 w-full px-4 py-2 text-start text-body-s text-text-primary hover:bg-surface-secondary"
                  onClick={() => choose(candidate)}
                >
                  {candidate.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-text-secondary">{t('searchEmpty')}</p>
        )
      ) : null}
      <Button type="button" variant="outline" onClick={locate} disabled={locating} className="self-start">
        <LocateFixedIcon aria-hidden className="size-4" />
        {locating ? t('locating') : t('locate')}
      </Button>
      {note ? (
        <p role="status" className="rounded-block bg-warning-light p-3 text-body-s text-warning-foreground">
          {note}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="h-72 min-h-64 overflow-hidden rounded-block border border-border-light lg:h-96">
        {mapFailed ? (
          <p className="p-4 text-body-s text-text-secondary">{t('unavailable')}</p>
        ) : (
          <AddressMap
            apiKey={apiKey}
            center={center}
            zoom={zoom}
            pin={current}
            editable
            label={t('label')}
            onPin={(point) => void settle(point)}
            onFail={() => setMapFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
