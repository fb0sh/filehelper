import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageBubble } from '../features/chat/messages/MessageBubble';
import { useSelectionStore } from '../stores/selection';
import type { DecryptedMessage } from '../lib/crypto/messages';

const textMsg: DecryptedMessage = {
  id: 'm-text',
  type: 'text',
  text: 'abcdefg',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const fileMsg: DecryptedMessage = {
  id: 'm-file',
  type: 'file',
  createdAt: '2026-01-01T00:00:00.000Z',
  attachment: {
    id: 'att-1',
    filename: 'report.pdf',
    mime: 'application/pdf',
    size: 100,
    sha256: 'a'.repeat(64),
    chunkSize: 8 * 1024 * 1024,
    chunkCount: 1,
    noncePrefix: 'A'.repeat(22),
    downloadUrl: '/api/v1/files/att-1/download',
  },
};

function renderBubble(message: DecryptedMessage, over = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MessageBubble
        message={message}
        selectionMode={false}
        selected={false}
        onToggleSelect={() => {}}
        {...over}
      />
    </QueryClientProvider>
  );
}

function openMenu(element: HTMLElement, clientX = 100, clientY = 100) {
  fireEvent.contextMenu(element, { clientX, clientY });
}

describe('MessageBubble context menu', () => {
  beforeEach(() => {
    useSelectionStore.setState({ active: false, selectedIds: new Set() });
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('text message: Copy copies the full text when there is no selection', async () => {
    renderBubble(textMsg);
    openMenu(screen.getByText('abcdefg'));
    const copy = await screen.findByText('Copy');
    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abcdefg')
    );
  });

  it('text message: Copy selected text copies only the snapshot', async () => {
    renderBubble(textMsg);
    const wrapper = screen.getByText('abcdefg').closest('[data-message-wrapper]') as Element;
    const sel = {
      isCollapsed: false,
      toString: () => 'cde',
      anchorNode: wrapper,
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockReturnValue(sel);

    openMenu(screen.getByText('abcdefg'));
    const copy = await screen.findByText('Copy selected text');
    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('cde')
    );
  });

  it('file message: Copy filename copies the decrypted filename', async () => {
    renderBubble(fileMsg);
    openMenu(screen.getByText('report.pdf'));
    const copy = await screen.findByText('Copy filename');
    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('report.pdf')
    );
  });

  it('Save as… is always offered for attachments (falls back to download without the picker)', async () => {
    const w = window as unknown as { showSaveFilePicker?: unknown };
    delete w.showSaveFilePicker;
    renderBubble(fileMsg);
    openMenu(screen.getByText('report.pdf'));
    expect(await screen.findByText('Save as…')).toBeDefined();

    w.showSaveFilePicker = vi.fn();
    renderBubble(fileMsg);
    openMenu(screen.getAllByText('report.pdf')[0]);
    expect(await screen.findByText('Save as…')).toBeDefined();
  });

  it('Select enters selection mode with the message pre-selected', async () => {
    renderBubble(textMsg);
    openMenu(screen.getByText('abcdefg'));
    fireEvent.click(await screen.findByText('Select'));
    const s = useSelectionStore.getState();
    expect(s.active).toBe(true);
    expect(s.selectedIds.has('m-text')).toBe(true);
  });

  it('delete opens the confirm dialog (never window.confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderBubble(textMsg);
    openMenu(screen.getByText('abcdefg'));
    fireEvent.click(await screen.findByText('Delete'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete this message?')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('selection mode click toggles selection instead of opening menus', () => {
    const toggle = vi.fn();
    renderBubble(textMsg, { selectionMode: true, selected: true, onToggleSelect: toggle });
    fireEvent.click(screen.getByText('abcdefg'));
    expect(toggle).toHaveBeenCalled();
  });
});
