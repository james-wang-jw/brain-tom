import { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, TOMMarker } from '../types/index.ts';
import { useChatStore } from '../stores/chatStore.ts';
import { doSend } from './ChatInput.tsx';
import { nanoid } from 'nanoid';
import InlineMarker from './InlineMarker.tsx';
import styles from '../styles/MessageBubble.module.css';

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  message: Message;
  messageIndex: number;
  marker?: TOMMarker;
}

export default function MessageBubble({ message, messageIndex, marker }: Props) {
  const { currentChat, addMarker, replaceMessages } = useChatStore();
  const [addingMarker, setAddingMarker] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && editRef.current) {
      const el = editRef.current;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

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

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

  const handleRetry = useCallback(async () => {
    if (!currentChat) return;
    const messages = currentChat.messages;
    // Truncate to everything before this assistant message
    const truncated = messages.slice(0, messageIndex);
    // Find the user message just before
    const userMsg = truncated[truncated.length - 1];
    if (!userMsg || userMsg.role !== 'user') return;
    const userText = userMsg.content;
    // Remove the user message too — doSend will re-add it
    await replaceMessages(truncated.slice(0, -1));
    await doSend(userText);
  }, [currentChat, messageIndex, replaceMessages]);

  const handleStartEdit = useCallback(() => {
    setEditText(message.content);
    setEditing(true);
  }, [message.content]);

  const handleSaveEdit = useCallback(async () => {
    if (!currentChat || !editText.trim()) return;
    const truncated = currentChat.messages.slice(0, messageIndex);
    await replaceMessages(truncated);
    await doSend(editText.trim());
    setEditing(false);
  }, [currentChat, messageIndex, editText, replaceMessages]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditText('');
  }, []);

  if (message.role === 'user') {
    return (
      <div className={`${styles.message} ${styles.user}`}>
        {editing ? (
          <>
            <textarea
              ref={editRef}
              className={styles.editTextarea}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                }
                if (e.key === 'Escape') handleCancelEdit();
              }}
            />
            <div className={styles.editActions}>
              <button className={styles.editSaveBtn} onClick={handleSaveEdit}>Save & Send</button>
              <button className={styles.editCancelBtn} onClick={handleCancelEdit}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.userBubble}>{message.content}</div>
            <div className={styles.messageActions} style={{ justifyContent: 'flex-end' }}>
              <span className={styles.timestamp}>{formatTime(message.timestamp)}</span>
              <button className={styles.actionBtn} onClick={handleStartEdit} title="Edit">&#9998;</button>
              <button className={styles.actionBtn} onClick={handleCopy} title="Copy">
                {copied ? 'Copied!' : '\u29C9'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.message} ${styles.assistant}`} id={`msg-${messageIndex}`}>
      <div className={`${styles.assistantCard} markdown-content`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>

      <div className={styles.messageActions}>
        <span className={styles.timestamp}>{formatTime(message.timestamp)}</span>
        <button className={styles.actionBtn} onClick={handleRetry} title="Retry">&#8635;</button>
        <button className={styles.actionBtn} onClick={handleCopy} title="Copy">
          {copied ? 'Copied!' : '\u29C9'}
        </button>
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
