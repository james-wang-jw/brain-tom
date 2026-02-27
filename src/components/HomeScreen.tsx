import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useChatStore } from '../stores/chatStore.ts';
import { getRelevantTOMs, getRelevantTOMsEmbedding } from '../api/relevance.ts';
import { hasApiKey } from '../utils/apiKey.ts';
import { getRelevanceModel, getSearchMode } from '../utils/modelConfig.ts';
import { getCached, setCache } from '../utils/relevanceCache.ts';
import UnifiedSearchInput from './UnifiedSearchInput.tsx';
import TOMCard from './TOMCard.tsx';
import Settings from './Settings.tsx';
import VisualHomeScreen from './VisualHomeScreen.tsx';
import type { TOMMarker } from '../types/index.ts';
import styles from '../styles/HomeScreen.module.css';

type ViewMode = 'relevant' | 'recent';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const { allChats, allMarkers, loadAllChats, loadAllMarkers, deleteMarker, deleteChatById } =
    useChatStore();
  const [mapView, setMapView] = useState(() => localStorage.getItem('tom-map-view') !== 'false');
  const [viewMode, setViewMode] = useState<ViewMode>('recent');
  const [relevantMarkers, setRelevantMarkers] = useState<
    { marker: TOMMarker; reason: string }[]
  >([]);
  const [loadingRelevant, setLoadingRelevant] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fetchingKeyRef = useRef<string | null>(null);

  const chatTitleMap = new Map(allChats.map((c) => [c.id, c.title]));

  useEffect(() => {
    loadAllChats();
    loadAllMarkers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute relevance only when the underlying context actually changes
  useEffect(() => {
    const mode = getSearchMode();
    const needsKey = mode === 'embedding' ? hasApiKey('gemini') : hasApiKey(getRelevanceModel().provider);
    if (allMarkers.length === 0 || !needsKey) return;

    const recentChat = allChats[0];
    if (!recentChat || recentChat.messages.length === 0) return;

    const recentMsgs = recentChat.messages.slice(-4);
    const context = recentMsgs.map((m) => `${m.role}: ${m.content}`).join('\n');

    // Build cache key from the actual content (sort IDs for stable ordering)
    const cacheKey = `${mode}:${recentChat.id}:${recentChat.messages.length}:${[...allMarkers].map((m) => m.id).sort().join(',')}`;

    // If cache matches, reuse previous results without an API call
    const cached = getCached('home', cacheKey);
    if (cached !== null) {
      if (cached.length > 0) {
        setRelevantMarkers(cached);
        setViewMode('relevant');
      }
      return;
    }

    // Prevent duplicate fetches for the same key
    if (fetchingKeyRef.current === cacheKey) return;
    fetchingKeyRef.current = cacheKey;

    setLoadingRelevant(true);
    const relevanceFn = mode === 'embedding' ? getRelevantTOMsEmbedding : getRelevantTOMs;
    relevanceFn(context, allMarkers).then((result) => {
      setLoadingRelevant(false);
      const results = result.confident ? result.markers : [];
      setCache('home', cacheKey, results);
      fetchingKeyRef.current = null;
      if (results.length > 0) {
        setRelevantMarkers(results);
        setViewMode('relevant');
      }
    });
  }, [allMarkers, allChats]);

  const handleMarkerClick = useCallback(
    (marker: TOMMarker) => {
      navigate(`/chat/${marker.chatId}?marker=${marker.id}&msgIdx=${marker.messageIndex}`);
    },
    [navigate],
  );

  const displayedMarkers =
    viewMode === 'relevant'
      ? relevantMarkers
      : allMarkers.map((m) => ({ marker: m, reason: '' }));

  const toggleMapView = useCallback(() => {
    setMapView((prev) => {
      const next = !prev;
      localStorage.setItem('tom-map-view', String(next));
      return next;
    });
  }, []);

  if (mapView) {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <VisualHomeScreen />
        <button
          className={styles.viewToggleBtn}
          onClick={toggleMapView}
          title="Switch to list view"
        >
          &#9776;
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Top of Mind</h1>
        <p className={styles.subtitle}>Pick up exactly where you left off.</p>
      </div>

      <div className={styles.content}>
        <UnifiedSearchInput />

        {/* TOM List */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.toggle}>
              <button
                className={`${styles.toggleBtn} ${viewMode === 'relevant' ? styles.toggleBtnActive : ''}`}
                onClick={() => setViewMode('relevant')}
              >
                Relevant
              </button>
              <button
                className={`${styles.toggleBtn} ${viewMode === 'recent' ? styles.toggleBtnActive : ''}`}
                onClick={() => setViewMode('recent')}
              >
                Recent
              </button>
            </div>
          </div>

          {loadingRelevant && viewMode === 'relevant' && (
            <div className={styles.emptyState}>
              <div className={styles.emptyText}>Finding relevant markers...</div>
            </div>
          )}

          {!loadingRelevant && displayedMarkers.length > 0 && (
            <div className={styles.markerGrid}>
              {displayedMarkers.map((item) => (
                <TOMCard
                  key={item.marker.id}
                  marker={item.marker}
                  chatTitle={chatTitleMap.get(item.marker.chatId)}
                  reason={item.reason}
                  onClick={() => handleMarkerClick(item.marker)}
                  onDelete={() => deleteMarker(item.marker.id)}
                />
              ))}
            </div>
          )}

          {!loadingRelevant && displayedMarkers.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>#</div>
              <div className={styles.emptyText}>No markers yet</div>
              <div className={styles.emptyHint}>
                Start a conversation and markers will be created as you explore ideas.
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        {allChats.length > 0 && <hr className={styles.separator} />}

        {/* Legacy Chat List */}
        {allChats.length > 0 && (
          <div className={styles.section}>
            <button
              className={styles.legacyToggle}
              onClick={() => setLegacyOpen(!legacyOpen)}
            >
              <span
                className={`${styles.legacyArrow} ${legacyOpen ? styles.legacyArrowOpen : ''}`}
              >
                &#9654;
              </span>
              All Conversations ({allChats.length})
            </button>

            {legacyOpen && (
              <div className={styles.chatList}>
                {allChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={styles.chatRow}
                    onClick={() => navigate(`/chat/${chat.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/chat/${chat.id}`); }}
                  >
                    <span className={styles.chatRowIcon}>&#128488;</span>
                    <div className={styles.chatRowBody}>
                      <div className={styles.chatRowTitle}>{chat.title}</div>
                      <span className={styles.chatRowDate}>{formatDate(chat.updatedAt)}</span>
                    </div>
                    <button
                      className={styles.chatRowDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChatById(chat.id);
                      }}
                      title="Delete conversation"
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Fixed settings button — bottom left */}
      <button
        className={styles.settingsBtn}
        onClick={() => setSettingsOpen(true)}
        title="Settings"
      >
        &#9881;
      </button>

      {/* Map view toggle — bottom right */}
      <button
        className={styles.viewToggleBtn}
        onClick={toggleMapView}
        title="Switch to map view"
      >
        &#9673;
      </button>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
