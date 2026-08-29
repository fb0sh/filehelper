import { DecryptedMessage } from '../../../lib/crypto/messages';
import { formatMessageTime } from '../../../lib/dates';
import { formatBytes } from '../../../lib/bytes';
import { getFileIconLabel, getFileIconColor } from '../../../lib/mime';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import { Download, Film, Music } from 'lucide-react';
import styles from './FileMessage.module.scss';

interface Props {
  message: DecryptedMessage;
  onDownload: () => void;
  /** When provided (search open), matching filename terms get highlighted. */
  searchQuery?: string;
}

// One unified file card for everything that is not a previewable image:
// video (never previewed), audio (never played), PDF/zip/documents.
export function FileMessage({ message, onDownload, searchQuery }: Props) {
  const att = message.attachment;
  if (!att) return null;

  const mime = att.mime.toLowerCase();
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const label = isVideo ? 'VIDEO' : isAudio ? 'AUDIO' : getFileIconLabel(att.filename);
  const color = isVideo ? '#5c6bc0' : isAudio ? '#26a69a' : getFileIconColor(label);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload();
  };

  return (
    <div className={styles.bubble} onClick={handleClick} data-file-card="">
      <div className={styles.icon} style={{ background: color }}>
        {isVideo ? <Film size={20} className={styles.iconGlyph} /> : isAudio ? <Music size={20} className={styles.iconGlyph} /> : (
          <span className={styles.iconLabel}>{label}</span>
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.filename}>
          {searchQuery ? (
            <SearchHighlightedText text={att.filename} query={searchQuery} />
          ) : (
            att.filename
          )}
        </div>
        <div className={styles.size}>
          {formatBytes(att.size)}
          {isVideo && <span className={styles.kindTag}>video</span>}
        </div>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.downloadBtn}
          onClick={handleClick}
          data-download-button=""
          aria-label="Download"
        >
          <Download size={18} />
        </button>
        <div className={styles.meta}>
          <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
          <span className={styles.check}>✓</span>
        </div>
      </div>
    </div>
  );
}
