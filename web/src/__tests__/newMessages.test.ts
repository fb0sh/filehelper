import { describe, it, expect } from 'vitest';
import { computeAddedNewest, decideNewMessage } from '../lib/newMessages';

const msgs = (ids: string[]) => ids.map((id) => ({ id }));

describe('computeAddedNewest', () => {
  it('counts messages prepended before the previous newest', () => {
    // Previous newest was "c"; two newer messages arrived.
    const all = msgs(['e', 'd', 'c', 'b', 'a']);
    expect(computeAddedNewest('c', all)).toBe(2);
  });

  it('returns 0 when the previous newest is still the newest', () => {
    const all = msgs(['c', 'b', 'a']);
    expect(computeAddedNewest('c', all)).toBe(0);
  });

  it('returns 0 when the previous newest is missing (context jump / deletion)', () => {
    const all = msgs(['x', 'y', 'z']);
    expect(computeAddedNewest('ghost', all)).toBe(0);
    expect(computeAddedNewest(undefined, all)).toBe(0);
    expect(computeAddedNewest(null, all)).toBe(0);
  });

  it('does not count older pages prepended at the end (history pagination)', () => {
    // cache is newest-first; older messages are appended at the end, so
    // the newest id stays at index 0.
    const all = msgs(['z', 'y', 'x', 'w', 'v']);
    expect(computeAddedNewest('z', all)).toBe(0);
  });
});

describe('decideNewMessage', () => {
  it('scrolls when the user is near the bottom', () => {
    expect(decideNewMessage(true, 3)).toEqual({ kind: 'scroll' });
  });

  it('counts when the user is scrolled up', () => {
    expect(decideNewMessage(false, 1)).toEqual({ kind: 'count', count: 1 });
    expect(decideNewMessage(false, 2)).toEqual({ kind: 'count', count: 2 });
  });

  it('never counts when nothing was added', () => {
    expect(decideNewMessage(false, 0)).toEqual({ kind: 'count', count: 0 });
    expect(decideNewMessage(true, 0)).toEqual({ kind: 'count', count: 0 });
  });
});