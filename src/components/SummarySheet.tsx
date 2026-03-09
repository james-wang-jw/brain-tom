import { useState, useCallback, useRef, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore.ts';
import { getEmbedding, cosineSimilarity } from '../utils/embeddingStore.ts';
import { MARKER_SIMILARITY_THRESHOLD } from '../api/relevance.ts';
import type { SheetState } from './ChatSheet.tsx';
import type { TOMMarker, ClusterNode } from '../types/index.ts';
import styles from '../styles/SummarySheet.module.css';

interface SummarySheetProps {
  marker: TOMMarker | null;
  cluster: ClusterNode | null;
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  onOpenChat: (chatId: string) => void;
  onSelectMarker: (marker: TOMMarker) => void;
  allMarkers: TOMMarker[];
  chatTitleMap: Map<string, string>;
  synthesisText?: string | null;
  synthesisLoading?: boolean;
  onMarkerEdited?: (markerId: string) => void;
  onMarkerDeleted?: (markerId: string) => void;
}

function stateToHeight(state: SheetState): number {
  switch (state) {
    case 'closed': return 0;
    case 'half': return 55;
    case 'full': return 100;
  }
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function SummarySheet({
  marker,
  cluster,
  state,
  onStateChange,
  onOpenChat,
  onSelectMarker,
  allMarkers,
  chatTitleMap,
  synthesisText,
  synthesisLoading,
  onMarkerEdited,
  onMarkerDeleted,
}: SummarySheetProps) {
  const { editMarkerLabel, deleteMarker, loadAllMarkers } = useChatStore();

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number; time: number } | null>(null);
  const didDrag = useRef(false);

  // Edit state
  const [editingLabel, setEditingLabel] = useState(false);
  const [editValue, setEditValue] = useState('');

  // --- Drag handle ---
  const handleHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const height = stateToHeight(state);
    dragStart.current = { y: e.clientY, height, time: Date.now() };
    didDrag.current = false;
    setIsDragging(true);
    setDragHeight(height);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [state]);

  const handleHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dy) > 3) didDrag.current = true;
    const vh = window.innerHeight;
    const deltaPercent = (dy / vh) * 100;
    const newHeight = Math.max(0, Math.min(100, dragStart.current.height - deltaPercent));
    setDragHeight(newHeight);
  }, []);

  const handleHandlePointerUp = useCallback(() => {
    if (!dragStart.current) return;

    if (!didDrag.current) {
      dragStart.current = null;
      setIsDragging(false);
      setDragHeight(null);
      return;
    }

    const dt = Date.now() - dragStart.current.time;
    const currentHeight = dragHeight ?? stateToHeight(state);
    const heightDelta = currentHeight - stateToHeight(state);
    const velocity = -heightDelta / Math.max(dt, 1);

    let targetState: SheetState;

    if (Math.abs(velocity) > 0.3) {
      if (velocity < 0) {
        targetState = state === 'full' ? 'half' : 'closed';
      } else {
        targetState = state === 'half' ? 'full' : 'half';
      }
    } else {
      const states: SheetState[] = ['full', 'half', 'closed'];
      const targets = states.map((s) => ({ s, dist: Math.abs(currentHeight - stateToHeight(s)) }));
      targets.sort((a, b) => a.dist - b.dist);
      targetState = targets[0].s;
    }

    dragStart.current = null;
    setIsDragging(false);
    setDragHeight(null);
    onStateChange(targetState);
  }, [state, dragHeight, onStateChange]);

  // --- Related markers ---
  const relatedMarkers = useMemo(() => {
    if (!marker) return [];
    const emb = getEmbedding(marker.id);
    if (!emb) return [];

    console.group(`%c[Embedding Relevance] marker: "${marker.label}"`, 'color: #7c8aff; font-weight: bold');
    const scored: { marker: TOMMarker; score: number }[] = [];
    for (const m of allMarkers) {
      if (m.id === marker.id) continue;
      const vec = getEmbedding(m.id);
      if (!vec) {
        console.log(`  %c${m.label}%c — no embedding`, 'color: #f0a', 'color: #888');
        continue;
      }
      const sim = cosineSimilarity(emb, vec);
      const pass = sim >= MARKER_SIMILARITY_THRESHOLD;
      console.log(
        `  %c${m.label}%c — ${(sim * 100).toFixed(1)}%${pass ? ' ✓' : ''}`,
        'color: #f0a',
        pass ? 'color: #22c55e' : 'color: #888',
      );
      if (pass) scored.push({ marker: m, score: sim });
    }
    console.groupEnd();

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [marker, allMarkers]);

  // --- Cluster members ---
  const clusterMembers = useMemo(() => {
    if (!cluster) return [];
    const memberSet = new Set(cluster.memberIds);
    return allMarkers.filter((m) => memberSet.has(m.id));
  }, [cluster, allMarkers]);

  // --- Actions ---
  const handleClose = useCallback(() => {
    onStateChange('closed');
  }, [onStateChange]);

  const handleStartEdit = useCallback(() => {
    if (!marker) return;
    setEditValue(marker.label);
    setEditingLabel(true);
  }, [marker]);

  const handleSaveEdit = useCallback(async () => {
    if (!marker || !editValue.trim()) return;
    await editMarkerLabel(marker.id, editValue.trim());
    setEditingLabel(false);
    loadAllMarkers();
    onMarkerEdited?.(marker.id);
  }, [marker, editValue, editMarkerLabel, loadAllMarkers, onMarkerEdited]);

  const handleDelete = useCallback(async () => {
    if (!marker) return;
    const id = marker.id;
    await deleteMarker(id);
    loadAllMarkers();
    onMarkerDeleted?.(id);
    onStateChange('closed');
  }, [marker, deleteMarker, loadAllMarkers, onStateChange, onMarkerDeleted]);

  // Inline style for drag
  const sheetStyle: React.CSSProperties = {};
  if (isDragging && dragHeight !== null) {
    sheetStyle.height = `${dragHeight}dvh`;
  }

  return (
    <div
      className={`${styles.sheet} ${isDragging ? styles.dragging : ''}`}
      data-state={isDragging ? undefined : state}
      style={sheetStyle}
    >
      {/* Drag handle */}
      <div
        className={styles.handle}
        onPointerDown={handleHandlePointerDown}
        onPointerMove={handleHandlePointerMove}
        onPointerUp={handleHandlePointerUp}
        onPointerCancel={handleHandlePointerUp}
      >
        <div className={styles.handlePill} />
      </div>

      {/* --- Marker view --- */}
      {marker && !cluster && (
        <>
          {/* Centered header with label + meta */}
          <div className={styles.markerHeader}>
            <div className={styles.label}>{marker.label}</div>
            <div className={styles.meta}>
              {chatTitleMap.get(marker.chatId) || 'Chat'} &middot; {formatTime(marker.timestamp)}
            </div>
            <button className={styles.closeBtn} onClick={handleClose} title="Close">
              &#10005;
            </button>
          </div>

          {/* Big CTA button */}
          <div className={styles.ctaRow}>
            <button
              className={styles.openChatBtn}
              onClick={() => onOpenChat(marker.chatId)}
            >
              <span className={styles.ctaIcon}>&#128488;</span>
              Open Chat
            </button>
          </div>

          {/* Synthesis text */}
          {synthesisLoading && (
            <div className={styles.synthesisShimmer}>
              <div className={styles.shimmer} />
              <div className={styles.shimmer} style={{ width: '70%' }} />
            </div>
          )}
          {!synthesisLoading && synthesisText && (
            <div className={styles.synthesisText}>{synthesisText}</div>
          )}

          {/* Scrollable body */}
          <div className={styles.body}>
            {relatedMarkers.length > 0 && (
              <>
                <div className={styles.divider} />
                <div className={styles.sectionTitle}>Related</div>
                <div className={styles.relatedScroll}>
                  {relatedMarkers.map(({ marker: rm }) => (
                    <div
                      key={rm.id}
                      className={styles.relatedCard}
                      onClick={() => onSelectMarker(rm)}
                    >
                      <div className={styles.relatedLabel}>{rm.label}</div>
                      <div className={styles.relatedChat}>
                        {chatTitleMap.get(rm.chatId) || 'Chat'}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {marker.extendedContext && (
              <>
                <div className={styles.divider} />
                <div className={styles.descriptionMuted}>{marker.extendedContext}</div>
              </>
            )}

            <div className={styles.divider} />
            <div className={styles.actions}>
              {editingLabel ? (
                <input
                  className={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingLabel(false); }}
                  autoFocus
                />
              ) : (
                <button className={styles.editBtn} onClick={handleStartEdit}>
                  Edit label
                </button>
              )}
              <button className={styles.deleteBtn} onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </>
      )}

      {/* --- Cluster view --- */}
      {cluster && !marker && (
        <>
          {/* Centered header matching marker view */}
          <div className={styles.markerHeader}>
            <div className={styles.label}>{cluster.label}</div>
            <div className={styles.meta}>
              {cluster.memberIds.length} marker{cluster.memberIds.length !== 1 ? 's' : ''}
            </div>
            <button className={styles.closeBtn} onClick={handleClose} title="Close">
              &#10005;
            </button>
          </div>

          {/* Scrollable body */}
          <div className={styles.body}>
            <div className={styles.sectionTitle}>Members</div>
            <div className={styles.relatedScroll}>
              {clusterMembers.map((m) => (
                <div
                  key={m.id}
                  className={styles.relatedCard}
                  onClick={() => onSelectMarker(m)}
                >
                  <div className={styles.relatedLabel}>{m.label}</div>
                  <div className={styles.relatedChat}>
                    {chatTitleMap.get(m.chatId) || 'Chat'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
