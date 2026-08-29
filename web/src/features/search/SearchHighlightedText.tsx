import type { ReactNode } from 'react';
import { findSearchMatches } from '../../lib/clientSearch';
import styles from './SearchHighlightedText.module.scss';

interface Props {
  text: string;
  query: string;
}

/**
 * Renders `text` with every case-insensitive occurrence of `query`
 * wrapped in a <mark>. Pure React nodes — never dangerouslySetInnerHTML.
 * <mark> stays user-selectable, so drag-to-select and "Copy selected
 * text" keep working across highlighted matches.
 */
export function SearchHighlightedText({ text, query }: Props) {
  if (!query || !text) return <>{text}</>;
  const matches = findSearchMatches(text, query);
  if (matches.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark key={m.start} className={styles.match}>
        {text.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
