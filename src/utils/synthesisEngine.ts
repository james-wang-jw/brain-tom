import { getApiKey } from './apiKey.ts';
import { getRelevanceModel } from './modelConfig.ts';
import { callGemini } from '../api/gemini.ts';
import { callAnthropic } from '../api/anthropic.ts';
import { getEmbedding, cosineSimilarity } from './embeddingStore.ts';
import { MARKER_SIMILARITY_THRESHOLD } from '../api/relevance.ts';
import { getSynthesis, saveSynthesis, deleteSynthesis } from '../db/index.ts';
import type { TOMMarker, MarkerSynthesis } from '../types/index.ts';

function callLLM(prompt: string): Promise<string> {
  const model = getRelevanceModel();
  const apiKey = getApiKey(model.provider);
  if (!apiKey) throw new Error('No API key for synthesis');

  if (model.provider === 'anthropic') {
    return callAnthropic(model.id, apiKey, prompt);
  }
  return callGemini(model.id, apiKey, prompt);
}

/** Find adjacent markers with cosine similarity >= threshold */
export function getAdjacentMarkers(markerId: string, markers: TOMMarker[]): TOMMarker[] {
  const emb = getEmbedding(markerId);
  if (!emb) return [];

  const adjacent: TOMMarker[] = [];
  for (const m of markers) {
    if (m.id === markerId) continue;
    const vec = getEmbedding(m.id);
    if (!vec) continue;
    if (cosineSimilarity(emb, vec) >= MARKER_SIMILARITY_THRESHOLD) {
      adjacent.push(m);
    }
  }
  return adjacent;
}

/** djb2 hash → base36 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Deterministic hash of a marker's neighborhood */
export function computeNeighborhoodHash(markerId: string, markers: TOMMarker[]): string {
  const center = markers.find((m) => m.id === markerId);
  if (!center) return '';

  const adjacent = getAdjacentMarkers(markerId, markers);
  const adjIds = adjacent.map((m) => m.id).sort();

  const parts = [
    center.label,
    center.extendedContext?.slice(0, 200) ?? '',
    ...adjIds.flatMap((id) => {
      const m = markers.find((mk) => mk.id === id);
      return m ? [m.id, m.label, (m.extendedContext || '').slice(0, 200)] : [];
    }),
  ];

  return djb2(parts.join('|'));
}

/** Generate synthesis text via LLM */
async function generateSynthesisText(center: TOMMarker, adjacentMarkers: TOMMarker[]): Promise<string> {
  const related = adjacentMarkers
    .map((m, i) => `${i + 1}. "${m.label}" — ${(m.extendedContext || '').slice(0, 300)}`)
    .join('\n');

  const prompt = `You are a helpful personal assistant. The user has these thoughts on their mind:

Main thought: "${center.label}" — ${(center.extendedContext || '').slice(0, 400)}

Related thoughts:
${related}

Write 1-2 sentences addressed to the user (use "you") that connect these thoughts and offer a helpful next step or insight. Be conversational and action-oriented, like a personal assistant. Return ONLY the text.`;

  return callLLM(prompt);
}

/** Request synthesis for a marker — uses cache, calls LLM on miss */
export function requestSynthesis(
  markerId: string,
  markers: TOMMarker[],
  onResult: (text: string) => void,
): void {
  const center = markers.find((m) => m.id === markerId);
  if (!center) return;

  const emb = getEmbedding(markerId);
  if (!emb) return;

  const adjacent = getAdjacentMarkers(markerId, markers);
  if (adjacent.length === 0) return;

  const hash = computeNeighborhoodHash(markerId, markers);

  getSynthesis(markerId).then(async (cached) => {
    if (cached && cached.neighborhoodHash === hash) {
      onResult(cached.text);
      return;
    }

    try {
      const text = await generateSynthesisText(center, adjacent);
      const clean = text.trim();
      if (!clean) return;

      const synthesis: MarkerSynthesis = {
        markerId,
        text: clean,
        neighborhoodHash: hash,
        generatedAt: Date.now(),
      };
      await saveSynthesis(synthesis);
      onResult(clean);
    } catch (err) {
      console.warn('[synthesisEngine] Failed to generate synthesis:', err);
    }
  });
}

/** Invalidate cached syntheses for markers adjacent to changed markers */
export function invalidateAdjacentSyntheses(changedMarkerIds: string[], markers: TOMMarker[]): void {
  const toInvalidate = new Set<string>();

  for (const changedId of changedMarkerIds) {
    toInvalidate.add(changedId);
    const adjacent = getAdjacentMarkers(changedId, markers);
    for (const m of adjacent) {
      toInvalidate.add(m.id);
    }
  }

  for (const id of toInvalidate) {
    deleteSynthesis(id);
  }
}
