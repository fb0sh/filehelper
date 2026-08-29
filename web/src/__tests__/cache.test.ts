import { describe, it, expect } from 'vitest';
import {
  prependMessageDedupe,
  removeMessageFromPages,
  contextToInfiniteData,
  InfiniteMessages,
} from '../lib/realtimeCache';
import { isNearBottom, shouldLoadMore, distanceFromBottom } from '../lib/scroll';
import { Message } from '../api';

function msg(id: string, createdAt: string): Message {
  return {
    id,
    kind: 'text',
    text: `text-${id}`,
    createdAt,
    attachment: null,
  };
}

function makeCache(messages: Message[]): InfiniteMessages {
  return {
    pages: [{ messages, nextCursor: null }],
    pageParams: [undefined],
  };
}

describe('prependMessageDedupe', () => {
  it('prepends a new message to the newest page', () => {
    const cache = makeCache([msg('a', '2026-01-01T10:00:00.000Z')]);
    const next = prependMessageDedupe(cache, msg('b', '2026-01-01T11:00:00.000Z'));
    expect(next?.pages[0].messages[0].id).toBe('b');
    expect(next?.pages[0].messages).toHaveLength(2);
  });

  it('ignores duplicate ids (websocket echo)', () => {
    const cache = makeCache([msg('a', '2026-01-01T10:00:00.000Z')]);
    const next = prependMessageDedupe(cache, msg('a', '2026-01-01T10:00:00.000Z'));
    expect(next).toBe(cache);
    expect(next?.pages[0].messages).toHaveLength(1);
  });

  it('dedupes across all pages, not just the first', () => {
    const cache: InfiniteMessages = {
      pages: [
        { messages: [msg('new', '2026-01-02T10:00:00.000Z')], nextCursor: 'a' },
        { messages: [msg('old', '2026-01-01T10:00:00.000Z')], nextCursor: null },
      ],
      pageParams: [undefined, 'a'],
    };
    const next = prependMessageDedupe(cache, msg('old', '2026-01-01T10:00:00.000Z'));
    expect(next).toBe(cache);
  });

  it('returns input untouched when cache is empty', () => {
    expect(prependMessageDedupe(undefined, msg('a', 'x'))).toBeUndefined();
    expect(prependMessageDedupe({ pages: [], pageParams: [] }, msg('a', 'x'))).toEqual({ pages: [], pageParams: [] });
  });
});

describe('removeMessageFromPages', () => {
  it('removes a message from every page', () => {
    const cache: InfiniteMessages = {
      pages: [
        { messages: [msg('a', 'x'), msg('b', 'y')], nextCursor: 'b' },
        { messages: [msg('c', 'z')], nextCursor: null },
      ],
      pageParams: [],
    };
    const next = removeMessageFromPages(cache, 'b');
    expect(next?.pages[0].messages.map((m) => m.id)).toEqual(['a']);
    expect(next?.pages[1].messages.map((m) => m.id)).toEqual(['c']);
  });
});

describe('contextToInfiniteData (search jump ordering)', () => {
  it('stores pages newest-first while input was old → new', () => {
    const oldToNew = [
      msg('m1', '2026-01-01T10:00:00.000Z'),
      msg('m2', '2026-01-01T10:01:00.000Z'),
      msg('m3', '2026-01-01T10:02:00.000Z'),
    ];
    const data = contextToInfiniteData(oldToNew, 'm1');
    // Render layer reverses pages, so after reversal order must match input.
    const rendered = [...data.pages[0].messages].reverse();
    expect(rendered.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(data.pages[0].nextCursor).toBe('m1');
    expect(data.pageParams).toEqual([undefined]);
  });

  it('keeps real time order after the render-layer reversal', () => {
    const oldToNew = [msg('a', '10:00'), msg('b', '10:05'), msg('c', '11:00')];
    const data = contextToInfiniteData(oldToNew, null);
    const rendered = [...data.pages[0].messages].reverse();
    const times = rendered.map((m) => m.createdAt);
    expect([...times].sort()).toEqual(times);
  });
});

describe('scroll helpers', () => {
  const el = (scrollHeight: number, scrollTop: number, clientHeight: number) => ({
    scrollHeight,
    scrollTop,
    clientHeight,
  });

  it('computes distance from bottom', () => {
    expect(distanceFromBottom(el(1000, 100, 400))).toBe(500);
  });

  it('detects near-bottom within threshold', () => {
    // 1000 - 300 - 400 = 300 from bottom → not near
    expect(isNearBottom(el(1000, 300, 400), 200)).toBe(false);
    // 1000 - 850 - 400 = -250 (past bottom) → near
    expect(isNearBottom(el(1000, 850, 400), 200)).toBe(true);
  });

  it('scroll button state does not depend on hasNextPage', () => {
    // shouldLoadMore is only the load-more gate; the button uses isNearBottom.
    const farFromBottom = el(5000, 0, 400);
    expect(isNearBottom(farFromBottom, 200)).toBe(false);
  });

  it('shouldLoadMore requires all conditions', () => {
    expect(shouldLoadMore(0, true, false)).toBe(true);
    expect(shouldLoadMore(0, false, false)).toBe(false);
    expect(shouldLoadMore(0, true, true)).toBe(false);
    expect(shouldLoadMore(500, true, false)).toBe(false);
  });
});