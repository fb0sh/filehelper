// Client-side history search over decrypted in-memory messages.
// Case-insensitive substring on text + decrypted filename only.
//
// findSearchMatches is the SINGLE source of truth for both "does this
// message match?" (matchesQuery / searchMessages) and "where do I put
// the <mark>s?" (SearchHighlightedText). Matching and highlighting can
// never drift apart.

import type { DecryptedMessage } from './crypto/messages';

export interface SearchMatch {
  start: number;
  end: number;
}

/**
 * Literal substring positions of `query` inside `text`, case-insensitive.
 *
 * Implemented with indexOf (no RegExp) so regex-special characters
 * (`. * + ? [ ] ( ) \ $`) are matched literally and can never crash or
 * throw. All occurrences are returned; indices point into the ORIGINAL
 * `text` so callers can slice it directly.
 */
export function findSearchMatches(text: string, query: string): SearchMatch[] {
  if (!query || !text) return [];
  const hay = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const matches: SearchMatch[] = [];

  if (hay.length === text.length) {
    // Lowercasing preserved length → indices line up with the original.
    let from = 0;
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + needle.length });
      from = idx + needle.length;
    }
    return matches;
  }

  // Rare: lowercasing changed length (e.g. Turkish İ → i + combining dot),
  // so lowercased offsets would misalign. Fall back to a case-sensitive
  // scan — matches still work, and highlight ranges can never be wrong.
  let from = 0;
  while (from <= text.length - query.length) {
    const idx = text.indexOf(query, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + query.length });
    from = idx + query.length;
  }
  return matches;
}

export function matchesQuery(m: DecryptedMessage, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (m.text && findSearchMatches(m.text, q).length > 0) return true;
  if (m.attachment?.filename && findSearchMatches(m.attachment.filename, q).length > 0)
    return true;
  return false;
}

/** Newest-first matches over a list of decrypted messages. */
export function searchMessages(
  messages: DecryptedMessage[],
  query: string
): DecryptedMessage[] {
  if (!query) return [];
  return messages
    .filter((m) => matchesQuery(m, query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
