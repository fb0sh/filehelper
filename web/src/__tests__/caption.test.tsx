import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { bytesToBase64url } from '../lib/crypto/encoding';
import { hexToBytes } from '../lib/crypto/core';
import {
  encryptMessagePayload,
  decryptEncryptedMessage,
  validateMessageSchema,
  type FilePlaintext,
  type DecryptedMessage,
} from '../lib/crypto/messages';
import { MAX_CAPTION_LEN } from '../lib/crypto/constants';
import { matchesQuery } from '../lib/clientSearch';
import { useUploadStore } from '../stores/upload';
import { AttachmentComposerModal } from '../features/attachment/AttachmentComposerModal';

const KEY = bytesToBase64url(hexToBytes('11'.repeat(32)));

function filePlaintext(overrides: Partial<FilePlaintext> = {}): FilePlaintext {
  return {
    attachmentId: 'att-1',
    filename: 'report.pdf',
    mime: 'application/pdf',
    size: 1024,
    sha256: 'a'.repeat(64),
    chunkSize: 8 * 1024 * 1024,
    noncePrefix: 'A'.repeat(22),
    chunkCount: 1,
    ...overrides,
  };
}

function decryptFile(payload: string) {
  const result = decryptEncryptedMessage(KEY, 'space-A', {
    id: 'm1',
    payload,
    createdAt: new Date().toISOString(),
    attachment: { id: 'att-1', ciphertextSize: 10, downloadUrl: '/api/v1/files/att-1/download' },
  });
  expect(result.ok).toBe(true);
  return result.ok ? result.message : null;
}

describe('attachment caption (schema + flow)', () => {
  it('roundtrips a caption inside the encrypted file envelope', () => {
    const payload = encryptMessagePayload(KEY, 'space-A', {
      type: 'file',
      file: filePlaintext({ caption: 'Final report — please review' }),
    });
    const msg = decryptFile(payload)!;
    expect(msg.type).toBe('file');
    expect(msg.text).toBe('Final report — please review');
    expect(msg.attachment?.filename).toBe('report.pdf');
  });

  it('supports Chinese and emoji captions', () => {
    const caption = '中文留言 🚀 请查收';
    const payload = encryptMessagePayload(KEY, 'space-A', {
      type: 'file',
      file: filePlaintext({ caption }),
    });
    expect(decryptFile(payload)!.text).toBe(caption);
  });

  it('leaves text undefined when no caption is set (backward compatible)', () => {
    const payload = encryptMessagePayload(KEY, 'space-A', {
      type: 'file',
      file: filePlaintext(),
    });
    const msg = decryptFile(payload)!;
    expect(msg.text).toBeUndefined();
    expect(msg.attachment?.filename).toBe('report.pdf');
  });

  it('old ciphertexts without caption still decrypt', () => {
    // Simulate a v1 payload produced before captions existed.
    const plaintext = {
      v: 1,
      type: 'file',
      attachmentId: 'att-old',
      filename: 'old.bin',
      mime: 'application/octet-stream',
      size: 5,
      sha256: 'b'.repeat(64),
      chunkSize: 8 * 1024 * 1024,
      noncePrefix: 'B'.repeat(22),
      chunkCount: 1,
    };
    const result = validateMessageSchema(plaintext);
    expect(result.ok).toBe(true);
  });

  it('rejects over-long and non-string captions', () => {
    const base = { v: 1, type: 'file', ...filePlaintext() } as Record<string, unknown>;
    expect(validateMessageSchema({ ...base, caption: 'x'.repeat(MAX_CAPTION_LEN + 1) }).ok).toBe(false);
    expect(validateMessageSchema({ ...base, caption: 42 }).ok).toBe(false);
    // valid caption passes
    expect(validateMessageSchema({ ...base, caption: 'ok' }).ok).toBe(true);
  });

  it('search matches the caption (text = caption) and highlights it', () => {
    const msg: DecryptedMessage = {
      id: 'm1',
      type: 'file',
      text: 'Quarterly numbers attached',
      createdAt: new Date().toISOString(),
      attachment: {
        id: 'att-1',
        filename: 'q1.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 10,
        sha256: 'c'.repeat(64),
        chunkSize: 8 * 1024 * 1024,
        chunkCount: 1,
        noncePrefix: 'C'.repeat(22),
        downloadUrl: '',
      },
    };
    expect(matchesQuery(msg, 'Quarterly')).toBe(true);
    expect(matchesQuery(msg, 'q1')).toBe(true); // filename still matches too
    expect(matchesQuery(msg, 'zzz')).toBe(false);
  });

  it('upload store carries the caption on each task', () => {
    useUploadStore.setState({ tasks: [], pending: null });
    useUploadStore.getState().addTasks([new File(['a'], 'a.png', { type: 'image/png' })], 'the caption');
    const tasks = useUploadStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].caption).toBe('the caption');
    expect(tasks[0].file.name).toBe('a.png');

    useUploadStore.setState({ tasks: [], pending: null });
    useUploadStore.getState().addTasks([new File(['b'], 'b.pdf')]);
    expect(useUploadStore.getState().tasks[0].caption).toBeUndefined();
  });
});

describe('AttachmentComposerModal', () => {
  beforeEach(() => {
    useUploadStore.setState({ tasks: [], pending: null });
    // jsdom lacks createObjectURL; the modal only uses it for image previews.
    (URL as unknown as { createObjectURL: (o: object) => string }).createObjectURL = () => 'blob:preview';
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  });

  afterEach(() => {
    useUploadStore.setState({ tasks: [], pending: null });
    vi.restoreAllMocks();
  });

  it('renders "Send File" for a plain file and sends with the caption', () => {
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    useUploadStore.setState({ pending: [file] });
    render(<AttachmentComposerModal />);
    expect(screen.getByRole('dialog', { name: 'Send File' })).toBeDefined();

    fireEvent.change(screen.getByLabelText('Add a caption'), {
      target: { value: 'My notes' },
    });
    fireEvent.click(screen.getByLabelText('Send file'));

    expect(useUploadStore.getState().pending).toBeNull();
    const tasks = useUploadStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].file.name).toBe('notes.pdf');
    expect(tasks[0].caption).toBe('My notes');
  });

  it('renders "Send Photo" for a single image and previews it', () => {
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    useUploadStore.setState({ pending: [file] });
    render(<AttachmentComposerModal />);
    expect(screen.getByRole('dialog', { name: 'Send Photo' })).toBeDefined();
    expect(screen.getByAltText('photo.png')).toBeDefined();
  });

  it('closes via X and clears pending without creating tasks', () => {
    useUploadStore.setState({ pending: [new File(['x'], 'a.bin')] });
    render(<AttachmentComposerModal />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(useUploadStore.getState().pending).toBeNull();
    expect(useUploadStore.getState().tasks).toHaveLength(0);
  });

  it('Esc closes the dialog', () => {
    useUploadStore.setState({ pending: [new File(['x'], 'a.bin')] });
    render(<AttachmentComposerModal />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUploadStore.getState().pending).toBeNull();
  });

  it('sends an empty caption as no caption', () => {
    useUploadStore.setState({ pending: [new File(['x'], 'a.bin')] });
    render(<AttachmentComposerModal />);
    fireEvent.click(screen.getByLabelText('Send file'));
    expect(useUploadStore.getState().tasks[0].caption).toBeUndefined();
  });
});
