import { useEffect, useCallback, useState } from 'react';
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import styles from './MediaViewer.module.scss';

interface Props {
  url: string;
  filename: string;
  onClose: () => void;
}

export function MediaViewer({ url, filename, onClose }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(3, z + (e.deltaY > 0 ? -0.2 : 0.2))));
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.header}>
        <span className={styles.filename}>{filename}</span>
        <div className={styles.actions}>
          <button className={styles.btn} onClick={() => setZoom((z) => Math.min(3, z + 0.2))} aria-label="Zoom in">
            <ZoomIn size={20} />
          </button>
          <button className={styles.btn} onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} aria-label="Zoom out">
            <ZoomOut size={20} />
          </button>
          <a className={styles.btn} href={url} download={filename} aria-label="Download">
            <Download size={20} />
          </a>
          <button className={styles.btn} onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className={styles.content} onClick={(e) => e.stopPropagation()} onWheel={handleWheel}>
        <img
          src={url}
          alt={filename}
          className={styles.image}
          style={{ transform: `scale(${zoom})` }}
        />
      </div>
    </div>
  );
}