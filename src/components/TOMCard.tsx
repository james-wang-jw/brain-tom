import type { TOMMarker } from '../types/index.ts';
import styles from '../styles/TOMCard.module.css';

interface Props {
  marker: TOMMarker;
  chatTitle?: string;
  reason?: string;
  onClick: () => void;
  onDelete?: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TOMCard({ marker, chatTitle, reason, onClick, onDelete }: Props) {
  return (
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <span className={styles.icon}>#</span>
      <div className={styles.body}>
        <div className={styles.label}>{marker.label}</div>
        {chatTitle && <div className={styles.meta}>in {chatTitle}</div>}
        <div className={styles.date}>{formatDate(marker.timestamp)}</div>
        {reason && <div className={styles.reason}>{reason}</div>}
      </div>
      {onDelete && (
        <button
          className={styles.deleteBtn}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete marker"
        >
          &#10005;
        </button>
      )}
    </div>
  );
}
