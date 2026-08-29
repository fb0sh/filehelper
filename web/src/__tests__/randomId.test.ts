import { describe, it, expect } from 'vitest';
import { randomUUID } from '../lib/randomId';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
  it('produces a valid v4 UUID', () => {
    expect(randomUUID()).toMatch(UUID_RE);
  });

  it('produces unique ids', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomUUID()));
    expect(seen.size).toBe(200);
  });
});
