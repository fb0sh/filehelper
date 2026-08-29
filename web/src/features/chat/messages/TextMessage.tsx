import { DecryptedMessage } from '../../../lib/crypto/messages';
import { formatMessageTime } from '../../../lib/dates';
import { SearchHighlightedText } from '../../search/SearchHighlightedText';
import styles from './TextMessage.module.scss';

interface Props {
  message: DecryptedMessage;
  /** When provided (search open), matching terms get highlighted. */
  searchQuery?: string;
}

export function TextMessage({ message, searchQuery }: Props) {
  return (
    <div className={styles.bubble}>
      <div className={styles.text}>
        {searchQuery ? (
          <SearchHighlightedText text={message.text ?? ''} query={searchQuery} />
        ) : (
          message.text
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.time}>{formatMessageTime(message.createdAt)}</span>
        <span className={styles.check}>✓</span>
      </div>
    </div>
  );
}
