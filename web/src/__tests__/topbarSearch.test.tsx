import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TopbarSearch } from '../features/search/TopbarSearch';
import { useSearchStore } from '../stores/search';
import { decryptedCache } from '../lib/decryptedCache';
import { resetHistoryLoader } from '../lib/searchHistory';
import type { DecryptedMessage } from '../lib/crypto/messages';

function text(id: string, text: string, createdAt: string): DecryptedMessage {
  return { id, type: 'text', text, createdAt };
}

function file(id: string, filename: string, createdAt: string): DecryptedMessage {
  return {
    id,
    type: 'file',
    createdAt,
    attachment: {
      id: `att-${id}`,
      filename,
      mime: 'application/pdf',
      size: 1,
      sha256: 'a'.repeat(64),
      chunkSize: 8 * 1024 * 1024,
      chunkCount: 1,
      noncePrefix: 'A'.repeat(22),
      downloadUrl: `/api/v1/files/att-${id}/download`,
    },
  };
}

function renderSearch() {
  return render(<TopbarSearch />);
}

function typeQuery(query: string) {
  const input = screen.getByPlaceholderText('Search messages...');
  fireEvent.change(input, { target: { value: query } });
  return input;
}

describe('TopbarSearch (client-side)', () => {
  beforeEach(() => {
    decryptedCache.clear();
    resetHistoryLoader();
    useSearchStore.setState({ open: true, query: '', activeResultId: null, jumpRequest: null });
    // Backfill fetch: empty server history (no crypto session in jsdom,
    // so the loader never actually starts; stub defensively anyway).
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], nextCursor: null }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSearchStore.setState({ open: false, query: '', activeResultId: null, jumpRequest: null });
  });

  it('searches decrypted text and filename locally', async () => {
    decryptedCache.set(text('m1', 'hello world', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('m2', 'nothing here', '2026-01-02T00:00:00.000Z'));
    decryptedCache.set(file('m3', 'secret-report.pdf', '2026-01-03T00:00:00.000Z'));

    renderSearch();
    typeQuery('hello');
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeDefined());

    typeQuery('secret-report');
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeDefined());
  });

  it('shows No results and does not auto-close', async () => {
    decryptedCache.set(text('m1', 'alpha beta', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    typeQuery('zzz');
    await waitFor(() => expect(screen.getByText('No results')).toBeDefined());
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();
  });

  it('newest-first counter and arrow navigation request jumps', async () => {
    decryptedCache.set(text('old', 'needle old', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('new', 'needle new', '2026-01-02T00:00:00.000Z'));

    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeDefined());

    // ↑ → older match (position 2 of 2).
    fireEvent.click(screen.getByLabelText('Older match'));
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeDefined());
    const jump = useSearchStore.getState().jumpRequest;
    expect(jump?.message.id).toBe('old');
    expect(useSearchStore.getState().activeResultId).toBe('old');

    // ↓ → newer match.
    fireEvent.click(screen.getByLabelText('Newer match'));
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeDefined());
    expect(useSearchStore.getState().jumpRequest?.message.id).toBe('new');
  });

  it('arrows disable at the boundaries', async () => {
    decryptedCache.set(text('only', 'solo needle', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    typeQuery('solo');
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeDefined());
    expect((screen.getByLabelText('Older match') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Newer match') as HTMLButtonElement).disabled).toBe(true);
  });

  it('auto-jumps to the newest match as soon as results appear', async () => {
    decryptedCache.set(text('old', 'FileHelper old', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('new', 'FileHelper new', '2026-01-02T00:00:00.000Z'));

    renderSearch();
    typeQuery('FileHelper');

    // No extra clicks: the newest match becomes active AND a jump is
    // requested immediately.
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('new')
    );
    expect(useSearchStore.getState().jumpRequest?.message.id).toBe('new');
    expect(screen.getByText('1 / 2')).toBeDefined();
  });

  it('active result stays stable while the cache grows (backfill/realtime)', async () => {
    decryptedCache.set(text('a', 'needle a', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('b', 'needle b', '2026-01-02T00:00:00.000Z'));
    decryptedCache.set(text('c', 'needle c', '2026-01-03T00:00:00.000Z'));

    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('c'));

    // Move to B (position 2).
    fireEvent.click(screen.getByLabelText('Older match'));
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('b')
    );

    // Backfill inserts a NEWER match; active must stay B, counter shifts.
    decryptedCache.set(text('NEW', 'needle realtime', '2026-01-04T00:00:00.000Z'));
    await waitFor(() => expect(screen.getByText('3 / 4')).toBeDefined());
    expect(useSearchStore.getState().activeResultId).toBe('b');
  });

  it('changing the query resets the active result to the newest of the new set', async () => {
    decryptedCache.set(text('a', 'first query match', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('b', 'first query match 2', '2026-01-02T00:00:00.000Z'));
    decryptedCache.set(text('c', 'other term here', '2026-01-03T00:00:00.000Z'));

    renderSearch();
    typeQuery('first query');
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('b')
    );

    // New query: an old activeResultId must not pin an old highlight.
    typeQuery('other');
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('c')
    );
    expect(screen.getByText('1 / 1')).toBeDefined();
  });

  it('deleting the active result falls back to the newest remaining match', async () => {
    decryptedCache.set(text('a', 'needle a', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('b', 'needle b', '2026-01-02T00:00:00.000Z'));
    decryptedCache.set(text('c', 'needle c', '2026-01-03T00:00:00.000Z'));

    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('c'));

    // Move to B, then B is deleted (another device / this device).
    fireEvent.click(screen.getByLabelText('Older match'));
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('b')
    );
    decryptedCache.delete('b');

    // Active no longer exists → adopt the newest remaining match (c).
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBe('c')
    );
    expect(screen.getByText('1 / 2')).toBeDefined();
  });

  it('no results clears the active result', async () => {
    decryptedCache.set(text('a', 'needle a', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('a'));

    typeQuery('zzz-no-match');
    await waitFor(() =>
      expect(useSearchStore.getState().activeResultId).toBeNull()
    );
    expect(screen.getByText('No results')).toBeDefined();
  });

  it('Enter navigates older, Shift+Enter newer, IME Enter does nothing', async () => {
    decryptedCache.set(text('old', 'needle old', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('new', 'needle new', '2026-01-02T00:00:00.000Z'));

    renderSearch();
    const input = typeQuery('needle');
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeDefined());

    // Enter → older.
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('old'));

    // Shift+Enter → newer.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('new'));

    // IME composition commit (Enter with isComposing) must NOT navigate.
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    fireEvent(input, composing);
    await new Promise((r) => setTimeout(r, 50));
    expect(useSearchStore.getState().activeResultId).toBe('new');
  });

  it('Escape closes the search and clears the query/active result', async () => {
    decryptedCache.set(text('a', 'needle a', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('a'));

    fireEvent.keyDown(screen.getByPlaceholderText('Search messages...'), { key: 'Escape' });
    const s = useSearchStore.getState();
    expect(s.open).toBe(false);
    expect(s.query).toBe('');
    expect(s.activeResultId).toBeNull();
    expect(s.jumpRequest).toBeNull();
  });

  it('X closes the search and clears everything', async () => {
    decryptedCache.set(text('a', 'needle a', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(useSearchStore.getState().activeResultId).toBe('a'));

    fireEvent.click(screen.getByLabelText('Close search'));
    const s = useSearchStore.getState();
    expect(s.open).toBe(false);
    expect(s.query).toBe('');
    expect(s.activeResultId).toBeNull();
    expect(s.jumpRequest).toBeNull();
  });

  it('Back arrow closes the search too', async () => {
    renderSearch();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('never calls a server search endpoint', async () => {
    decryptedCache.set(text('m1', 'needle', '2026-01-01T00:00:00.000Z'));
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], nextCursor: null }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    renderSearch();
    typeQuery('needle');
    await waitFor(() => expect(screen.getByText('1 / 1')).toBeDefined());
    // The backfill fetch is the messages list — never /search.
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
  });
});
