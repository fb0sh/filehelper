import { useEffect, useMemo, useState } from 'react';
import type { EncryptedMessage } from '../api';
import type { DecryptedMessage } from '../lib/crypto/messages';
import { decryptEncryptedMessage } from '../lib/crypto/messages';
import { loadCryptoSession } from '../lib/crypto/session';
import { decryptedCache } from '../lib/decryptedCache';

interface Result {
  messages: DecryptedMessage[];
  /** ids still being decrypted (render may show placeholders). */
  pendingCount: number;
}

/**
 * Derives DecryptedMessage[] from encrypted server records, caching by
 * message id in memory (shared with client search). Corrupt records
 * become `undecryptable` messages instead of crashing the tree.
 */
export function useDecryptedMessages(encrypted: EncryptedMessage[]): Result {
  const session = loadCryptoSession();
  const [version, setVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = { current: new Set<string>() };

  useEffect(() => {
    if (!session) return;
    const missing = encrypted.filter((e) => !decryptedCache.has(e.id));
    if (missing.length === 0) return;

    const pending = pendingRef.current;
    for (const record of missing) {
      if (pending.has(record.id)) continue;
      pending.add(record.id);
      setPendingCount(pending.size);
      void (async () => {
        const outcome = decryptEncryptedMessage(
          session.messageKey,
          session.spaceId,
          record
        );
        if (outcome.ok) {
          decryptedCache.set(outcome.message);
        } else {
          decryptedCache.set({
            id: record.id,
            type: 'text',
            createdAt: record.createdAt,
            undecryptable: true,
          });
        }
        pending.delete(record.id);
        setPendingCount(pending.size);
        setVersion((v) => v + 1);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encrypted, session?.messageKey, session?.spaceId]);

  const messages = useMemo(() => {
    const out: DecryptedMessage[] = [];
    for (const e of encrypted) {
      const m = decryptedCache.get(e.id);
      if (m) out.push(m);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encrypted, version]);

  return { messages, pendingCount };
}

export { decryptedCache };
