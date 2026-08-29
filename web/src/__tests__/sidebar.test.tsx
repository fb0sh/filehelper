import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '../features/sidebar/Sidebar';
import { useUIStore } from '../stores/ui';
import { useAuthStore } from '../stores/auth';
import { messageKeys } from '../api/queryKeys';

function renderSidebar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Sidebar />
    </QueryClientProvider>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ theme: 'system', mobileChatOpen: false, settingsOpen: false, settingsSection: 'appearance' });
    useAuthStore.setState({ isAuthenticated: true, loginError: null });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], nextCursor: null }),
    })));
  });

  it('hamburger opens the menu', () => {
    renderSidebar();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('menu offers Storage / Appearance / About / Lock', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menuitem', { name: /Storage/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Appearance/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /About/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Lock/ })).toBeDefined();
  });

  it('Storage menu item opens the storage settings section', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Storage/ }));
    expect(useUIStore.getState().settingsOpen).toBe(true);
    expect(useUIStore.getState().settingsSection).toBe('storage');
  });

  it('Lock logs the user out', async () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Lock/ }));
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  it('sidebar search filters the single chat', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Sidebar />
      </QueryClientProvider>
    );
    // Matching input keeps the chat row.
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'filehelper' } });
    expect(screen.getByText('FileHelper')).toBeDefined();
    // Non-matching input shows "No chats found".
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'zzz' } });
    expect(screen.getByText('No chats found')).toBeDefined();
  });

  it('shows the latest message preview from the latest cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(messageKeys.latest, {
      messages: [{
        id: 'm1',
        kind: 'text',
        text: 'hello from cache',
        createdAt: new Date().toISOString(),
        attachment: null,
      }],
      nextCursor: null,
    });
    render(
      <QueryClientProvider client={client}>
        <Sidebar />
      </QueryClientProvider>
    );
    await vi.waitFor(() => {
      expect(screen.getByText('hello from cache')).toBeDefined();
    });
  });

  it('closes the menu on overlay click', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toBeDefined();
    fireEvent.click(screen.getByRole('menu').previousElementSibling as Element);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});