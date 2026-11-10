import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn() }));

import { ContactEmailSchema } from '@/lib/account/profile';
import { supportHref } from '@/lib/region/support';

/** Spec 0005 AC-32, AC-34. The email is lowercased without any Turkish folding (rule 10). */

describe('the contact email', () => {
  it('trims and lowercases', () => {
    expect(ContactEmailSchema.parse('  Ali@Example.COM ')).toBe('ali@example.com');
  });

  it('folds an I the plain way, never to a dotless ı', () => {
    expect(ContactEmailSchema.parse('INFO@EXAMPLE.COM')).toBe('info@example.com');
  });

  it('turns an empty field into no address', () => {
    expect(ContactEmailSchema.parse('')).toBeNull();
    expect(ContactEmailSchema.parse('   ')).toBeNull();
    expect(ContactEmailSchema.parse(null)).toBeNull();
  });

  it.each(['not an email', 'a@b', '@example.com', `${'a'.repeat(250)}@example.com`, 7])(
    'refuses %j',
    (value) => {
      expect(ContactEmailSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('the support link', () => {
  it('builds a wa.me link from an E.164 number', () => {
    expect(supportHref('+905550000000')).toBe('https://wa.me/905550000000');
  });

  it.each([null, undefined, '', '05550000000', '+90 555 000 00 00', 'javascript:alert(1)'])(
    'stays hidden for %j',
    (value) => {
      expect(supportHref(value)).toBeNull();
    },
  );
});
