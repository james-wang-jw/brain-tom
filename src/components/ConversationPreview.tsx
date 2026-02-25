import { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Chat, TOMMarker } from '../types/index.ts';
import * as db from '../db/index.ts';
import styles from '../styles/ConversationPreview.module.css';

interface Props {
  marker: TOMMarker;
  chatTitle: string;
  onNavigate: () => void;
  onClose: () => void;
}

export default function ConversationPreview({ marker, chatTitle, onNavigate, onClose }: Props) {
  const [chat, setChat] = useState<Chat | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.getChat(marker.chatId).then((c) => setChat(c || null));
  }, [marker.chatId]);

  // Scroll the highlighted message into view within the panel
  useEffect(() => {
    if (chat && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' });
    }
  }, [chat]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Delay listener to avoid the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  if (!chat) {
    return (
      <div className={styles.panel} ref={panelRef}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  // Show ~3 messages before and ~3 after the marker position
  const msgIdx = marker.messageIndex;
  const startIdx = Math.max(0, msgIdx - 3);
  const endIdx = Math.min(chat.messages.length, msgIdx + 4);
  const visibleMessages = chat.messages.slice(startIdx, endIdx);

  return (
    <div className={styles.panel} ref={panelRef}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>{chatTitle}</div>
        <button className={styles.closeBtn} onClick={onClose}>&#10005;</button>
      </div>
      <div className={styles.messages}>
        {startIdx > 0 && (
          <div className={styles.truncated}>... earlier messages</div>
        )}
        {visibleMessages.map((msg, i) => {
          const actualIdx = startIdx + i;
          const isHighlighted = actualIdx === msgIdx;
          return (
            <div
              key={msg.id}
              ref={isHighlighted ? highlightRef : undefined}
              className={`${styles.msg} ${msg.role === 'user' ? styles.msgUser : styles.msgAssistant} ${isHighlighted ? styles.msgHighlighted : ''}`}
            >
              <div className={styles.msgRole}>{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className={`${styles.msgContent} ${msg.role === 'assistant' ? 'markdown-content' : ''}`}>
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}
        {endIdx < chat.messages.length && (
          <div className={styles.truncated}>... more messages</div>
        )}
      </div>
      <div className={styles.footer}>
        <button className={styles.navigateBtn} onClick={onNavigate}>
          Open full conversation &#8594;
        </button>
      </div>
    </div>
  );
}
