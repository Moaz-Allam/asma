import { describe, expect, it } from 'vitest';

import { checkoutHostsFor } from '@/lib/payments/checkout-hosts';
import { isAllowedCheckoutUrl } from '@/lib/payments/checkout-url';
import { createFakeAdapter } from '@/lib/psp/fake';
import { createIyzicoAdapter } from '@/lib/psp/iyzico';
import { createOffAdapter } from '@/lib/psp/off';

/**
 * Spec 0011-08 AC-21, R-5 (R13 S8): a card page URL is stored and shown only when it parses, has no user info, is
 * https (http only on localhost), and its host is in the active adapter's list by exact match.
 */

const HOSTS = ['pay.example.test', 'localhost:3100'];

describe('isAllowedCheckoutUrl', () => {
  it.each([
    ['https on a listed host', 'https://pay.example.test/p/abc', true],
    ['http on localhost with its port', 'http://localhost:3100/tr/dev/fake-checkout/x', true],
    ['http on a listed host that is not localhost', 'http://pay.example.test/p/abc', false],
    ['https on localhost with another port', 'https://localhost:3200/x', false],
    ['another host', 'https://evil.example.test/p', false],
    ['a suffix trick', 'https://pay.example.test.evil.example/p', false],
    ['a sub domain', 'https://sub.pay.example.test/p', false],
    ['user info', 'https://user:pw@pay.example.test/p', false],
    ['a user name alone', 'https://user@pay.example.test/p', false],
    ['a script URL', 'javascript:alert(1)', false],
    ['a data URL', 'data:text/html,hi', false],
    ['not a URL', 'nonsense', false],
    ['empty', '', false],
    ['over 2,000 characters', `https://pay.example.test/${'a'.repeat(2000)}`, false],
  ])('%s', (_name, url, expected) => {
    expect(isAllowedCheckoutUrl(url, HOSTS)).toBe(expected);
  });

  it('refuses everything against an empty list (iyzico before S1, and off)', () => {
    expect(isAllowedCheckoutUrl('https://pay.example.test/p', [])).toBe(false);
  });
});

describe('the host lists (R-5): the adapters read theirs from lib/payments', () => {
  const store = { get: async () => null, set: async () => undefined };

  it('the fake: the host of the app origin', () => {
    expect(checkoutHostsFor('fake', 'http://localhost:3100')).toEqual(['localhost:3100']);
    expect(createFakeAdapter({ store, origin: 'http://localhost:3100' }).checkoutHosts).toEqual(
      checkoutHostsFor('fake', 'http://localhost:3100'),
    );
  });

  it('iyzico: empty until S1, and the adapter matches', () => {
    expect(checkoutHostsFor('iyzico', 'https://x.example')).toEqual([]);
    expect(createIyzicoAdapter().checkoutHosts).toEqual(checkoutHostsFor('iyzico', 'https://x.example'));
  });

  it('off: empty', () => {
    expect(checkoutHostsFor('off', 'https://x.example')).toEqual([]);
    expect(createOffAdapter().checkoutHosts).toEqual([]);
  });
});
