'use client';

import dynamic from 'next/dynamic';

/**
 * The map's two entry points, each a dynamic import (spec 0011-20b AC-10): MapLibre, its CSS and the MapTiler client
 * load only when a page opens a map, never in the first bundle, and never on the server.
 */
export const LazyMapPicker = dynamic(() => import('./MapPicker'), { ssr: false });
export const LazyAddressMap = dynamic(() => import('./AddressMap'), { ssr: false });

export type { Point } from './AddressMap';
export type { GeocodedParts } from './mapping';
