import { useEffect, useState } from 'react';

// Debounce a rapidly changing value (e.g. search input). Cleanup runs
// on every change and unmount, so stale timers never fire.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}