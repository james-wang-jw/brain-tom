import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, TOMMarker } from '../types/index.ts';
import { useChatStore } from '../stores/chatStore.ts';
import { nanoid } from 'nanoid';
import InlineMarker from './InlineMarker.tsx';
import styles from '../styles/MessageBubble.module.css';

interface Props {
  message: Message;
  messageIndex: number;
  marker?: TOMMarker;
}

export default function MessageBubble({ message, messageIndex, marker }: Props) {
  const { currentChat, addMarker } = useChatStore();
  const [addingMarker, setAddingMarker] = useState(false);
  const [manualLabel, setManualLabel] = useState('');

  const handleAddMarker = useCallback(() => {
    setAddingMarker(true);
  }, []);

  const handleSaveManualMarker = useCallback(() => {
    if (!manualLabel.trim() || !currentChat) return;
    const prevMsg = currentChat.messages[messageIndex - 1];
    const extendedContext = prevMsg
      ? `User: ${prevMsg.content}\nAssistant: ${message.content}`
      : message.content;

    addMarker({
      id: nanoid(),
      label: manualLabel.trim(),
      extendedContext: extendedContext.slice(0, 500),
      timestamp: Date.now(),
      chatId: currentChat.id,
      messageIndex,
    });
    setManualLabel('');
    setAddingMarker(false);
  }, [manualLabel, currentChat, messageIndex, message.content, addMarker]);

  if (message.role === 'user') {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        <div className={styles.userBubble}>{message.content}</div>
      </div>
    );
  }

  return (
    <div className={`${styles.message} ${styles.assistant}`} id={`msg-${messageIndex}`}>
      <div className={`${styles.assistantCard} markdown-content`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>

      {marker && <InlineMarker marker={marker} />}

      {!marker && !addingMarker && (
        <button className={styles.addMarkerBtn} onClick={handleAddMarker}>
          + Add marker
        </button>
      )}

      {addingMarker && !marker && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveManualMarker();
              if (e.key === 'Escape') setAddingMarker(false);
            }}
            placeholder="Describe this moment..."
            maxLength={60}
            autoFocus
            style={{ fontSize: 13, padding: '4px 8px', width: 260 }}
          />
          <button
            onClick={handleSaveManualMarker}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: 'var(--accent)',
              color: 'white',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            Save
          </button>
          <button
            onClick={() => setAddingMarker(false)}
            style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 8px' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
