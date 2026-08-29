import { describe, it, expect } from 'vitest';
import {
  prependMessageDedupe,
  removeMessageFromPages,
  removeMessagesFromPages,
  contextToInfiniteData,
} from '../lib/realtimeCache';
import type { EncryptedMessage } from '../api';

const msg = (id: string, payload = 'FH1.x'): EncryptedMessage => ({
  id,
  payload,
  createdAt: '2026-01-01T00:00:00.000Z',
  attachment: null,
});

function pages(...groups: EncryptedMessage[][]) {
  return { pages: groups.map((messages) => ({ messages, nextCursor: null })), pageParams: [] };
}

describe('realtime cache (encrypted records)', () => {
  it('prepends a new message to the newest page', () => {
    const data = pages([msg('b'), msg('a')]);
    const out = prependMessageDedupe(data, msg('c'));
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });

  it('dedupes the same message (our own echo)', () => {
    const data = pages([msg('b')]);
    const out = prependMessageDedupe(data, msg('b'));
    expect(out!.pages[0].messages.length).toBe(1);
  });

  it('removes a single message', () => {
    const data = pages([msg('b'), msg('a')], [msg('z')]);
    const out = removeMessageFromPages(data, 'a');
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['b']);
    expect(out!.pages[1].messages.map((m) => m.id)).toEqual(['z']);
  });

  it('removes many messages at once', () => {
    const data = pages([msg('b'), msg('a'), msg('c')]);
    const out = removeMessagesFromPages(data, ['a', 'c']);
    expect(out!.pages[0].messages.map((m) => m.id)).toEqual(['b']);
  });

  it('ignores unknown ids without error', () => {
    const data = pages([msg('b')]);
    const out = removeMessagesFromPages(data, ['nope']);
    expect(out!.pages[0].messages.length).toBe(1);
  });

  it('context window stores newest-first pages', () => {
    const out = contextToInfiniteData([msg('a'), msg('b'), msg('c')], 'older-cursor');
    expect(out.pages[0].messages.map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(out.pages[0].nextCursor).toBe('older-cursor');
  });
});
