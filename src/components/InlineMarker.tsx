import { useState, useCallback } from 'react';
import type { TOMMarker } from '../types/index.ts';
import { useChatStore } from '../stores/chatStore.ts';
import styles from '../styles/InlineMarker.module.css';

interface Props {
  marker: TOMMarker;
}

export default function InlineMarker({ marker }: Props) {
  const { deleteMarker, editMarkerLabel } = useChatStore();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(marker.label);

  const handleStartEdit = useCallback(() => {
    setEditValue(marker.label);
    setEditing(true);
  }, [marker.label]);

  const handleSaveEdit = useCallback(() => {
    if (editValue.trim() && editValue.trim() !== marker.label) {
      editMarkerLabel(marker.id, editValue.trim());
    }
    setEditing(false);
  }, [editValue, marker.id, marker.label, editMarkerLabel]);

  const handleDelete = useCallback(() => {
    deleteMarker(marker.id);
  }, [marker.id, deleteMarker]);

  return (
    <div className={styles.marker} id={`marker-${marker.id}`}>
      <span className={styles.icon}>#</span>

      {editing ? (
        <input
          className={styles.labelInput}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={handleSaveEdit}
          maxLength={60}
          autoFocus
        />
      ) : (
        <span className={styles.label} onClick={handleStartEdit} title="Click to edit">
          {marker.label}
        </span>
      )}

      <button className={styles.deleteBtn} onClick={handleDelete} title="Delete marker">
        &#10005;
      </button>
    </div>
  );
}
