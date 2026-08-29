import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { useSelectionStore } from '../../stores/selection';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { decryptedCache } from '../../lib/decryptedCache';
import { imagePreviewCache } from '../../lib/imagePreviewCache';
import { Trash2, X } from 'lucide-react';
import styles from './SelectionPlate.module.scss';

// Telegram-style selection action plate: replaces the composer while
// messages are selected. Delete is a single transaction + one realtime
// broadcast (messages.deleted).
export function SelectionPlate() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const exit = useSelectionStore((s) => s.exit);
  const clear = useSelectionStore((s) => s.clear);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const count = selectedIds.size;

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => messagesApi.batchDelete(ids),
    onSuccess: (_, ids) => {
      // Update in-memory caches.
      decryptedCache.deleteMany(ids);
      for (const id of ids) imagePreviewCache.delete(id);
      queryClient.setQueryData(messageKeys.infinite, (old: unknown) =>
        removeIdsFromPages(old as { pages: { messages: { id: string }[] }[] }, ids)
      );
      queryClient.invalidateQueries({ queryKey: messageKeys.latest });
      clear();
      exit();
    },
  });

  const handleDelete = () => setConfirmOpen(true);
  const confirmDelete = () => {
    deleteMutation.mutate([...selectedIds]);
    setConfirmOpen(false);
  };

  return (
    <div className={styles.plate}>
      <div className={styles.inner}>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={handleDelete}
          disabled={count === 0 || deleteMutation.isPending}
          aria-label="Delete selected"
        >
          <Trash2 size={22} />
        </button>
        <div className={styles.count}>{count} selected</div>
        <button
          className={styles.actionBtn}
          onClick={exit}
          aria-label="Cancel selection"
        >
          <X size={22} />
        </button>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={count === 1 ? 'Delete this message?' : `Delete ${count} messages?`}
          message="This will permanently delete the selected messages and files."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function removeIdsFromPages(
  data: { pages: { messages: { id: string }[] }[] },
  ids: string[]
): unknown {
  const idSet = new Set(ids);
  if (!data?.pages) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.filter((m) => !idSet.has(m.id)),
    })),
  };
}
