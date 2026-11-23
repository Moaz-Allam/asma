import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PROVIDER_ADDRESS_KEYS,
  ProviderAddressInput,
  REQUEST_ADDRESS_KEYS,
  RequestAddressInput,
  addressErrors,
  addressPayload,
  cleanPart,
  composeAddress,
  openInMapsUrl,
  pinInTurkey,
  placeFold,
} from '@/lib/address/parts';
import { mapForward, mapReverse } from '@/lib/maps/mapping';
import { CreateRequestInput } from '@/lib/requests/input';

/**
 * Spec 0011-20b AC-3, AC-4, AC-6, AC-12, X-9, X-16, X-17, X-21: the browser's copy of the address rules, the composed
 * line (the same as Postgres's `compose_address`, proved in pgTAP 45), the input schemas, and the geocoder mapping.
 *
 * The MapTiler fixtures are real answers, recorded 2026-11-23 with the S46 key (a reverse geocode in Caferağa, Kadıköy
 * and a forward search for `Kadıköy, İstanbul`); they hold place names only.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/maptiler/${name}.json`, 'utf8'));

const FULL = {
  mahalle: 'Caferağa',
  street: 'Moda Cad.',
  building_no: '12',
  floor: '3',
  apartment: '5',
  postal_code: '34710',
  directions: 'Mavi kapı, zile iki kez basın',
};

describe('composeAddress (Address composition)', () => {
  it('reads like the Turkish form, joined by commas', () => {
    expect(composeAddress({ ...FULL, ilce: 'Kadıköy', il: 'İstanbul' })).toBe(
      'Caferağa Mah., Moda Cad., No: 12, Kat: 3, Daire: 5, 34710 Kadıköy/İstanbul',
    );
  });

  it('adds no suffix when the name already has one, and leaves out what is not given', () => {
    expect(composeAddress({ mahalle: 'Caferağa Mahallesi', street: 'Moda Cad.', building_no: '12' })).toBe(
      'Caferağa Mahallesi, Moda Cad., No: 12',
    );
    expect(
      composeAddress({ mahalle: 'Caferağa mah.', street: 'Moda', building_no: '1', ilce: 'Kadıköy' }),
    ).toBe('Caferağa mah., Moda, No: 1, Kadıköy');
    expect(
      composeAddress({ mahalle: 'Caferağa Mh.', street: 'Moda', building_no: '1', postal_code: '34710' }),
    ).toBe('Caferağa Mh., Moda, No: 1, 34710');
  });

  it('never prints the directions', () => {
    expect(composeAddress(FULL)).not.toContain('Mavi');
  });

  it('keeps every part at its maximum inside the line limit of 400 (D230)', () => {
    const line = composeAddress({
      mahalle: 'a'.repeat(80),
      street: 'b'.repeat(80),
      building_no: '1'.repeat(10),
      floor: '2'.repeat(10),
      apartment: '3'.repeat(10),
      postal_code: '34710',
      ilce: 'c'.repeat(60),
      il: 'd'.repeat(60),
    });
    expect([...line].length).toBe(348);
  });
});

describe('addressErrors (Address rules, X-9, X-21)', () => {
  it('accepts a full address and the typed fields alone', () => {
    expect(addressErrors(FULL, REQUEST_ADDRESS_KEYS)).toEqual({});
    expect(
      addressErrors({ mahalle: 'Moda', street: 'Bahariye', building_no: '7' }, REQUEST_ADDRESS_KEYS),
    ).toEqual({});
  });

  it('needs the mahalle, the street and the building number, and il and ilçe for a provider', () => {
    expect(addressErrors({ street: 'Moda', building_no: '' }, REQUEST_ADDRESS_KEYS)).toEqual({
      mahalle: 'address_invalid',
      building_no: 'address_invalid',
    });
    expect(
      addressErrors({ mahalle: 'Moda', street: 'Bahariye', building_no: '7' }, PROVIDER_ADDRESS_KEYS),
    ).toEqual({
      il: 'address_invalid',
      ilce: 'address_invalid',
    });
  });

  it('checks each part against its own rule', () => {
    const base = { mahalle: 'Moda', street: 'Bahariye', building_no: '7' };
    expect(addressErrors({ ...base, postal_code: '3471' }, REQUEST_ADDRESS_KEYS)).toEqual({
      postal_code: 'address_invalid',
    });
    expect(addressErrors({ ...base, building_no: '12/A' }, REQUEST_ADDRESS_KEYS)).toEqual({});
    // At most 4 digits, so no number part can carry a phone number (X-2).
    expect(addressErrors({ ...base, apartment: '5551234' }, REQUEST_ADDRESS_KEYS)).toEqual({
      apartment: 'address_invalid',
    });
    expect(addressErrors({ ...base, floor: 'Kat#3' }, REQUEST_ADDRESS_KEYS)).toEqual({
      floor: 'address_invalid',
    });
    expect(addressErrors({ ...base, mahalle: 'M' }, REQUEST_ADDRESS_KEYS)).toEqual({
      mahalle: 'address_invalid',
    });
    expect(addressErrors({ ...base, street: 'a'.repeat(81) }, REQUEST_ADDRESS_KEYS)).toEqual({
      street: 'address_invalid',
    });
    expect(addressErrors({ ...base, directions: 'x'.repeat(301) }, REQUEST_ADDRESS_KEYS)).toEqual({
      directions: 'address_invalid',
    });
    expect(addressErrors({ ...base, street: 'Moda\u0007' }, REQUEST_ADDRESS_KEYS)).toEqual({
      street: 'address_invalid',
    });
  });

  it('refuses a pin outside Turkey or half a pin', () => {
    const base = { mahalle: 'Moda', street: 'Bahariye', building_no: '7' };
    expect(addressErrors({ ...base, lat: 40.98, lng: 29.03 }, REQUEST_ADDRESS_KEYS)).toEqual({});
    expect(addressErrors({ ...base, lat: 48.85, lng: 2.35 }, REQUEST_ADDRESS_KEYS)).toEqual({
      pin: 'pin_invalid',
    });
    expect(addressErrors({ ...base, lat: 40.98 }, REQUEST_ADDRESS_KEYS)).toEqual({ pin: 'pin_invalid' });
    expect(pinInTurkey(35.5, 25.5)).toBe(true);
    expect(pinInTurkey(42.51, 30)).toBe(false);
  });
});

describe('addressPayload and the input schemas (X-8, X-9)', () => {
  it('trims, sends an empty part as null, and rounds the pin to six decimals', () => {
    const body = addressPayload(
      {
        mahalle: '  Caferağa ',
        street: 'Moda',
        building_no: '12',
        floor: '   ',
        lat: 40.98634512,
        lng: 29.0252,
      },
      REQUEST_ADDRESS_KEYS,
    );
    expect(body).toEqual({
      mahalle: 'Caferağa',
      street: 'Moda',
      building_no: '12',
      floor: null,
      apartment: null,
      postal_code: null,
      directions: null,
      lat: 40.986345,
      lng: 29.0252,
    });
    expect(RequestAddressInput.parse(body)).toEqual(body);
    expect(cleanPart('​ x ﻿')).toBe('x');
  });

  it('sends no pin keys without a whole pin', () => {
    expect(addressPayload({ mahalle: 'a', lat: 40 }, REQUEST_ADDRESS_KEYS)).not.toHaveProperty('lat');
  });

  it('refuses an unknown key, a string pin, and il or ilçe from a customer', () => {
    const body = addressPayload(FULL, REQUEST_ADDRESS_KEYS);
    expect(() => RequestAddressInput.parse({ ...body, phone: '+90' })).toThrow();
    expect(() => RequestAddressInput.parse({ ...body, lat: '40.9', lng: 29 })).toThrow();
    expect(() => RequestAddressInput.parse({ ...body, il: 'İstanbul' })).toThrow();
    expect(() => ProviderAddressInput.parse({ ...body, il: 'İstanbul', ilce: 'Kadıköy' })).toThrow();
    expect(
      ProviderAddressInput.parse(
        addressPayload({ ...FULL, il: 'İstanbul', ilce: 'Kadıköy' }, PROVIDER_ADDRESS_KEYS),
      ),
    ).toMatchObject({ il: 'İstanbul', ilce: 'Kadıköy' });
  });

  it('the request input carries the parts, never a line', () => {
    const input = {
      serviceId: '00000000-0000-4000-8000-000000000001',
      zoneId: '00000000-0000-4000-8000-000000000002',
      addonIds: [],
      answers: {},
      clientKey: '00000000-0000-4000-8000-000000000003',
      startDate: '2026-12-01',
      startHour: 10,
      notes: null,
      expectedPrice: 100000,
      expectedCommission: 10000,
    };
    expect(
      CreateRequestInput.parse({ ...input, address: addressPayload(FULL, REQUEST_ADDRESS_KEYS) }),
    ).toBeTruthy();
    expect(() => CreateRequestInput.parse({ ...input, addressLine: 'Moda Cad. 5' })).toThrow();
  });
});

describe('the Open in Maps link (AC-6, X-5)', () => {
  it('uses the coordinates only when pinned, else searches the line', () => {
    expect(openInMapsUrl({ lat: 40.986345, lng: 29.0252, line: 'Moda' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=40.986345,29.0252',
    );
    expect(openInMapsUrl({ line: 'Caferağa Mah., Moda Cad., No: 12' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Cafera%C4%9Fa%20Mah.%2C%20Moda%20Cad.%2C%20No%3A%2012',
    );
    expect(openInMapsUrl({})).toBeNull();
  });
});

describe('placeFold (X-15, the browser only)', () => {
  it('compares Turkish place names without a locale', () => {
    expect(placeFold('KADIKÖY')).toBe(placeFold('Kadıköy'));
    expect(placeFold('İstanbul')).toBe(placeFold('istanbul'));
    expect(placeFold('Şişli')).toBe('sisli');
    expect(placeFold('Kadıköy')).not.toBe(placeFold('Üsküdar'));
  });
});

describe('the geocoder mapping (lib/maps/mapping.ts, X-17)', () => {
  it('reads a reverse answer into the parts by type (recorded in Kadıköy, 2026-11-23)', () => {
    expect(mapReverse(fixture('reverse-moda'))).toEqual({
      mahalle: 'Caferağa Mahallesi',
      street: 'Neşe Sokağı',
      building_no: '3',
      postal_code: '34710',
      ilce: 'Kadıköy',
      il: 'İstanbul',
    });
  });

  it('leaves out what the geocoder did not return, and what breaks a rule', () => {
    expect(
      mapReverse({
        features: [
          {
            id: 'address.1',
            place_type: ['address'],
            text: 'Uzun Sokak',
            address: '5551234567',
            context: [{ id: 'postal_code.x', text: 'TR-34' }],
          },
        ],
      }),
    ).toEqual({ street: 'Uzun Sokak' });
    expect(mapReverse({ features: [] })).toEqual({});
    expect(mapReverse(null)).toEqual({});
    expect(mapReverse({ features: 'nope' })).toEqual({});
  });

  it('cuts a long name to the column limit', () => {
    const parts = mapReverse({ features: [{ id: 'road.1', place_type: ['road'], text: 'x'.repeat(200) }] });
    expect(parts.street).toHaveLength(80);
  });

  it('reads a forward answer into at most five candidates with a point', () => {
    const found = mapForward(fixture('forward-kadikoy'));
    expect(found).toHaveLength(5);
    expect(found[0]).toMatchObject({ id: 'joint_municipality.1140', label: 'Kadıköy, Türkiye' });
    expect(found[0]?.lat).toBeCloseTo(40.9913, 3);
    expect(found[0]?.lng).toBeCloseTo(29.0246, 3);
    const many = {
      features: Array.from({ length: 8 }, (_, i) => ({ id: `p.${i}`, text: `P${i}`, center: [29, 41] })),
    };
    expect(mapForward(many)).toHaveLength(5);
    expect(mapForward({ features: [{ id: 'x', text: 'No point' }] })).toEqual([]);
  });
});
