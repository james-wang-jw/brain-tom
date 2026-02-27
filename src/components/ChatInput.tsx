import { useState, useRef, useCallback, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { useChatStore } from '../stores/chatStore.ts';
import { streamChat, parseTOMTag } from '../api/chat.ts';
import type { Message } from '../types/index.ts';
import styles from '../styles/ChatInput.module.css';

export interface AttachedContext {
  id: string;
  label: string;
  context: string;
}

function buildMarkerHistory(markers: { label: string; extendedContext: string; messageIndex: number }[]) {
  return markers.map((m) => ({ label: m.label, context: m.extendedContext, messageIndex: m.messageIndex }));
}

function getLastMarker(markers: { id: string; label: string; extendedContext: string; messageIndex: number }[]) {
  if (markers.length === 0) return null;
  return [...markers].sort((a, b) => b.messageIndex - a.messageIndex)[0];
}

function buildContextPrefix(contexts: AttachedContext[]): string {
  if (contexts.length === 0) return '';
  const parts = contexts.map(
    (c) => `[Attached context: "${c.label}"]\n${c.context}`,
  );
  return parts.join('\n\n') + '\n\n---\n\n';
}

export async function doSend(text: string, attachedContexts: AttachedContext[] = []) {
  const state = useChatStore.getState();
  const { currentChat, markers } = state;
  if (!text || state.isStreaming || !currentChat) return;

  // Build the full message content with attached contexts
  const contextPrefix = buildContextPrefix(attachedContexts);
  const fullContent = contextPrefix + text;

  const userMsg: Message = {
    id: nanoid(),
    role: 'user',
    content: fullContent,
    timestamp: Date.now(),
  };
  await state.addMessage(userMsg);

  if (currentChat.messages.length === 0) {
    const title = text.length > 50 ? text.slice(0, 47) + '...' : text;
    await state.updateChatTitle(title);
  }

  const allMessages = [...currentChat.messages, userMsg];

  const markerCount = markers.length;
  const lastMarkerMsgIdx = markers.length > 0
    ? Math.max(...markers.map((m) => m.messageIndex))
    : -1;
  const messagesSinceLastMarker = lastMarkerMsgIdx >= 0
    ? allMessages.length - 1 - lastMarkerMsgIdx
    : allMessages.length;
  const markerHistory = buildMarkerHistory(markers);
  const lastMarkerObj = getLastMarker(markers);

  state.setIsStreaming(true);
  state.setStreamingContent('');

  const chatId = currentChat.id;

  await streamChat(
    allMessages,
    markerCount,
    messagesSinceLastMarker,
    markerHistory,
    (fullText) => {
      const { content } = parseTOMTag(fullText);
      useChatStore.getState().setStreamingContent(content);
    },
    async (fullText) => {
      const { content, tomLabel, tomContext, isUpdate } = parseTOMTag(fullText);
      const s = useChatStore.getState();
      s.setStreamingContent('');
      s.setIsStreaming(false);

      const assistantMsg: Message = {
        id: nanoid(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
      };
      await s.addMessage(assistantMsg);

      if (tomLabel) {
        const msgIndex = allMessages.length;
        const extendedContext = tomContext || `User: ${text}\nAssistant: ${content}`.slice(0, 500);

        if (isUpdate && lastMarkerObj) {
          await s.updateMarker(lastMarkerObj.id, {
            label: tomLabel,
            extendedContext,
            messageIndex: msgIndex,
          });
        } else {
          await s.addMarker({
            id: nanoid(),
            label: tomLabel,
            extendedContext,
            timestamp: Date.now(),
            chatId,
            messageIndex: msgIndex,
          });
        }
      }
    },
    (error) => {
      const s = useChatStore.getState();
      s.setStreamingContent('');
      s.setIsStreaming(false);

      const errorMsg: Message = {
        id: nanoid(),
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      };
      s.addMessage(errorMsg);
    },
  );
}

interface Props {
  autoSend?: boolean;
  attachedContexts?: AttachedContext[];
  onRemoveContext?: (id: string) => void;
  onClearContexts?: () => void;
}

export default function ChatInput({ autoSend, attachedContexts = [], onRemoveContext, onClearContexts }: Props) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const currentChat = useChatStore((s) => s.currentChat);
  const isStreaming = useChatStore((s) => s.isStreaming);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Auto-send: the user message is already in the chat (pre-populated by UnifiedSearchInput).
  useEffect(() => {
    if (
      autoSend &&
      currentChat &&
      !autoSentRef.current &&
      currentChat.messages.length === 1 &&
      currentChat.messages[0].role === 'user' &&
      !isStreaming
    ) {
      autoSentRef.current = true;
      const userMsg = currentChat.messages[0];
      const state = useChatStore.getState();
      const { markers } = state;
      const markerCount = markers.length;
      const lastMarkerMsgIdx = markers.length > 0
        ? Math.max(...markers.map((m) => m.messageIndex))
        : -1;
      const messagesSinceLastMarker = lastMarkerMsgIdx >= 0
        ? currentChat.messages.length - 1 - lastMarkerMsgIdx
        : currentChat.messages.length;
      const markerHistory = buildMarkerHistory(markers);
      const lastMarkerObj = getLastMarker(markers);

      state.setIsStreaming(true);
      state.setStreamingContent('');

      const chatId = currentChat.id;

      streamChat(
        currentChat.messages,
        markerCount,
        messagesSinceLastMarker,
        markerHistory,
        (fullText) => {
          const { content } = parseTOMTag(fullText);
          useChatStore.getState().setStreamingContent(content);
        },
        async (fullText) => {
          const { content, tomLabel, tomContext, isUpdate } = parseTOMTag(fullText);
          const s = useChatStore.getState();
          s.setStreamingContent('');
          s.setIsStreaming(false);

          const assistantMsg: Message = {
            id: nanoid(),
            role: 'assistant',
            content,
            timestamp: Date.now(),
          };
          await s.addMessage(assistantMsg);

          if (tomLabel) {
            const msgIndex = currentChat.messages.length;
            const extendedContext = tomContext || `User: ${userMsg.content}\nAssistant: ${content}`.slice(0, 500);

            if (isUpdate && lastMarkerObj) {
              await s.updateMarker(lastMarkerObj.id, {
                label: tomLabel,
                extendedContext,
                messageIndex: msgIndex,
              });
            } else {
              await s.addMarker({
                id: nanoid(),
                label: tomLabel,
                extendedContext,
                timestamp: Date.now(),
                chatId,
                messageIndex: msgIndex,
              });
            }
          }
        },
        (error) => {
          const s = useChatStore.getState();
          s.setStreamingContent('');
          s.setIsStreaming(false);

          const errorMsg: Message = {
            id: nanoid(),
            role: 'assistant',
            content: `Error: ${error.message}`,
            timestamp: Date.now(),
          };
          s.addMessage(errorMsg);
        },
      );
    }
  }, [autoSend, currentChat, isStreaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const contexts = [...attachedContexts];
    setInput('');
    onClearContexts?.();
    await doSend(text, contexts);
  }, [input, attachedContexts, onClearContexts]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className={styles.container}>
      {/* Attached context chips */}
      {attachedContexts.length > 0 && (
        <div className={styles.attachedRow}>
          {attachedContexts.map((ctx) => (
            <div key={ctx.id} className={styles.chip}>
              <span className={styles.chipIcon}>#</span>
              <span className={styles.chipLabel}>{ctx.label}</span>
              <button
                className={styles.chipRemove}
                onClick={() => onRemoveContext?.(ctx.id)}
                title="Remove"
              >
                &#10005;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.inner}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          rows={1}
          disabled={isStreaming}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          title="Send"
        >
          &#9654;
        </button>
      </div>
      <div className={styles.disclaimer}>
        AI can make mistakes. Review generated markers.
      </div>
    </div>
  );
}
