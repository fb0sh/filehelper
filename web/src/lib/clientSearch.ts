// Client-side history search over decrypted in-memory messages.
// Case-insensitive substring on text + decrypted filename only.

import type { DecryptedMessage } from './crypto/messages';

export function matchesQuery(m: DecryptedMessage, query: string): boolean {
  const q = query.toLocaleLowerCase();
  if (m.text && m.text.toLocaleLowerCase().includes(q)) return true;
  if (m.attachment?.filename && m.attachment.filename.toLocaleLowerCase().includes(q)) return true;
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
