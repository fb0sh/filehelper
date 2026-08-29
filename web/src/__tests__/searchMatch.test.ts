import { describe, it, expect } from 'vitest';
import { findSearchMatches, matchesQuery, searchMessages } from '../lib/clientSearch';
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

describe('findSearchMatches (shared matching + highlight semantics)', () => {
  it('finds every occurrence, indices point into the original text', () => {
    const text = 'FileHelper abc FileHelper xyz FileHelper';
    const matches = findSearchMatches(text, 'FileHelper');
    expect(matches).toEqual([
      { start: 0, end: 10 },
      { start: 15, end: 25 },
      { start: 30, end: 40 },
    ]);
    // Slicing the original text with the indices yields the query.
    for (const m of matches) {
      expect(text.slice(m.start, m.end)).toBe('FileHelper');
    }
  });

  it('is case-insensitive', () => {
    expect(findSearchMatches('Hello World', 'hello')).toEqual([{ start: 0, end: 5 }]);
    expect(findSearchMatches('hello world', 'HELLO')).toEqual([{ start: 0, end: 5 }]);
    expect(findSearchMatches('FileHelper', 'filehelper')).toHaveLength(1);
  });

  it('handles Chinese, Tibetan and emoji', () => {
    expect(findSearchMatches('文件助手搜索测试', '文件助手')).toEqual([{ start: 0, end: 4 }]);
    // Emoji is a surrogate pair → occupies two UTF-16 code units.
    expect(findSearchMatches('release🚀ready', '🚀')).toEqual([{ start: 7, end: 9 }]);
    expect(findSearchMatches('བོད་ཡིག་གི་སྤྱོད་པ', 'ཡིག')).toHaveLength(1);
  });

  it('matches spaces literally', () => {
    expect(findSearchMatches('a b c', 'b c')).toEqual([{ start: 2, end: 5 }]);
    expect(findSearchMatches('plain text', '  ')).toEqual([]);
  });

  it.each(['.', '*', '+', '?', '[', ']', '(', ')', '\\', '$', '^', '|'])(
    'treats the regex-special char %s literally without crashing',
    (ch) => {
      const text = `a${ch}b ${ch} again`;
      const matches = findSearchMatches(text, ch);
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        expect(text.slice(m.start, m.end)).toBe(ch);
      }
    }
  );

  it('finds combined special patterns literally', () => {
    const text = 'a+b test[1] hello.world foo(bar)';
    expect(findSearchMatches(text, 'a+b')).toEqual([{ start: 0, end: 3 }]);
    expect(findSearchMatches(text, 'test[1]')).toEqual([{ start: 4, end: 11 }]);
    expect(findSearchMatches(text, 'hello.world')).toEqual([{ start: 12, end: 23 }]);
    expect(findSearchMatches(text, 'foo(bar)')).toEqual([{ start: 24, end: 32 }]);
  });

  it('handles queries longer than the text and empty inputs', () => {
    expect(findSearchMatches('abc', 'abcd')).toEqual([]);
    expect(findSearchMatches('abc', '')).toEqual([]);
    expect(findSearchMatches('', 'abc')).toEqual([]);
  });

  it('does not match overlapping occurrences (advances past each match)', () => {
    // "aaa" contains "aa" twice, never overlapping in position 1-2 twice.
    expect(findSearchMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe('matchesQuery / searchMessages (shared with highlight)', () => {
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

  it('a filename match implies the highlight can find it in the filename', () => {
    const filename = 'network-FileHelper-report.pdf';
    const m = fileMsg('f', filename);
    expect(matchesQuery(m, 'FileHelper')).toBe(true);
    expect(findSearchMatches(filename, 'FileHelper').length).toBe(1);
  });

  it('a text match implies the highlight can find it in the text', () => {
    const msg = textMsg('t', '今天测试一下 FileHelper 的搜索');
    expect(matchesQuery(msg, 'FileHelper')).toBe(true);
    expect(findSearchMatches(msg.text!, 'FileHelper')).toEqual([{ start: 7, end: 17 }]);
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

  it('regex-special-char queries match literally in searchMessages', () => {
    const msgs = [
      textMsg('a', 'a+b'),
      textMsg('b', 'test[1]'),
      textMsg('c', 'hello.world'),
      textMsg('d', 'foo(bar)'),
    ];
    expect(searchMessages(msgs, '+').map((m) => m.id)).toEqual(['a']);
    expect(searchMessages(msgs, '[').map((m) => m.id)).toEqual(['b']);
    expect(searchMessages(msgs, '.').map((m) => m.id)).toEqual(['c']);
    expect(searchMessages(msgs, '(').map((m) => m.id)).toEqual(['d']);
  });
});
