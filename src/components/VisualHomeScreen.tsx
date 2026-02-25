import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore.ts';
import { computeLayout, incrementalLayout } from '../utils/forceLayout.ts';
import type { Position } from '../utils/forceLayout.ts';
import { getAllCachedIds } from '../utils/embeddingStore.ts';
import { recomputeClusters } from '../utils/clusterEngine.ts';
import { requestClusterLabeling } from '../utils/clusterLabeler.ts';
import { getAllClusters, saveClusters, deleteCluster as deleteClusterFromDB } from '../db/index.ts';
import TOMMap from './TOMMap.tsx';
import ChatSheet from './ChatSheet.tsx';
import type { SheetState } from './ChatSheet.tsx';
import UnifiedSearchInput from './UnifiedSearchInput.tsx';
import Settings from './Settings.tsx';
import type { TOMMarker, ClusterNode } from '../types/index.ts';
import type { AttachedContext } from './ChatInput.tsx';
import styles from '../styles/VisualHomeScreen.module.css';

export default function VisualHomeScreen() {
  const { allChats, allMarkers, loadAllChats, loadAllMarkers } = useChatStore();

  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>('closed');
  const [attachedContexts, setAttachedContexts] = useState<AttachedContext[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locateMarkerId, setLocateMarkerId] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState(false);

  const [layoutVersion, setLayoutVersion] = useState(0);
  const [clusters, setClusters] = useState<ClusterNode[]>([]);
  const clustersRef = useRef<ClusterNode[]>([]);

  const prevMarkerIdsRef = useRef<Set<string>>(new Set());
  const embeddedCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevClusterMarkerIdsRef = useRef<Set<string>>(new Set());
  const prevClusterEmbeddedCountRef = useRef(0);

  const chatTitleMap = new Map(allChats.map((c) => [c.id, c.title]));

  // Load global data on mount
  useEffect(() => {
    loadAllChats();
    loadAllMarkers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute layout when markers change
  useEffect(() => {
    if (allMarkers.length === 0) {
      setPositions(new Map());
      prevMarkerIdsRef.current = new Set();
      embeddedCountRef.current = 0;
      return;
    }

    const currentIds = new Set(allMarkers.map((m) => m.id));
    const markerIds = allMarkers.map((m) => m.id);
    const prevIds = prevMarkerIdsRef.current;

    // Check for added/removed markers
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) newIds.add(id);
    }
    const removedIds = new Set<string>();
    for (const id of prevIds) {
      if (!currentIds.has(id)) removedIds.add(id);
    }

    const hasChanges = newIds.size > 0 || removedIds.size > 0 || prevIds.size === 0;

    if (hasChanges) {
      // Remove positions for deleted markers
      if (removedIds.size > 0) {
        setPositions((prev) => {
          const next = new Map(prev);
          for (const id of removedIds) next.delete(id);
          return next;
        });
      }

      if (prevIds.size === 0 || newIds.size === markerIds.length) {
        // Initial or full recompute
        const result = computeLayout(markerIds);
        setPositions(result.positions);
        embeddedCountRef.current = result.embeddedCount;
        setLayoutVersion((v) => v + 1);
      } else if (newIds.size > 0) {
        // Incremental
        setPositions((prev) => {
          const result = incrementalLayout(markerIds, prev, newIds);
          embeddedCountRef.current = result.embeddedCount;
          return result.positions;
        });
        setLayoutVersion((v) => v + 1);
      }
    }

    prevMarkerIdsRef.current = currentIds;
  }, [allMarkers]);

  // Retry layout when embeddings become available (they load async)
  useEffect(() => {
    if (allMarkers.length === 0) return;

    // Poll every 2 seconds for new embeddings, recompute if more are ready
    const poll = () => {
      const cachedIds = getAllCachedIds();
      const markerIdSet = new Set(allMarkers.map((m) => m.id));
      const embeddedMarkers = cachedIds.filter((id) => markerIdSet.has(id));

      if (embeddedMarkers.length > embeddedCountRef.current) {
        // More embeddings are ready — recompute layout
        const markerIds = allMarkers.map((m) => m.id);
        const result = computeLayout(markerIds);
        setPositions(result.positions);
        embeddedCountRef.current = result.embeddedCount;
        setLayoutVersion((v) => v + 1);
      }

      // Keep polling if not all markers have embeddings yet
      if (embeddedMarkers.length < allMarkers.length) {
        retryTimerRef.current = setTimeout(poll, 2000);
      }
    };

    // Start polling after a short initial delay
    retryTimerRef.current = setTimeout(poll, 1500);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [allMarkers]);

  // Load clusters from IDB on mount
  useEffect(() => {
    getAllClusters().then((stored) => {
      setClusters(stored);
      clustersRef.current = stored;
    });
  }, []);

  // Recompute clusters when markers or embedding count change
  useEffect(() => {
    if (allMarkers.length === 0) return;

    const currentIds = new Set(allMarkers.map((m) => m.id));
    const cachedIds = getAllCachedIds();
    const markerIdSet = currentIds;
    const embeddedCount = cachedIds.filter((id) => markerIdSet.has(id)).length;

    // Detect changes from last cluster computation
    const prevIds = prevClusterMarkerIdsRef.current;
    const prevEmbCount = prevClusterEmbeddedCountRef.current;

    const changedIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) changedIds.add(id);
    }
    for (const id of prevIds) {
      if (!currentIds.has(id)) changedIds.add(id);
    }

    const hasChanges = changedIds.size > 0 || embeddedCount !== prevEmbCount;
    if (!hasChanges) return;

    prevClusterMarkerIdsRef.current = currentIds;
    prevClusterEmbeddedCountRef.current = embeddedCount;

    // Need at least some embeddings before clustering
    if (embeddedCount < 3) return;

    const { clusters: newClusters, needsLabeling } = recomputeClusters(
      allMarkers,
      clustersRef.current,
      changedIds.size > 0 ? changedIds : undefined,
    );

    setClusters(newClusters);
    clustersRef.current = newClusters;

    // Persist to IDB
    saveClusters(newClusters).then(async () => {
      // Remove old clusters not in the new set
      const newIds = new Set(newClusters.map((c) => c.id));
      const oldClusters = await getAllClusters();
      for (const old of oldClusters) {
        if (!newIds.has(old.id)) {
          await deleteClusterFromDB(old.id);
        }
      }
    });

    // Request labeling for clusters that need it
    if (needsLabeling.length > 0) {
      requestClusterLabeling(needsLabeling, newClusters, allMarkers, (clusterId, label) => {
        setClusters((prev) => {
          const next = prev.map((c) => {
            if (c.id !== clusterId) return c;
            return { ...c, label, previousLabel: c.label !== '...' ? c.label : undefined, updatedAt: Date.now() };
          });
          clustersRef.current = next;
          // Persist updated label
          saveClusters(next);
          return next;
        });
      });
    }
  }, [allMarkers]);

  // Compute cluster positions by averaging member positions
  const clusterPositions = useMemo(() => {
    const map = new Map<string, Position>();
    for (const cluster of clusters) {
      let sumX = 0, sumY = 0, count = 0;
      for (const memberId of cluster.memberIds) {
        const pos = positions.get(memberId);
        if (pos) {
          sumX += pos.x;
          sumY += pos.y;
          count++;
        }
      }
      if (count > 0) {
        map.set(cluster.id, { x: sumX / count, y: sumY / count });
      }
    }
    return map;
  }, [clusters, positions]);

  // Listen for custom context-attach event from ChatSheet drop
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; label: string; context: string };
      setAttachedContexts((prev) => {
        if (prev.some((c) => c.id === detail.id)) return prev;
        return [...prev, detail];
      });
    };
    window.addEventListener('tom-attach-context', handler);
    return () => window.removeEventListener('tom-attach-context', handler);
  }, []);

  // Marker click: open sheet with that marker's chat and center on it
  const handleMarkerClick = useCallback((marker: TOMMarker) => {
    setAutoSend(false);
    setLocateMarkerId(marker.id);
    setActiveChatId(marker.chatId);
    setSheetState('half');
    setTimeout(() => setLocateMarkerId(null), 500);
  }, []);

  // Marker drag start (for cross-chat context)
  const handleMarkerDragStart = useCallback((e: React.DragEvent, marker: TOMMarker) => {
    e.dataTransfer.setData('application/tom-marker', JSON.stringify({
      id: marker.id,
      label: marker.label,
      extendedContext: marker.extendedContext,
      chatId: marker.chatId,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // Sheet state change
  const handleSheetStateChange = useCallback((newState: SheetState) => {
    setSheetState(newState);
    if (newState === 'closed') {
      setActiveChatId(null);
      setAttachedContexts([]);
    }
  }, []);

  // Search: locate marker on map
  const handleMarkerLocate = useCallback((marker: TOMMarker) => {
    setAutoSend(false);
    setLocateMarkerId(marker.id);
    setActiveChatId(marker.chatId);
    setSheetState('half');
    // Clear locate after animation
    setTimeout(() => setLocateMarkerId(null), 500);
  }, []);

  // Search: new chat created (needs autoSend to trigger LLM response)
  const handleSearchNewChat = useCallback((chatId: string) => {
    setAutoSend(true);
    setActiveChatId(chatId);
    setSheetState('half');
  }, []);

  // Context management
  const removeContext = useCallback((id: string) => {
    setAttachedContexts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearContexts = useCallback(() => {
    setAttachedContexts([]);
  }, []);

  // Find active marker ID from the active chat
  const activeMarkerIds = allMarkers.filter((m) => m.chatId === activeChatId).map((m) => m.id);
  const activeMarkerId = activeMarkerIds.length > 0 ? activeMarkerIds[activeMarkerIds.length - 1] : null;

  // When sheet is half-open, the visible map area is the top 45% of the screen
  const visibleHeightFraction = sheetState === 'half' ? 0.45 : 1;

  return (
    <div className={styles.container}>
      <TOMMap
        positions={positions}
        markers={allMarkers}
        activeMarkerId={activeMarkerId}
        chatTitleMap={chatTitleMap}
        onMarkerClick={handleMarkerClick}
        onMarkerDragStart={handleMarkerDragStart}
        locateMarkerId={locateMarkerId}
        layoutVersion={layoutVersion}
        visibleHeightFraction={visibleHeightFraction}
        clusters={clusters}
        clusterPositions={clusterPositions}
      />

      <div className={styles.searchOverlay}>
        <UnifiedSearchInput
          onMarkerLocate={handleMarkerLocate}
          onNewChat={handleSearchNewChat}
        />
      </div>

      <ChatSheet
        chatId={activeChatId}
        state={sheetState}
        onStateChange={handleSheetStateChange}
        attachedContexts={attachedContexts}
        onRemoveContext={removeContext}
        onClearContexts={clearContexts}
        autoSend={autoSend}
      />

      <button
        className={styles.settingsBtn}
        onClick={() => setSettingsOpen(true)}
        title="Settings"
      >
        &#9881;
      </button>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
