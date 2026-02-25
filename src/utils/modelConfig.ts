export type Provider = 'gemini' | 'anthropic';

export interface ModelDef {
  id: string;
  name: string;
  provider: Provider;
}

export const MODELS: ModelDef[] = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'gemini' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'gemini' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-5', name: 'Claude 4.5 Opus', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
];

const CHAT_KEY = 'tom-chat-model';
const RELEVANCE_KEY = 'tom-relevance-model';

export function getChatModelId(): string {
  return localStorage.getItem(CHAT_KEY) || 'gemini-3-flash-preview';
}

export function setChatModelId(id: string): void {
  localStorage.setItem(CHAT_KEY, id);
}

export function getRelevanceModelId(): string {
  return localStorage.getItem(RELEVANCE_KEY) || 'gemini-3-flash-preview';
}

export function setRelevanceModelId(id: string): void {
  localStorage.setItem(RELEVANCE_KEY, id);
}

export function getChatModel(): ModelDef {
  const id = getChatModelId();
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

export function getRelevanceModel(): ModelDef {
  const id = getRelevanceModelId();
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

export function getModelsForProvider(provider: Provider): ModelDef[] {
  return MODELS.filter((m) => m.provider === provider);
}

// === Search mode ===

export type SearchMode = 'embedding' | 'llm';

const SEARCH_MODE_KEY = 'tom-search-mode';

export function getSearchMode(): SearchMode {
  const stored = localStorage.getItem(SEARCH_MODE_KEY);
  if (stored === 'llm') return 'llm';
  return 'embedding';
}

export function setSearchMode(mode: SearchMode): void {
  localStorage.setItem(SEARCH_MODE_KEY, mode);
}

/** Returns the set of providers currently in use (for showing API key fields). */
export function getActiveProviders(): Set<Provider> {
  const providers = new Set<Provider>();
  providers.add(getChatModel().provider);
  providers.add(getRelevanceModel().provider);
  return providers;
}
