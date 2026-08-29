import { describe, it, expect } from 'vitest';
import { matchesQuery, searchMessages } from '../lib/clientSearch';
import type { DecryptedMessage } from '../lib/crypto/messages';

function textMsg(id: string, text: string, createdAt = '2026-01-01T00:00:00.000Z'): DecryptedMessage {
  return { id, type: 'text', text, createdAt };
}

function fileMsg(id: string, filename: string, createdAt = '2026-01-01T00:00:00.000Z'): DecryptedMessage {
  return {
    id,
    type: 'file',
    createdAt,
    attachment: {
      id: `att-${id}`,
      filename,
      mime: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      chunkSize: 8 * 1024 * 1024,
      chunkCount: 1,
      noncePrefix: 'A'.repeat(22),
      downloadUrl: `/api/v1/files/att-${id}/download`,
    },
  };
}

describe('client search', () => {
  it('matches text case-insensitively', () => {
    expect(matchesQuery(textMsg('a', 'Hello World'), 'hello')).toBe(true);
    expect(matchesQuery(textMsg('a', 'Hello World'), 'HELLO')).toBe(true);
    expect(matchesQuery(textMsg('a', 'hello world'), 'zzz')).toBe(false);
  });

  it('matches decrypted filenames (server never sees them)', () => {
    expect(matchesQuery(fileMsg('f', 'secret-report.pdf'), 'secret-report')).toBe(true);
    expect(matchesQuery(fileMsg('f', 'report final.pdf'), 'final')).toBe(true);
    expect(matchesQuery(fileMsg('f', 'report.pdf'), 'missing')).toBe(false);
  });

  it('returns newest-first results', () => {
    const msgs = [
      textMsg('old', 'hello world', '2026-01-01T00:00:00.000Z'),
      textMsg('new', 'hello there', '2026-01-02T00:00:00.000Z'),
      fileMsg('file', 'hello-notes.txt', '2026-01-03T00:00:00.000Z'),
      textMsg('no', 'nothing here', '2026-01-04T00:00:00.000Z'),
    ];
    const results = searchMessages(msgs, 'hello');
    expect(results.map((m) => m.id)).toEqual(['file', 'new', 'old']);
  });

  it('empty query returns no results', () => {
    expect(searchMessages([textMsg('a', 'anything')], '')).toEqual([]);
  });
});
