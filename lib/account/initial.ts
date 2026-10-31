/**
 * The first character a person would recognise as one (spec 0005 Value sourcing). `Intl.Segmenter`, not
 * `name[0]`: a code unit can split a letter from its mark or an emoji in two.
 */
export function firstGrapheme(name: string): string {
  const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.trim());
  return first?.segment ?? '';
}
