/**
 * A Server Action call from the browser, settled (spec 0007 review, 2026-11-15). A dropped connection rejects
 * the promise; this turns it into the stable `network` code, so a sheet keeps what was typed and the test
 * panel never waits forever. Safe in the browser: no server import.
 */

export type Settled<T> = { success: true; data: T } | { success: false; error: string };

export async function settle<T>(call: () => Promise<Settled<T>>): Promise<Settled<T>> {
  try {
    return await call();
  } catch {
    return { success: false, error: 'network' };
  }
}

/**
 * The late answer rule of the pricing test panel (spec 0007 AC-21): each request takes a ticket, and an
 * answer is shown only while its ticket is still the newest, so a slow answer never replaces a newer one.
 */
export function latestOnly(): { take: () => number; isLatest: (ticket: number) => boolean } {
  let current = 0;
  return {
    take: () => ++current,
    isLatest: (ticket) => ticket === current,
  };
}
