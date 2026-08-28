import { useEffect } from 'react';
import { useUploadStore } from '../stores/upload';

export function useGlobalPaste() {
  const addTasks = useUploadStore((s) => s.addTasks);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Only handle paste when not in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        addTasks(files);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addTasks]);
}