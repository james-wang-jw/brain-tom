import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { TOMMarker, ClusterNode } from '../types/index.ts';
import type { Position } from '../utils/forceLayout.ts';
import { getEmbedding, cosineSimilarity } from '../utils/embeddingStore.ts';
import { EMBEDDING_THRESHOLD } from '../api/relevance.ts';
import styles from '../styles/TOMMap.module.css';

interface TOMMapProps {
  positions: Map<string, Position>;
  markers: TOMMarker[];
  activeMarkerId?: string | null;
  chatTitleMap: Map<string, string>;
  onMarkerClick: (marker: TOMMarker) => void;
  onMarkerDragStart: (e: React.DragEvent, marker: TOMMarker) => void;
  locateMarkerId?: string | null;
  /** Incremented each time the layout recomputes — triggers camera re-center */
  layoutVersion?: number;
  /** Fraction of viewport height that is visible (0–1). Used to center correctly when sheet is open. */
  visibleHeightFraction?: number;
  clusters?: ClusterNode[];
  clusterPositions?: Map<string, Position>;
}

export default function TOMMap({
  positions,
  markers,
  activeMarkerId,
  chatTitleMap,
  onMarkerClick,
  onMarkerDragStart,
  locateMarkerId,
  layoutVersion = 0,
  visibleHeightFraction = 1,
  clusters = [],
  clusterPositions,
}: TOMMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  // Camera state
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  // Pointer tracking
  const pointerStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const didPan = useRef(false);

  // Long-press tracking
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressMarker = useRef<TOMMarker | null>(null);

  // Pinch zoom
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Re-center camera when layout recomputes (layoutVersion changes)
  const lastVersionRef = useRef(-1);
  useEffect(() => {
    if (layoutVersion === lastVersionRef.current || positions.size === 0 || !viewportRef.current) return;
    lastVersionRef.current = layoutVersion;

    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight * visibleHeightFraction;

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pos of positions.values()) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rangeX = maxX - minX + 300;
    const rangeY = maxY - minY + 300;
    const fitZoom = Math.min(vw / rangeX, vh / rangeY, 1.5);
    const clampedZoom = Math.max(0.2, Math.min(fitZoom, 2));

    // Center in the visible area (top portion when sheet is open)
    setPanX(vw / 2 - cx * clampedZoom);
    setPanY(vh / 2 - cy * clampedZoom);
    setZoom(clampedZoom);
  }, [positions, layoutVersion, visibleHeightFraction]);

  // Locate marker: animate camera to center on it in the visible area
  useEffect(() => {
    if (!locateMarkerId || !viewportRef.current) return;
    const pos = positions.get(locateMarkerId);
    if (!pos) return;

    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight * visibleHeightFraction;
    const targetZoom = Math.max(zoom, 1);

    setPanX(vw / 2 - pos.x * targetZoom);
    setPanY(vh / 2 - pos.y * targetZoom);
    setZoom(targetZoom);
  }, [locateMarkerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Pointer handlers for panning ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Ignore if on a marker node
    if ((e.target as HTMLElement).closest(`.${styles.node}`)) return;

    pointerStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    didPan.current = false;
    setIsPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [panX, panY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
    setPanX(pointerStart.current.panX + dx);
    setPanY(pointerStart.current.panY + dy);
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerStart.current = null;
    setIsPanning(false);
    // Reset didPan so subsequent marker clicks work
    // Use a microtask so the click event (which fires after pointerup) still sees
    // the current didPan value for this gesture
    setTimeout(() => { didPan.current = false; }, 0);
  }, []);

  // --- Wheel zoom (non-passive so preventDefault works) ---
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  zoomRef.current = zoom;
  panXRef.current = panX;
  panYRef.current = panY;

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const z = zoomRef.current;
      const px = panXRef.current;
      const py = panYRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.3, Math.min(z * factor, 3));
      const scale = newZoom / z;

      setPanX(mx - scale * (mx - px));
      setPanY(my - scale * (my - py));
      setZoom(newZoom);
    };

    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  // --- Touch handlers for pinch zoom ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.sqrt(dx * dx + dy * dy), zoom };
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchRef.current.dist;
      const newZoom = Math.max(0.3, Math.min(pinchRef.current.zoom * scale, 3));
      setZoom(newZoom);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  // --- Marker click and long-press ---
  const handleMarkerPointerDown = useCallback((e: React.PointerEvent, marker: TOMMarker) => {
    e.stopPropagation();
    longPressMarker.current = marker;
    longPressTimer.current = setTimeout(() => {
      longPressMarker.current = null; // consumed by drag
    }, 500);
  }, []);

  const handleMarkerClick = useCallback((marker: TOMMarker) => {
    if (didPan.current) return;
    clearTimeout(longPressTimer.current);
    onMarkerClick(marker);
  }, [onMarkerClick]);

  const handleMarkerDragStart = useCallback((e: React.DragEvent, marker: TOMMarker) => {
    clearTimeout(longPressTimer.current);
    onMarkerDragStart(e, marker);
  }, [onMarkerDragStart]);

  // Build marker ID to marker map
  const markerMap = new Map(markers.map((m) => [m.id, m]));

  // Find which markers have positions
  const visibleMarkers: { marker: TOMMarker; pos: Position }[] = [];
  for (const [id, pos] of positions) {
    const marker = markerMap.get(id);
    if (marker) visibleMarkers.push({ marker, pos });
  }

  // Zoom-based opacity for clusters vs individual markers
  const ZOOM_FADE_LOW = 1.1;
  const ZOOM_FADE_HIGH = 1.3;
  const clusterOpacity = zoom <= ZOOM_FADE_LOW ? 1 : zoom >= ZOOM_FADE_HIGH ? 0 : (ZOOM_FADE_HIGH - zoom) / (ZOOM_FADE_HIGH - ZOOM_FADE_LOW);
  const memberOpacity = zoom >= ZOOM_FADE_HIGH ? 1 : zoom <= ZOOM_FADE_LOW ? 0 : (zoom - ZOOM_FADE_LOW) / (ZOOM_FADE_HIGH - ZOOM_FADE_LOW);

  // Counter-scale label text when zoomed out so it stays readable
  const labelScale = zoom < 1 ? 1 / zoom : 1; // e.g. zoom=0.5 → scale text 2x

  // Build set of marker IDs that belong to clusters
  const clusteredMarkerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of clusters) {
      for (const id of c.memberIds) ids.add(id);
    }
    return ids;
  }, [clusters]);

  // Cluster click handler: zoom to 1.0 centered on cluster position
  const handleClusterClick = useCallback((clusterId: string) => {
    if (didPan.current) return;
    if (!clusterPositions || !viewportRef.current) return;
    const pos = clusterPositions.get(clusterId);
    if (!pos) return;

    const vw = viewportRef.current.clientWidth;
    const vh = viewportRef.current.clientHeight * visibleHeightFraction;
    const targetZoom = 1.0;

    setPanX(vw / 2 - pos.x * targetZoom);
    setPanY(vh / 2 - pos.y * targetZoom);
    setZoom(targetZoom);
  }, [clusterPositions, visibleHeightFraction]);

  // Compute connection lines from active marker to related markers (similarity >= threshold)
  const connectionLines = useMemo(() => {
    if (!activeMarkerId) return [];
    const activePos = positions.get(activeMarkerId);
    const activeEmb = getEmbedding(activeMarkerId);
    if (!activePos || !activeEmb) return [];

    const lines: { targetId: string; x1: number; y1: number; x2: number; y2: number; similarity: number }[] = [];
    for (const { marker, pos } of visibleMarkers) {
      if (marker.id === activeMarkerId) continue;
      const emb = getEmbedding(marker.id);
      if (!emb) continue;
      const sim = cosineSimilarity(activeEmb, emb);
      if (sim >= EMBEDDING_THRESHOLD) {
        lines.push({
          targetId: marker.id,
          x1: activePos.x,
          y1: activePos.y,
          x2: pos.x,
          y2: pos.y,
          similarity: sim,
        });
      }
    }
    return lines;
  }, [activeMarkerId, positions, visibleMarkers]);

  return (
    <div
      ref={viewportRef}
      className={`${styles.viewport} ${isPanning ? styles.grabbing : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={styles.canvas}
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        {/* Connection lines from active marker to related markers */}
        {connectionLines.length > 0 && (
          <svg className={styles.connectionSvg}>
            {connectionLines.map((line) => (
              <line
                key={line.targetId}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                className={styles.connectionLine}
                strokeOpacity={0 + (line.similarity - EMBEDDING_THRESHOLD) * 3}
              />
            ))}
          </svg>
        )}

        {visibleMarkers.map(({ marker, pos }) => {
          const inCluster = clusteredMarkerIds.has(marker.id);
          const opacity = inCluster ? memberOpacity : 1;
          const noPointer = inCluster && memberOpacity <= 0.3;
          return (
            <div
              key={marker.id}
              className={`${styles.node} ${activeMarkerId === marker.id ? styles.nodeActive : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                opacity,
                pointerEvents: noPointer ? 'none' : undefined,
              }}
              onClick={() => handleMarkerClick(marker)}
              onPointerDown={(e) => handleMarkerPointerDown(e, marker)}
              draggable
              onDragStart={(e) => handleMarkerDragStart(e, marker)}
              title={`${marker.label}\n${chatTitleMap.get(marker.chatId) || 'Chat'}`}
            >
              <span className={styles.nodeIcon}>#</span>
              <span className={styles.nodeLabel} style={labelScale > 1 ? { fontSize: 11 * labelScale } : undefined}>{marker.label}</span>
            </div>
          );
        })}

        {/* Cluster nodes */}
        {clusterPositions && clusters.map((cluster) => {
          const pos = clusterPositions.get(cluster.id);
          if (!pos || clusterOpacity <= 0) return null;
          return (
            <div
              key={cluster.id}
              className={styles.clusterNode}
              style={{
                left: pos.x,
                top: pos.y,
                opacity: clusterOpacity,
                pointerEvents: clusterOpacity <= 0.3 ? 'none' : undefined,
              }}
              onClick={() => handleClusterClick(cluster.id)}
            >
              <span className={styles.clusterCount}>{cluster.memberIds.length}</span>
              <span className={styles.clusterLabel} style={labelScale > 1 ? { fontSize: 12 * labelScale } : undefined}>{cluster.label}</span>
            </div>
          );
        })}
      </div>

      {visibleMarkers.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>#</div>
          <div className={styles.emptyText}>No markers on map</div>
          <div className={styles.emptyHint}>Start conversations to create markers</div>
        </div>
      )}
    </div>
  );
}
