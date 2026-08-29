import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatHeader } from '../features/chat/ChatHeader';
import { useSearchStore } from '../stores/search';

function makeResults(n: number) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push({
      id: `m${i}`,
      kind: 'text',
      text: `report item ${i}`,
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      attachment: null,
    });
  }
  return results;
}

function stubSearch(results: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ results }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function renderHeader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatHeader />
    </QueryClientProvider>
  );
}

describe('TopbarSearch', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', jumpRequest: null });
    vi.unstubAllGlobals();
    window.matchMedia = window.matchMedia || (() => ({ matches: false }) as MediaQueryList);
  });

  it('search button switches the header into search mode', () => {
    stubSearch([]);
    renderHeader();
    expect(screen.queryByPlaceholderText('Search messages...')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();
  });

  it('shows "1 of N" and navigates with the arrows without closing', async () => {
    stubSearch(makeResults(5));
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText('Search messages...'), { target: { value: 'report' } });

    await waitFor(() => {
      expect(screen.getByText('1 of 5')).toBeDefined();
    });

    // ↑ = older match → 2 of 5, jump requested, search stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Older match' }));
    await waitFor(() => {
      expect(screen.getByText('2 of 5')).toBeDefined();
    });
    expect(useSearchStore.getState().jumpRequest?.message.id).toBe('m1');
    // Search mode is NOT closed after jumping.
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();

    // ↓ = newer match → back to 1 of 5.
    fireEvent.click(screen.getByRole('button', { name: 'Newer match' }));
    await waitFor(() => {
      expect(screen.getByText('1 of 5')).toBeDefined();
    });
    expect(useSearchStore.getState().jumpRequest?.message.id).toBe('m0');
  });

  it('disables arrows at the boundaries', async () => {
    stubSearch(makeResults(2));
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText('Search messages...'), { target: { value: 'report' } });
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeDefined());

    // Newest match: "newer" (↓) disabled.
    expect(screen.getByRole('button', { name: 'Newer match' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Older match' }));
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeDefined());
    // Oldest match: "older" (↑) disabled.
    expect(screen.getByRole('button', { name: 'Older match' }).hasAttribute('disabled')).toBe(true);
  });

  it('closes via X and restores the normal header', () => {
    stubSearch([]);
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByPlaceholderText('Search messages...')).toBeNull();
    expect(screen.getByText('FileHelper')).toBeDefined();
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('closes via Escape', () => {
    stubSearch([]);
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Search messages...'), { key: 'Escape' });
    expect(useSearchStore.getState().open).toBe(false);
  });

  it('shows "No results" when nothing matches', async () => {
    stubSearch([]);
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText('Search messages...'), { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(screen.getByText('No results')).toBeDefined();
    });
  });

  it('does not close search mode after a jump', async () => {
    stubSearch(makeResults(3));
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText('Search messages...'), { target: { value: 'report' } });
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Older match' }));
    await waitFor(() => expect(screen.getByText('2 of 3')).toBeDefined());
    expect(screen.getByPlaceholderText('Search messages...')).toBeDefined();
  });
});