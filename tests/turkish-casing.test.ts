import { describe, expect, it } from 'vitest';

/**
 * The Turkish dotless-i hazard. See context/i18n.md §6.
 *
 * Turkish maps I→ı and i→İ, unlike every other locale. Case-folding an identifier
 * under a Turkish locale therefore silently breaks email matching, enum
 * comparison, and account lookup. It has broken OpenSSL and the Kotlin compiler
 * the same way. This is a correctness AND security issue, so it gets a test.
 */
describe('identifiers are never case-folded under a Turkish locale', () => {
  it('demonstrates the hazard, so the reason for the rule is visible', () => {
    expect('I'.toLocaleLowerCase('tr')).toBe('ı');
    expect('i'.toLocaleUpperCase('tr')).toBe('İ');
    expect('I'.toLocaleLowerCase('tr')).not.toBe('i');
  });

  it('locale-independent casing is stable, which is why identifiers use it', () => {
    expect('I'.toLowerCase()).toBe('i');
    expect('i'.toUpperCase()).toBe('I');
    expect('ISTANBUL'.toLowerCase()).toBe('istanbul');
  });

  it('round-trips every i-variant through the identifier comparison path', () => {
    // The path an email takes before storage or lookup.
    const normalise = (s: string) => s.trim().toLowerCase();

    for (const variant of ['I', 'i', 'ı', 'İ']) {
      const email = `${variant}nfo@example.com`;
      // Normalisation must be idempotent and must not depend on the host locale.
      expect(normalise(normalise(email))).toBe(normalise(email));
    }

    // The two ASCII forms must collide; the two Turkish forms must NOT be folded
    // into them, or two different accounts become one.
    expect(normalise('Info@example.com')).toBe(normalise('info@example.com'));
    expect(normalise('ınfo@example.com')).not.toBe(normalise('info@example.com'));
    expect(normalise('İnfo@example.com')).not.toBe(normalise('info@example.com'));
  });
});
