/** Values shared by the request pages and the server, with no dependency (spec 0008 AC-15). */
export const CANCEL_REASONS = ['plans_changed', 'found_elsewhere', 'price', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
