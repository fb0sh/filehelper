import { DecryptedMessage } from '../../../lib/crypto/messages';
import { formatMessageTime } from '../../../lib/dates';
import { formatBytes } from '../../../lib/bytes';
import { useEffect, useRef, useState } from 'react';
import { MediaViewer } from '../../viewer/MediaViewer';
import { canPreviewImage, loadImagePreview, ImageNotPreviewableError } from '../../../lib/imagePreview';
import { imagePreviewCache } from '../../../lib/imagePreviewCache';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import { Download } from 'lucide-react';
import styles from './ImageMessage.module.scss';

interface Props {
  message: DecryptedMessage;
  onDownload: () => void;
  /** When provided (search open), matching filename terms get highlighted. */
  searchQuery?: string;
}

type PreviewState =
  | { state: 'hidden' } // not yet near viewport
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'error' }
  | { state: 'invalid' }; // decrypted, but not a safe raster image

// Images preview only after decrypt + magic validation, lazily when the
// bubble approaches the viewport (IntersectionObserver). SVG and
// oversized images are never previewed.
export function ImageMessage({ message, onDownload, searchQuery }: Props) {
  const att = message.attachment;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewState>({ state: 'hidden' });
  const [viewerOpen, setViewerOpen] = useState(false);
  const loadedRef = useRef(false);

  const previewable = att ? canPreviewImage(att) : false;

  useEffect(() => {
    if (!att || !previewable || loadedRef.current) return;
    // Cache hit → show instantly.
    const cached = imagePreviewCache.get(att.id);
    if (cached) {
      loadedRef.current = true;
      setPreview({ state: 'ready', url: cached });
      return;
    }

    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          loadedRef.current = true;
          setPreview({ state: 'loading' });
          loadImagePreview(att)
            .then((url) => setPreview({ state: 'ready', url }))
            .catch((e) =>
              setPreview(
                e instanceof ImageNotPreviewableError
                  ? { state: 'invalid' }
                  : { state: 'error' }
              )
            );
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [att, previewable]);

  if (!att) return null;

  // Not previewable (SVG / wrong mime / too large) → plain file card.
  if (!previewable || preview.state === 'invalid') {
    return (
      <div className={styles.card} onClick={onDownload} data-file-card="">
        <div className={styles.cardIcon}>
          <Download size={18} />
        </div>
        <div className={styles.cardInfo}>
          <div className={styles.cardName}>
            {searchQuery ? (
              <SearchHighlightedText text={att.filename} query={searchQuery} />
            ) : (
              att.filename
            )}
          </div>
          <div className={styles.cardSize}>
            {att.size > 64 * 1024 * 1024
              ? 'Image too large to preview'
              : formatBytes(att.size)}
          </div>
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
          <span className={styles.check}>✓</span>
        </div>
      </div>
    );
  }

  const openViewer = () => {
    if (preview.state === 'ready') setViewerOpen(true);
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={styles.bubble}
        onClick={openViewer}
        data-image-message=""
      >
        <div className={styles.imageWrapper}>
          {preview.state === 'ready' ? (
            <img src={preview.url} alt={att.filename} className={styles.image} />
          ) : preview.state === 'error' ? (
            <div className={styles.previewError}>Unable to decrypt this image</div>
          ) : (
            <div className={styles.placeholder}>
              {preview.state === 'loading' ? 'Decrypting…' : ''}
            </div>
          )}
          <div className={styles.overlay}>
            <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
            <span className={styles.check}>✓</span>
          </div>
        </div>
        {message.text && (
          <div className={styles.caption} data-caption="">
            {searchQuery ? (
              <SearchHighlightedText text={message.text} query={searchQuery} />
            ) : (
              message.text
            )}
          </div>
        )}
      </div>
      {viewerOpen && preview.state === 'ready' && (
        <MediaViewer
          url={preview.url}
          filename={att.filename}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </>
  );
}
