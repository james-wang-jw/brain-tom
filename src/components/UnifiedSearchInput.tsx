import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { nanoid } from 'nanoid';
import { useChatStore } from '../stores/chatStore.ts';
import { searchTOMs, searchTOMsEmbedding } from '../api/relevance.ts';
import { hasApiKey } from '../utils/apiKey.ts';
import { getRelevanceModel, getSearchMode } from '../utils/modelConfig.ts';
import type { TOMMarker } from '../types/index.ts';
import type { Message } from '../types/index.ts';
import * as db from '../db/index.ts';
import styles from '../styles/UnifiedSearch.module.css';

function keywordSearch(
  query: string,
  markers: TOMMarker[],
): { marker: TOMMarker; reason: string }[] {
  const q = query.toLowerCase();
  return markers
    .filter((m) => {
      const label = m.label.toLowerCase();
      const ctx = (m.extendedContext || '').toLowerCase();
      return label.includes(q) || ctx.includes(q);
    })
    .slice(0, 8)
    .map((m) => ({ marker: m, reason: 'keyword match' }));
}

interface Props {
  onMarkerLocate?: (marker: TOMMarker) => void;
  onNewChat?: (chatId: string) => void;
}

export default function UnifiedSearchInput({ onMarkerLocate, onNewChat }: Props = {}) {
  const navigate = useNavigate();
  const { allMarkers, allChats } = useChatStore();
  const [query, setQuery] = useState('');
  const [keywordResults, setKeywordResults] = useState<{ marker: TOMMarker; reason: string }[]>([]);
  const [semanticResults, setSemanticResults] = useState<{ marker: TOMMarker; reason: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const chatTitleMap = new Map(allChats.map((c) => [c.id, c.title]));

  // Merge keyword + semantic, deduplicate by marker ID
  const mergedResults = (() => {
    const seen = new Set<string>();
    const merged: { marker: TOMMarker; reason: string }[] = [];
    for (const r of keywordResults) {
      if (!seen.has(r.marker.id)) {
        seen.add(r.marker.id);
        merged.push(r);
      }
    }
    for (const r of semanticResults) {
      if (!seen.has(r.marker.id)) {
        seen.add(r.marker.id);
        merged.push(r);
      }
    }
    return merged;
  })();

  useEffect(() => {
    if (!query.trim()) {
      setKeywordResults([]);
      setSemanticResults([]);
      setShowResults(false);
      setSearching(false);
      return;
    }
    setShowResults(true);

    const mode = getSearchMode();

    if (mode === 'embedding') {
      // Embedding mode: fast enough to be the only tier, no keyword needed
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setKeywordResults([]);
      debounceRef.current = setTimeout(async () => {
        if (allMarkers.length === 0 || !hasApiKey('gemini')) return;
        setSearching(true);
        try {
          const res = await searchTOMsEmbedding(query, allMarkers);
          setSemanticResults(res);
        } catch {
          setSemanticResults([]);
        }
        setSearching(false);
      }, 500);
    } else {
      // LLM mode: keyword gives instant results while LLM call is in-flight
      setKeywordResults(keywordSearch(query, allMarkers));

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (allMarkers.length === 0 || !hasApiKey(getRelevanceModel().provider)) return;
        setSearching(true);
        const res = await searchTOMs(query, allMarkers);
        setSemanticResults(res);
        setSearching(false);
      }, 500);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, allMarkers]);

  const handleSubmit = useCallback(async () => {
    const text = query.trim();
    if (!text) {
      navigate('/chat/new');
      return;
    }

    // Create chat with the user message already in it, then navigate
    const title = text.length > 50 ? text.slice(0, 47) + '...' : text;
    const chatId = nanoid();
    const userMsg: Message = {
      id: nanoid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const chat = {
      id: chatId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [userMsg],
    };
    await db.saveChat(chat);

    if (onNewChat) {
      // Map mode: open chat in sheet instead of navigating
      onNewChat(chatId);
      setQuery('');
      setShowResults(false);
    } else {
      // List mode: navigate with autoSend flag so ChatInput triggers the LLM response
      navigate(`/chat/${chatId}?autoSend=1`);
    }
  }, [query, navigate, onNewChat]);

  const handleMarkerClick = useCallback(
    (marker: TOMMarker) => {
      if (onMarkerLocate) {
        // Map mode: locate marker on map + open sheet
        onMarkerLocate(marker);
        setQuery('');
        setShowResults(false);
      } else {
        // List mode: navigate to chat
        navigate(`/chat/${marker.chatId}?marker=${marker.id}&msgIdx=${marker.messageIndex}`);
      }
    },
    [navigate, onMarkerLocate],
  );

  return (
    <div className={styles.container}>
      <div className={styles.inputWrap}>
        <span className={styles.searchIcon}>&#128269;</span>
        <input
          className={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          placeholder="Search your thoughts or start a new chat..."
        />
      </div>

      {showResults && (
        <div className={styles.results}>
          {searching && (
            <div className={styles.searching}>Searching markers...</div>
          )}

          {mergedResults.length > 0 &&
            mergedResults.map((r) => (
              <button
                key={r.marker.id}
                className={styles.resultItem}
                onClick={() => handleMarkerClick(r.marker)}
              >
                <span className={styles.resultIcon}>#</span>
                <span className={styles.resultLabel}>{r.marker.label}</span>
                <span className={styles.resultChat}>
                  {chatTitleMap.get(r.marker.chatId) || 'Chat'}
                </span>
              </button>
            ))}

          {!searching && query.trim() && (
            <button className={styles.newChatOption} onClick={handleSubmit}>
              + Start new chat about: &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
