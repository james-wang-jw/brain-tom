import type { TOMMarker } from '../types/index.ts';
import styles from '../styles/CrossChatMarker.module.css';

interface Props {
  marker: TOMMarker;
  chatTitle: string;
  reason?: string;
  active?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

export default function CrossChatMarker({
  marker,
  chatTitle,
  reason,
  active,
  onClick,
  onDoubleClick,
  onDragStart,
}: Props) {
  return (
    <button
      className={`${styles.marker} ${active ? styles.active : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable
      onDragStart={onDragStart}
    >
      <span className={styles.icon}>#</span>
      <div className={styles.body}>
        <div className={styles.label}>{marker.label}</div>
        <div className={styles.chatName}>in {chatTitle}</div>
        {reason && <div className={styles.reason}>{reason}</div>}
      </div>
    </button>
  );
}
