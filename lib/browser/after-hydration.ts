/**
 * Runs a task after hydration: once the load event has fired and the browser is idle. Both telemetry
 * SDKs start their optional work here, so neither slows the first render (spec 0004 AC-4, AC-6).
 */
export function afterHydration(task: () => void): void {
  const schedule = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => task());
    else setTimeout(task, 1);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}
