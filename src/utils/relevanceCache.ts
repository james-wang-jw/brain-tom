import type { TOMMarker } from '../types/index.ts';

interface CacheEntry {
  cacheKey: string;
  results: { marker: TOMMarker; reason: string }[];
}

const STORAGE_KEY = 'tom-relevance-cache';

// In-memory cache, hydrated from sessionStorage on load
const cacheMap = new Map<string, CacheEntry>();

function hydrate(): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries: [string, CacheEntry][] = JSON.parse(raw);
      for (const [scope, entry] of entries) {
        cacheMap.set(scope, entry);
      }
    }
  } catch {
    // Ignore corrupt storage
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...cacheMap.entries()]));
  } catch {
    // Ignore quota errors
  }
}

// Hydrate on module load
hydrate();

export function getCached(scope: string, cacheKey: string): { marker: TOMMarker; reason: string }[] | null {
  const entry = cacheMap.get(scope);
  if (entry && entry.cacheKey === cacheKey) return entry.results;
  return null;
}

export function setCache(scope: string, cacheKey: string, results: { marker: TOMMarker; reason: string }[]): void {
  cacheMap.set(scope, { cacheKey, results });
  persist();
}

export function clearCache(scope?: string): void {
  if (scope) {
    cacheMap.delete(scope);
  } else {
    cacheMap.clear();
  }
  persist();
}
