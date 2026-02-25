import { getApiKey } from '../utils/apiKey.ts';
import { getRelevanceModel } from '../utils/modelConfig.ts';
import { callGemini } from './gemini.ts';
import { callAnthropic } from './anthropic.ts';
import { embedText } from './embedding.ts';
import { getEmbedding, cosineSimilarity } from '../utils/embeddingStore.ts';
import type { TOMMarker } from '../types/index.ts';

interface RelevanceResult {
  index: number;
  reason: string;
}

async function callLLM(prompt: string): Promise<string> {
  const model = getRelevanceModel();
  const apiKey = getApiKey(model.provider);
  if (!apiKey) throw new Error('No API key');

  if (model.provider === 'anthropic') {
    return callAnthropic(model.id, apiKey, prompt);
  }
  return callGemini(model.id, apiKey, prompt);
}

export async function searchTOMs(
  query: string,
  markers: TOMMarker[],
): Promise<{ marker: TOMMarker; reason: string }[]> {
  if (!markers.length || !query.trim()) return [];

  const markerList = markers
    .map((m, i) => `[${i}] Label: "${m.label}" | Context: ${m.extendedContext}`)
    .join('\n');

  const prompt = `Given this search query: "${query}"

And these TOM (Top of Mind) markers from various conversations. Each marker has a label and a rich context describing the user's focus, key concepts, abbreviations, and related topics:
${markerList}

Match the query against both labels AND context. Consider abbreviations, synonyms, related concepts, and partial matches. For example, if a marker's context mentions "TOM (Top of Mind)" and the query is "top of mind", that marker is relevant.

Return the most relevant markers (up to 8) as a JSON array. Each item should have:
- "index": the marker index number
- "reason": a brief explanation of why it's relevant (under 60 chars)

Only include markers that are genuinely relevant to the query. If none are relevant, return an empty array.
Return ONLY the JSON array, no other text.`;

  try {
    const response = await callLLM(prompt);
    const cleaned = response.replace(/```json\n?|\n?```/g, '').trim();
    const ranked: { index: number; reason: string }[] = JSON.parse(cleaned);
    return ranked
      .filter((r) => r.index >= 0 && r.index < markers.length)
      .map((r) => ({ marker: markers[r.index], reason: r.reason }));
  } catch {
    return [];
  }
}

export async function getRelevantTOMs(
  recentContext: string,
  markers: TOMMarker[],
): Promise<{ markers: { marker: TOMMarker; reason: string }[]; confident: boolean }> {
  if (!markers.length) return { markers: [], confident: false };
  if (!recentContext.trim()) return { markers: [], confident: false };

  const markerList = markers
    .map((m, i) => `[${i}] Label: "${m.label}" | Context: ${m.extendedContext}`)
    .join('\n');

  const prompt = `Based on this recent conversation context:
"${recentContext.slice(0, 500)}"

And these TOM (Top of Mind) markers from other conversations. Each marker has a label and a rich context describing the user's focus, key concepts, abbreviations, and related topics:
${markerList}

Tasks:
1. Assess if the recent context is substantive enough to find relevant markers (not just greetings, trivial queries, or small talk). Answer "confident: true/false".
2. If confident, return ONLY markers that are genuinely related to the recent context. A marker is relevant if it shares topics, concepts, tools, goals, or domain with the current context. Do NOT include markers that are unrelated — if a marker has nothing to do with the current context, leave it out entirely.

IMPORTANT: The "reason" field must explain WHY the marker IS relevant (e.g. "Both discuss Italian restaurants in Tokyo"). Never include a marker with a reason like "does not relate" or "not relevant" — simply omit those markers.

Return ONLY a JSON object with this shape:
{"confident": boolean, "results": [{"index": number, "reason": string}]}

If not confident or no markers are relevant, return {"confident": false, "results": []}.
Return ONLY the JSON, no other text.`;

  try {
    const response = await callLLM(prompt);
    const cleaned = response.replace(/```json\n?|\n?```/g, '').trim();
    const parsed: { confident: boolean; results: RelevanceResult[] } =
      JSON.parse(cleaned);

    if (!parsed.confident) return { markers: [], confident: false };

    const ranked = (parsed.results || [])
      .filter((r) => r.index >= 0 && r.index < markers.length)
      .map((r) => ({
        marker: markers[r.index],
        reason: r.reason,
      }));

    return { markers: ranked, confident: true };
  } catch {
    return { markers: [], confident: false };
  }
}

// === Embedding-based search ===

export const EMBEDDING_THRESHOLD = 0.77;

export async function searchTOMsEmbedding(
  query: string,
  markers: TOMMarker[],
): Promise<{ marker: TOMMarker; reason: string }[]> {
  if (!markers.length || !query.trim()) return [];

  const queryVector = await embedText(query);

  console.group(`%c[Embedding Search] query: "${query}"`, 'color: #7c8aff; font-weight: bold');
  const scored: { marker: TOMMarker; score: number }[] = [];
  for (const marker of markers) {
    const vec = getEmbedding(marker.id);
    if (!vec) {
      console.log(`  %c${marker.label}%c — no embedding`, 'color: #f0a', 'color: #888');
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    const pass = score >= EMBEDDING_THRESHOLD;
    console.log(
      `  %c${marker.label}%c — ${(score * 100).toFixed(1)}%${pass ? ' ✓' : ''}`,
      'color: #f0a',
      pass ? 'color: #22c55e' : 'color: #888',
    );
    if (pass) {
      scored.push({ marker, score });
    }
  }
  console.groupEnd();

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 8).map((s) => ({
    marker: s.marker,
    reason: '',
  }));
}

export async function getRelevantTOMsEmbedding(
  recentContext: string,
  markers: TOMMarker[],
): Promise<{ markers: { marker: TOMMarker; reason: string }[]; confident: boolean }> {
  if (!markers.length || !recentContext.trim()) return { markers: [], confident: false };

  const contextVector = await embedText(recentContext.slice(0, 500));

  console.group(`%c[Embedding Relevance] context: "${recentContext.slice(0, 80)}..."`, 'color: #7c8aff; font-weight: bold');
  const scored: { marker: TOMMarker; score: number }[] = [];
  for (const marker of markers) {
    const vec = getEmbedding(marker.id);
    if (!vec) {
      console.log(`  %c${marker.label}%c — no embedding`, 'color: #f0a', 'color: #888');
      continue;
    }
    const score = cosineSimilarity(contextVector, vec);
    const pass = score >= EMBEDDING_THRESHOLD;
    console.log(
      `  %c${marker.label}%c — ${(score * 100).toFixed(1)}%${pass ? ' ✓' : ''}`,
      'color: #f0a',
      pass ? 'color: #22c55e' : 'color: #888',
    );
    if (pass) {
      scored.push({ marker, score });
    }
  }
  console.groupEnd();

  scored.sort((a, b) => b.score - a.score);

  const confident = scored.length > 0;
  const results = scored.slice(0, 8).map((s) => ({
    marker: s.marker,
    reason: '',
  }));

  return { markers: results, confident };
}
