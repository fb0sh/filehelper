import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageBubble } from '../features/chat/messages/MessageBubble';
import { Message } from '../api';

function fileMessage(): Message {
  return {
    id: 'm-file',
    kind: 'document',
    text: null,
    createdAt: new Date().toISOString(),
    attachment: {
      id: 'att-1',
      filename: 'project.zip',
      mimeType: 'application/zip',
      size: 12345,
      sha256: 'abc',
      contentUrl: '/api/v1/files/att-1/content',
      downloadUrl: '/api/v1/files/att-1/download',
    },
  };
}

function textMessage(): Message {
  return {
    id: 'm-text',
    kind: 'text',
    text: 'hello',
    createdAt: new Date().toISOString(),
    attachment: null,
  };
}

function renderBubble(msg: Message) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MessageBubble message={msg} />
    </QueryClientProvider>
  );
  return utils;
}

function openMenu() {
  fireEvent.contextMenu(screen.getByText(/project\.zip|hello/));
}

describe('context menu save-as capability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).showSaveFilePicker;
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, body: null })));
  });

  it('shows Save as… when showSaveFilePicker is supported', () => {
    (window as any).showSaveFilePicker = vi.fn();
    renderBubble(fileMessage());
    openMenu();
    expect(screen.getByText('Download')).toBeDefined();
    expect(screen.getByText('Save as…')).toBeDefined();
  });

  it('calls showSaveFilePicker with the attachment filename on click', () => {
    const picker = vi.fn(async () => ({
      createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn(), abort: vi.fn() })),
    }));
    (window as any).showSaveFilePicker = picker;
    renderBubble(fileMessage());
    openMenu();
    fireEvent.click(screen.getByText('Save as…'));
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'project.zip' });
  });

  it('hides Save as… when showSaveFilePicker is unsupported', () => {
    delete (window as any).showSaveFilePicker;
    renderBubble(fileMessage());
    openMenu();
    expect(screen.getByText('Download')).toBeDefined();
    expect(screen.queryByText('Save as…')).toBeNull();
  });

  it('text messages show Copy and Delete only', () => {
    (window as any).showSaveFilePicker = vi.fn();
    renderBubble(textMessage());
    openMenu();
    expect(screen.getByText('Copy')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.queryByText('Save as…')).toBeNull();
  });

  it('Delete is rendered with the danger class', () => {
    (window as any).showSaveFilePicker = vi.fn();
    renderBubble(textMessage());
    openMenu();
    const del = screen.getByText('Delete').closest('button') as HTMLElement;
    expect(del.className).toContain('danger');
  });
});