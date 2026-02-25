import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useChatStore } from '../stores/chatStore.ts';
import MessageList from './MessageList.tsx';
import ChatInput from './ChatInput.tsx';
import Sidebar from './Sidebar.tsx';
import type { AttachedContext } from './ChatInput.tsx';
import styles from '../styles/ChatView.module.css';

export default function ChatView() {
  const { chatId } = useParams<{ chatId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentChat, loadChat, createChat, clearCurrentChat, loadAllChats, loadAllMarkers } = useChatStore();

  const targetMsgIdx = searchParams.get('msgIdx');
  const autoSend = searchParams.get('autoSend') === '1';
  const scrolledRef = useRef(false);

  // Drag-drop state (lifted from ChatInput so drop area covers full chat)
  const [attachedContexts, setAttachedContexts] = useState<AttachedContext[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (chatId === 'new') {
      createChat().then((chat) => {
        navigate(`/chat/${chat.id}`, { replace: true });
      });
    } else if (chatId) {
      loadChat(chatId);
    }
    // Load global data for cross-chat discovery
    loadAllChats();
    loadAllMarkers();
    // Reset scroll flag when chat changes
    scrolledRef.current = false;

    return () => {
      clearCurrentChat();
    };
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to marker on initial load only — then clear the param
  useEffect(() => {
    if (!currentChat || !targetMsgIdx || scrolledRef.current) return;
    scrolledRef.current = true;

    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${targetMsgIdx}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('marker-highlighted');
        void el.offsetWidth;
        el.classList.add('marker-highlighted');
      }
      // Clear msgIdx so it doesn't interfere with normal chatting
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('msgIdx');
        next.delete('marker');
        return next;
      }, { replace: true });
    }, 100);

    return () => clearTimeout(timer);
  }, [currentChat, targetMsgIdx, setSearchParams]);

  // Drag handlers for full-screen drop area
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/tom-marker')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only leave when actually exiting the main area (not entering children)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData('application/tom-marker');
    if (!data) return;
    try {
      const marker = JSON.parse(data) as { id: string; label: string; extendedContext: string; chatId: string };
      setAttachedContexts((prev) => {
        if (prev.some((c) => c.id === marker.id)) return prev;
        return [...prev, {
          id: marker.id,
          label: marker.label,
          context: marker.extendedContext,
        }];
      });
    } catch {
      // Ignore invalid data
    }
  }, []);

  const removeContext = useCallback((id: string) => {
    setAttachedContexts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  if (!currentChat) {
    return (
      <div className={styles.layout}>
        <div className={styles.header} />
        <div className={styles.body}>
          <div className={styles.main} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <button
          className={styles.homeBtn}
          onClick={() => navigate('/')}
          title="Home"
        >
          &#8962;
        </button>
        <span className={styles.title}>
          {currentChat.title || 'New conversation'}
        </span>
      </header>

      <div className={styles.body}>
        <Sidebar />
        <div
          className={styles.main}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className={styles.dropOverlay}>
              <div className={styles.dropOverlayInner}>
                Drop to add context to chat
              </div>
            </div>
          )}
          <MessageList />
          <ChatInput
            autoSend={autoSend}
            attachedContexts={attachedContexts}
            onRemoveContext={removeContext}
            onClearContexts={() => setAttachedContexts([])}
          />
        </div>
      </div>
    </div>
  );
}
