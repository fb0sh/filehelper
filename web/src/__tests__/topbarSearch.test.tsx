import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TopbarSearch } from '../features/search/TopbarSearch';
import { useSearchStore } from '../stores/search';
import { decryptedCache } from '../lib/decryptedCache';
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

describe('TopbarSearch (client-side)', () => {
  beforeEach(() => {
    decryptedCache.clear();
    useSearchStore.setState({ open: true, query: '', jumpRequest: null });
    // Backfill fetch: empty server history.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], nextCursor: null }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches decrypted text and filename locally', async () => {
    decryptedCache.set(text('m1', 'hello world', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('m2', 'nothing here', '2026-01-02T00:00:00.000Z'));
    decryptedCache.set(file('m3', 'secret-report.pdf', '2026-01-03T00:00:00.000Z'));

    renderSearch();
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'hello' } });
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeDefined());

    fireEvent.change(input, { target: { value: 'secret-report' } });
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeDefined());
  });

  it('shows No results and does not auto-close', async () => {
    decryptedCache.set(text('m1', 'alpha beta', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText('No results')).toBeDefined());
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();
  });

  it('newest-first counter and arrow navigation request jumps', async () => {
    decryptedCache.set(text('old', 'needle old', '2026-01-01T00:00:00.000Z'));
    decryptedCache.set(text('new', 'needle new', '2026-01-02T00:00:00.000Z'));

    renderSearch();
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'needle' } });
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeDefined());

    // ↑ → older match (index 2 of 2).
    fireEvent.click(screen.getByLabelText('Older match'));
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeDefined());
    const jump = useSearchStore.getState().jumpRequest;
    expect(jump?.message.id).toBe('old');

    // ↓ → newer match.
    fireEvent.click(screen.getByLabelText('Newer match'));
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeDefined());
    expect(useSearchStore.getState().jumpRequest?.message.id).toBe('new');
  });

  it('arrows disable at the boundaries', async () => {
    decryptedCache.set(text('only', 'solo needle', '2026-01-01T00:00:00.000Z'));
    renderSearch();
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'solo' } });
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeDefined());
    expect((screen.getByLabelText('Older match') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Newer match') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Escape closes the search', () => {
    renderSearch();
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('X closes the search', () => {
    renderSearch();
    fireEvent.click(screen.getByLabelText('Close search'));
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
    const input = screen.getByPlaceholderText('Search messages...');
    fireEvent.change(input, { target: { value: 'needle' } });
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeDefined());
    // The backfill fetch is the messages list — never /search.
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
  });
});
