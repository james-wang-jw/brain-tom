import type { Provider } from './modelConfig.ts';

const KEYS: Record<Provider, { storage: string; env: string }> = {
  gemini: { storage: 'tom-gemini-api-key', env: 'VITE_GEMINI_API_KEY' },
  anthropic: { storage: 'tom-anthropic-api-key', env: 'VITE_ANTHROPIC_API_KEY' },
};

export function getApiKey(provider: Provider): string {
  const { storage, env } = KEYS[provider];
  const stored = localStorage.getItem(storage);
  if (stored) return stored;
  return (import.meta.env as Record<string, string>)[env] || '';
}

export function setApiKey(key: string, provider: Provider): void {
  localStorage.setItem(KEYS[provider].storage, key);
}

export function clearApiKey(provider: Provider): void {
  localStorage.removeItem(KEYS[provider].storage);
}

export function hasApiKey(provider: Provider): boolean {
  return getApiKey(provider).length > 0;
}
