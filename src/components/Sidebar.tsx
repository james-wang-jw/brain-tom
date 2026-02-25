import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useChatStore } from '../stores/chatStore.ts';
import { getRelevantTOMs, getRelevantTOMsEmbedding } from '../api/relevance.ts';
import { hasApiKey } from '../utils/apiKey.ts';
import { getRelevanceModel, getSearchMode } from '../utils/modelConfig.ts';
import { getCached, setCache } from '../utils/relevanceCache.ts';
import SidebarMarker from './SidebarMarker.tsx';
import CrossChatMarker from './CrossChatMarker.tsx';
import ConversationPreview from './ConversationPreview.tsx';
import type { TOMMarker } from '../types/index.ts';
import styles from '../styles/Sidebar.module.css';

export default function Sidebar() {
  const navigate = useNavigate();
  const { currentChat, markers, allMarkers, allChats, sidebarOpen, toggleSidebar } = useChatStore();
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [crossChatMarkers, setCrossChatMarkers] = useState<{ marker: TOMMarker; reason: string }[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [previewMarker, setPreviewMarker] = useState<TOMMarker | null>(null);
  const fetchingKeyRef = useRef<string | null>(null);

  const chatTitleMap = new Map(allChats.map((c) => [c.id, c.title]));

  // Fetch cross-chat related markers — re-fetches when current chat's
  // messages or markers change (e.g. new marker created/merged)
  useEffect(() => {
    const mode = getSearchMode();
    const needsKey = mode === 'embedding' ? hasApiKey('gemini') : hasApiKey(getRelevanceModel().provider);
    if (!currentChat || !sidebarOpen || !needsKey) return;
    if (currentChat.messages.length < 2) return;
    if (allMarkers.length === 0) return;

    const otherMarkers = allMarkers.filter((m) => m.chatId !== currentChat.id);
    if (otherMarkers.length === 0) return;

    // Cache key includes: message count, current-chat marker ids, other marker ids (sorted for stability)
    const currentMarkerKey = [...markers].map((m) => `${m.id}:${m.label}`).sort().join(',');
    const otherMarkerKey = [...otherMarkers].map((m) => m.id).sort().join(',');
    const cacheKey = `${mode}:${currentChat.messages.length}:${currentMarkerKey}:${otherMarkerKey}`;

    // If cache matches, reuse (scoped to this chat's ID)
    const cached = getCached(currentChat.id, cacheKey);
    if (cached !== null) {
      setCrossChatMarkers(cached);
      return;
    }

    // Prevent duplicate fetches for the same key
    if (fetchingKeyRef.current === cacheKey) return;
    fetchingKeyRef.current = cacheKey;

    // Build context from current chat's recent messages + current markers
    const recentMsgs = currentChat.messages.slice(-4);
    const msgContext = recentMsgs.map((m) => `${m.role}: ${m.content}`).join('\n');
    const markerContext = markers.map((m) => `Current topic: ${m.label}`).join('\n');
    const context = markerContext ? `${markerContext}\n\n${msgContext}` : msgContext;

    setLoadingRelated(true);
    const relevanceFn = mode === 'embedding' ? getRelevantTOMsEmbedding : getRelevantTOMs;
    relevanceFn(context, otherMarkers).then((result) => {
      setLoadingRelated(false);
      const results = result.confident ? result.markers : [];
      setCache(currentChat.id, cacheKey, results);
      fetchingKeyRef.current = null;
      setCrossChatMarkers(results);
    });
  }, [currentChat, markers, allMarkers, sidebarOpen]);

  const scrollToMarker = useCallback((marker: { id: string; messageIndex: number }) => {
    const msgEl = document.getElementById(`msg-${marker.messageIndex}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.remove('marker-highlighted');
      void msgEl.offsetWidth;
      msgEl.classList.add('marker-highlighted');
      setActiveMarkerId(marker.id);
      setTimeout(() => setActiveMarkerId(null), 2000);
    }
  }, []);

  const handleCrossClick = useCallback((marker: TOMMarker) => {
    setPreviewMarker((prev) => (prev?.id === marker.id ? null : marker));
  }, []);

  const handleCrossDoubleClick = useCallback((marker: TOMMarker) => {
    setPreviewMarker(null);
    navigate(`/chat/${marker.chatId}?msgIdx=${marker.messageIndex}`);
  }, [navigate]);

  const handleCrossDragStart = useCallback((e: React.DragEvent, marker: TOMMarker) => {
    e.dataTransfer.setData('application/tom-marker', JSON.stringify({
      id: marker.id,
      label: marker.label,
      extendedContext: marker.extendedContext,
      chatId: marker.chatId,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleNavigateToPreview = useCallback(() => {
    if (!previewMarker) return;
    setPreviewMarker(null);
    navigate(`/chat/${previewMarker.chatId}?msgIdx=${previewMarker.messageIndex}`);
  }, [previewMarker, navigate]);

  const sortedMarkers = [...markers].sort((a, b) => a.messageIndex - b.messageIndex);

  if (!sidebarOpen) {
    return (
      <div
        className={styles.expandEdge}
        onClick={toggleSidebar}
        title="Expand sidebar"
      >
        <span className={styles.expandLabel}>
          # Top of Mind{markers.length > 0 ? ` (${markers.length})` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.sidebarWrap}>
      <aside className={styles.sidebar}>
        <div className={styles.header}>
          <span>Top of Mind</span>
          <button
            className={styles.collapseBtn}
            onClick={toggleSidebar}
            title="Collapse sidebar"
          >
            &#8249;
          </button>
        </div>
        <div className={styles.list}>
          {/* Current chat markers */}
          {sortedMarkers.length === 0 && crossChatMarkers.length === 0 && (
            <div className={styles.empty}>
              Markers will appear here as the conversation progresses.
            </div>
          )}
          {sortedMarkers.map((m) => (
            <SidebarMarker
              key={m.id}
              marker={m}
              active={m.id === activeMarkerId}
              onClick={() => scrollToMarker(m)}
            />
          ))}

          {/* Cross-chat related markers */}
          {(crossChatMarkers.length > 0 || loadingRelated) && (
            <>
              <div className={styles.divider} />
              <div className={styles.sectionLabel}>Related</div>
              {loadingRelated && (
                <div className={styles.loadingRelated}>Finding related...</div>
              )}
              {crossChatMarkers.map((item) => (
                <CrossChatMarker
                  key={item.marker.id}
                  marker={item.marker}
                  chatTitle={chatTitleMap.get(item.marker.chatId) || 'Chat'}
                  reason={item.reason}
                  active={previewMarker?.id === item.marker.id}
                  onClick={() => handleCrossClick(item.marker)}
                  onDoubleClick={() => handleCrossDoubleClick(item.marker)}
                  onDragStart={(e) => handleCrossDragStart(e, item.marker)}
                />
              ))}
            </>
          )}
        </div>
      </aside>

      {/* Preview panel */}
      {previewMarker && (
        <ConversationPreview
          marker={previewMarker}
          chatTitle={chatTitleMap.get(previewMarker.chatId) || 'Chat'}
          onNavigate={handleNavigateToPreview}
          onClose={() => setPreviewMarker(null)}
        />
      )}
    </div>
  );
}
