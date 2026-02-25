import type { TOMMarker } from '../types/index.ts';
import styles from '../styles/SidebarMarker.module.css';

interface Props {
  marker: TOMMarker;
  active?: boolean;
  onClick: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SidebarMarker({ marker, active, onClick }: Props) {
  return (
    <button
      className={`${styles.marker} ${active ? styles.active : ''}`}
      onClick={onClick}
    >
      <span className={styles.icon}>#</span>
      <div className={styles.body}>
        <div className={styles.label}>{marker.label}</div>
        <div className={styles.time}>{formatTime(marker.timestamp)}</div>
      </div>
    </button>
  );
}
