/**
 * Every value a mail shows passes through here (spec 0011-13 AC-2, R-6): direction marks and line breaks are
 * removed, so a service name can neither reorder the line around it nor add a header or a paragraph, and it is
 * clamped to 120 characters. The HTML side escapes the whole line after the catalogue string is filled in.
 */

export const VALUE_LIMIT = 120;

// Bidirectional controls (embeddings, overrides, isolates, marks) and the Arabic letter mark.
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** C0 and C1 controls, and the Unicode line and paragraph separators (by code point, not a control regex). */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

export function cleanValue(value: string, limit: number = VALUE_LIMIT): string {
  const flat = Array.from(value.replace(BIDI, ''))
    .map((char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : flat;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
