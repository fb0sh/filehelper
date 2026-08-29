import { useSearchStore } from '../stores/search';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * The debounced, trimmed search query that both the results computation
 * and the message renderers use, so matching and highlighting can never
 * disagree. Clears immediately when the search closes (no 300 ms linger
 * of highlights after the topbar is dismissed).
 */
export function useEffectiveSearchQuery(): string {
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const debounced = useDebouncedValue(open ? query.trim() : '', 300);
  return open ? debounced : '';
}
