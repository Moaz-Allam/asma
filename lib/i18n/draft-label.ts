/** Presentation only: source and legal approval gates retain the draft marker. */
export function withoutDraftLabel(value: string): string {
  return value.replaceAll('[draft] ', '').replaceAll('[draft]', '');
}
