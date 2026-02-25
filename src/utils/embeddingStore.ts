import * as db from '../db/index.ts';
import { embedText } from '../api/embedding.ts';
import { hasApiKey } from './apiKey.ts';
import type { TOMMarker } from '../types/index.ts';

// In-memory cache of embeddings, hydrated from IDB on init
const cache = new Map<string, number[]>();
let initialized = false;

export async function init(): Promise<void> {
  if (initialized) return;
  const rows = await db.getAllEmbeddings();
  for (const row of rows) {
    cache.set(row.markerId, row.vector);
  }
  initialized = true;
}

export function getEmbedding(markerId: string): number[] | undefined {
  return cache.get(markerId);
}

export async function setEmbedding(markerId: string, vector: number[]): Promise<void> {
  cache.set(markerId, vector);
  await db.saveEmbedding(markerId, vector);
}

export async function deleteEmbedding(markerId: string): Promise<void> {
  cache.delete(markerId);
  await db.deleteEmbedding(markerId);
}

export function clearAll(): void {
  cache.clear();
  // IDB clearing is handled by db.clearAllData()
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function getAllCachedIds(): string[] {
  return [...cache.keys()];
}

export function getCacheSnapshot(): Map<string, number[]> {
  return new Map(cache);
}

/**
 * Embed any markers that are missing vectors. Fire-and-forget, rate-limited.
 */
export async function backfillEmbeddings(markers: TOMMarker[]): Promise<void> {
  if (!hasApiKey('gemini')) return;

  const missing = markers.filter((m) => !cache.has(m.id));
  if (missing.length === 0) return;

  console.log(`[embeddingStore] Backfilling ${missing.length} marker embeddings...`);

  for (const marker of missing) {
    try {
      const text = marker.label + ' ' + (marker.extendedContext || '');
      const vector = await embedText(text);
      await setEmbedding(marker.id, vector);
    } catch (err) {
      console.warn(`[embeddingStore] Failed to backfill embedding for ${marker.id}:`, err);
    }
    // Rate-limit: small delay between calls
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[embeddingStore] Backfill complete.`);
}
