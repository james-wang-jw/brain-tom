import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../stores/chatStore.ts';
import MessageBubble from './MessageBubble.tsx';
import styles from '../styles/MessageList.module.css';
import bubbleStyles from '../styles/MessageBubble.module.css';

export default function MessageList() {
  const { currentChat, markers, streamingContent, isStreaming } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const messages = currentChat?.messages || [];
  const markerByIndex = new Map(markers.map((m) => [m.messageIndex, m]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingContent]);

  return (
    <div className={styles.container} ref={containerRef} id="message-list">
      <div className={styles.inner}>
        {messages.length === 0 && !isStreaming && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>&#128172;</div>
            <div className={styles.emptyText}>Start a conversation</div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            messageIndex={idx}
            marker={markerByIndex.get(idx)}
          />
        ))}

        {isStreaming && streamingContent && (
          <div style={{ marginBottom: 24 }} id={`msg-${messages.length}`}>
            <div className={`${bubbleStyles.assistantCard} markdown-content`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
