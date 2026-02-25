import { useEffect, useRef, useState, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore.ts';
import MessageList from './MessageList.tsx';
import ChatInput from './ChatInput.tsx';
import type { AttachedContext } from './ChatInput.tsx';
import styles from '../styles/ChatSheet.module.css';

export type SheetState = 'closed' | 'half' | 'full';

interface ChatSheetProps {
  chatId: string | null;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  attachedContexts: AttachedContext[];
  onRemoveContext: (id: string) => void;
  onClearContexts: () => void;
  autoSend?: boolean;
}

// Map sheet state to height as percentage of viewport
function stateToHeight(state: SheetState): number {
  switch (state) {
    case 'closed': return 0;
    case 'half': return 55;
    case 'full': return 100;
  }
}

export default function ChatSheet({
  chatId,
  state,
  onStateChange,
  attachedContexts,
  onRemoveContext,
  onClearContexts,
  autoSend,
}: ChatSheetProps) {
  const { currentChat, loadChat, loadAllChats, loadAllMarkers, clearCurrentChat } = useChatStore();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number; time: number } | null>(null);

  // Drop state
  const [dragOver, setDragOver] = useState(false);

  // Load chat when chatId changes
  useEffect(() => {
    if (chatId) {
      loadChat(chatId);
      loadAllChats();
      loadAllMarkers();
    } else {
      clearCurrentChat();
    }
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the pointer actually moved during this gesture
  const didDrag = useRef(false);

  // --- Drag handle ---
  const handleHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const height = stateToHeight(state);
    dragStart.current = { y: e.clientY, height, time: Date.now() };
    didDrag.current = false;
    setIsDragging(true);
    // Set dragHeight immediately to current state height so the inline style is always present
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

    // If pointer didn't actually move, just stay in current state (tap = no-op)
    if (!didDrag.current) {
      dragStart.current = null;
      setIsDragging(false);
      setDragHeight(null);
      return;
    }

    const dt = Date.now() - dragStart.current.time;
    // Compute velocity from actual pointer movement
    const currentHeight = dragHeight ?? stateToHeight(state);
    const heightDelta = currentHeight - stateToHeight(state);
    const velocity = -heightDelta / Math.max(dt, 1); // positive = growing (swiped up)

    let targetState: SheetState;

    if (Math.abs(velocity) > 0.3) {
      // Fast swipe
      if (velocity < 0) {
        // Swiped down
        targetState = state === 'full' ? 'half' : 'closed';
      } else {
        // Swiped up
        targetState = state === 'half' ? 'full' : 'half';
      }
    } else {
      // Snap to nearest state by height
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

  // --- Drop zone for marker drag ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/tom-marker')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData('application/tom-marker');
    if (!data) return;
    try {
      const marker = JSON.parse(data) as { id: string; label: string; extendedContext: string };
      const existing = attachedContexts.some((c) => c.id === marker.id);
      if (!existing) {
        window.dispatchEvent(new CustomEvent('tom-attach-context', {
          detail: { id: marker.id, label: marker.label, context: marker.extendedContext },
        }));
      }
    } catch {
      // Ignore
    }
  }, [attachedContexts]);

  const handleClose = useCallback(() => {
    onStateChange('closed');
  }, [onStateChange]);

  // Compute inline style for drag
  const sheetStyle: React.CSSProperties = {};
  if (isDragging && dragHeight !== null) {
    sheetStyle.height = `${dragHeight}dvh`;
  }

  return (
    <div
      ref={sheetRef}
      className={`${styles.sheet} ${isDragging ? styles.dragging : ''}`}
      data-state={isDragging ? undefined : state}
      style={sheetStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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

      {/* Chat header */}
      {currentChat && (
        <div className={styles.chatHeader}>
          <span className={styles.chatTitle}>
            {currentChat.title || 'New conversation'}
          </span>
          <button className={styles.closeBtn} onClick={handleClose} title="Close">
            &#10005;
          </button>
        </div>
      )}

      {/* Content */}
      <div className={styles.content}>
        {chatId && currentChat && (
          <>
            <MessageList />
            <ChatInput
              autoSend={autoSend}
              attachedContexts={attachedContexts}
              onRemoveContext={onRemoveContext}
              onClearContexts={onClearContexts}
            />
          </>
        )}
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div className={styles.dropOverlay}>
          <span className={styles.dropOverlayText}>Drop to add context to chat</span>
        </div>
      )}
    </div>
  );
}
