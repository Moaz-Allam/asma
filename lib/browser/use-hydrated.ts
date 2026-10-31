import { useSyncExternalStore } from 'react';

const noSubscription = () => () => undefined;

/**
 * False in the server render and until hydration. A submit button stays disabled until then: a form
 * handled in JavaScript and submitted before hydration would be a native GET, with its fields in the URL.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
