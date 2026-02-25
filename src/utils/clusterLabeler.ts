import { getApiKey } from './apiKey.ts';
import { getRelevanceModel } from './modelConfig.ts';
import { callGemini } from '../api/gemini.ts';
import { callAnthropic } from '../api/anthropic.ts';
import { cosineSimilarity } from './embeddingStore.ts';
import type { ClusterNode } from '../types/index.ts';
import type { TOMMarker } from '../types/index.ts';

const NEIGHBOR_THRESHOLD = 0.65;
const DEBOUNCE_MS = 2000;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingIds = new Set<string>();

function callLLM(prompt: string): Promise<string> {
  const model = getRelevanceModel();
  const apiKey = getApiKey(model.provider);
  if (!apiKey) throw new Error('No API key for cluster labeling');

  if (model.provider === 'anthropic') {
    return callAnthropic(model.id, apiKey, prompt);
  }
  return callGemini(model.id, apiKey, prompt);
}

function getNeighborLabels(cluster: ClusterNode, allClusters: ClusterNode[]): string[] {
  const labels: string[] = [];
  if (cluster.centroid.length === 0) return labels;

  for (const other of allClusters) {
    if (other.id === cluster.id || other.centroid.length === 0) continue;
    if (other.label === '...') continue;
    const sim = cosineSimilarity(cluster.centroid, other.centroid);
    if (sim >= NEIGHBOR_THRESHOLD) {
      labels.push(other.label);
    }
    if (labels.length >= 5) break;
  }
  return labels;
}

async function processQueue(
  allClusters: ClusterNode[],
  markers: TOMMarker[],
  onUpdate: (clusterId: string, label: string) => void,
) {
  const ids = [...pendingIds];
  pendingIds.clear();

  const markerMap = new Map(markers.map((m) => [m.id, m]));

  for (const clusterId of ids) {
    const cluster = allClusters.find((c) => c.id === clusterId);
    if (!cluster) continue;

    const memberMarkers = cluster.memberIds
      .map((id) => markerMap.get(id))
      .filter((m): m is TOMMarker => !!m);

    if (memberMarkers.length === 0) continue;

    const markerLines = memberMarkers
      .map((m, i) => {
        const ctx = (m.extendedContext || '').slice(0, 500);
        return `${i + 1}. "${m.label}" — ${ctx}`;
      })
      .join('\n');

    const neighborLabels = getNeighborLabels(cluster, allClusters);
    const neighborLine = neighborLabels.length > 0
      ? `\nOther nearby cluster titles: ${neighborLabels.join(', ')}\n`
      : '';

    const previousLine = cluster.previousLabel
      ? `Previous title: "${cluster.previousLabel}"\n`
      : '';

    const prompt = `You are labeling a cluster of related TOM (Top of Mind) markers.

${previousLine}This cluster has ${memberMarkers.length} markers:
${markerLines}
${neighborLine}
Generate a concise 1-3 word label capturing the shared theme.
Be specific enough to distinguish from other clusters listed.
Return ONLY the label, nothing else.`;

    try {
      const raw = await callLLM(prompt);
      let label = raw.trim().replace(/^["']|["']$/g, '');
      if (label.length > 40) label = label.slice(0, 40);
      if (label) {
        onUpdate(clusterId, label);
      }
    } catch (err) {
      console.warn(`[clusterLabeler] Failed to label cluster ${clusterId}:`, err);
      // Keep existing label — no retry
    }
  }
}

export function requestClusterLabeling(
  clusterIds: string[],
  allClusters: ClusterNode[],
  markers: TOMMarker[],
  onUpdate: (clusterId: string, label: string) => void,
): void {
  for (const id of clusterIds) pendingIds.add(id);

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processQueue(allClusters, markers, onUpdate);
  }, DEBOUNCE_MS);
}
