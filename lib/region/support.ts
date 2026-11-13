/** A `wa.me` link from an E.164 number, or null when there is none yet (S25, spec 0005 AC-34). */
export function supportHref(whatsapp: string | null | undefined): string | null {
  if (!whatsapp || !/^\+[1-9]\d{6,14}$/.test(whatsapp)) return null;
  return `https://wa.me/${whatsapp.slice(1)}`;
}
