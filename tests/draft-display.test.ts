import { describe, expect, it } from 'vitest';

import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { displayMessages } from '@/lib/i18n/request';

describe('displayMessages', () => {
  it.each([
    ['ar', ar],
    ['tr', tr],
    ['en', en],
  ] as const)(
    'hides only draft labels in %s while leaving the source marked for the launch gate',
    (_, source) => {
      const rendered = displayMessages(source);
      const raw = JSON.stringify(source);
      const text = JSON.stringify(rendered);
      expect(raw).toContain('[draft]');
      expect(text).not.toContain('[draft]');
      expect(text).toBe(raw.replaceAll('[draft] ', '').replaceAll('[draft]', ''));
      expect(JSON.stringify(source)).toBe(raw);
    },
  );
});
