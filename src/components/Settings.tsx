import { useState, useEffect, useCallback } from 'react';
import { getApiKey, setApiKey, clearApiKey, hasApiKey } from '../utils/apiKey.ts';
import {
  type Provider,
  type SearchMode,
  getChatModel,
  getRelevanceModel,
  setChatModelId,
  setRelevanceModelId,
  getModelsForProvider,
  getSearchMode,
  setSearchMode,
} from '../utils/modelConfig.ts';
import { useChatStore } from '../stores/chatStore.ts';
import { getAllClusters, deleteCluster as deleteClusterFromDB } from '../db/index.ts';
import styles from '../styles/Settings.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'anthropic', label: 'Claude' },
];

function ModelSelector({
  label,
  provider,
  modelId,
  onProviderChange,
  onModelChange,
}: {
  label: string;
  provider: Provider;
  modelId: string;
  onProviderChange: (p: Provider) => void;
  onModelChange: (id: string) => void;
}) {
  const models = getModelsForProvider(provider);

  return (
    <div className={styles.selectorRow}>
      <span className={styles.selectorLabel}>{label}</span>
      <select
        className={styles.select}
        value={provider}
        onChange={(e) => onProviderChange(e.target.value as Provider)}
      >
        {PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <select
        className={`${styles.select} ${styles.selectModel}`}
        value={modelId}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}

export default function Settings({ open, onClose }: Props) {
  const clearAllData = useChatStore((s) => s.clearAllData);

  const [chatProvider, setChatProvider] = useState<Provider>('gemini');
  const [chatModelId, setChatModelIdLocal] = useState('');
  const [relProvider, setRelProvider] = useState<Provider>('gemini');
  const [relModelId, setRelModelIdLocal] = useState('');

  const [searchMode, setSearchModeLocal] = useState<SearchMode>('embedding');

  const [geminiKey, setGeminiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [clustersCleared, setClustersCleared] = useState(false);

  useEffect(() => {
    if (!open) return;
    const chat = getChatModel();
    const rel = getRelevanceModel();
    setChatProvider(chat.provider);
    setChatModelIdLocal(chat.id);
    setRelProvider(rel.provider);
    setRelModelIdLocal(rel.id);
    setSearchModeLocal(getSearchMode());
    setGeminiKey(getApiKey('gemini'));
    setAnthropicKey(getApiKey('anthropic'));
    setConfirmClear(false);
    setCleared(false);
    setClustersCleared(false);
  }, [open]);

  const relActive = searchMode === 'llm';
  const needsGemini = chatProvider === 'gemini' || (relActive && relProvider === 'gemini') || searchMode === 'embedding';
  const needsAnthropic = chatProvider === 'anthropic' || (relActive && relProvider === 'anthropic');

  const handleChatProviderChange = useCallback((p: Provider) => {
    setChatProvider(p);
    const models = getModelsForProvider(p);
    if (models.length > 0) {
      setChatModelIdLocal(models[0].id);
      setChatModelId(models[0].id);
    }
  }, []);

  const handleChatModelChange = useCallback((id: string) => {
    setChatModelIdLocal(id);
    setChatModelId(id);
  }, []);

  const handleRelProviderChange = useCallback((p: Provider) => {
    setRelProvider(p);
    const models = getModelsForProvider(p);
    if (models.length > 0) {
      setRelModelIdLocal(models[0].id);
      setRelevanceModelId(models[0].id);
    }
  }, []);

  const handleRelModelChange = useCallback((id: string) => {
    setRelModelIdLocal(id);
    setRelevanceModelId(id);
  }, []);

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    setSearchModeLocal(mode);
    setSearchMode(mode);
  }, []);

  const handleSaveKey = useCallback((p: Provider) => {
    const key = p === 'gemini' ? geminiKey : anthropicKey;
    if (key.trim()) {
      setApiKey(key.trim(), p);
      setSaved(p);
      setTimeout(() => setSaved(null), 2000);
    }
  }, [geminiKey, anthropicKey]);

  const handleClearKey = useCallback((p: Provider) => {
    clearApiKey(p);
    if (p === 'gemini') setGeminiKey('');
    else setAnthropicKey('');
  }, []);

  const handleClearClusters = useCallback(async () => {
    const clusters = await getAllClusters();
    for (const c of clusters) {
      await deleteClusterFromDB(c.id);
    }
    setClustersCleared(true);
    window.dispatchEvent(new Event('tom-clusters-cleared'));
    setTimeout(() => setClustersCleared(false), 2000);
  }, []);

  const handleClearAllData = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearAllData();
    setConfirmClear(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  }, [confirmClear, clearAllData]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            &#10005;
          </button>
        </div>

        {/* Search mode */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Search</div>
          <div className={styles.selectorRow}>
            <span className={styles.selectorLabel}>Mode</span>
            <select
              className={`${styles.select} ${styles.selectModel}`}
              value={searchMode}
              onChange={(e) => handleSearchModeChange(e.target.value as SearchMode)}
            >
              <option value="embedding">Embedding (faster, Gemini key required)</option>
              <option value="llm">LLM (uses Related model)</option>
            </select>
          </div>
          {searchMode === 'embedding' && !hasApiKey('gemini') && (
            <div className={styles.keyHint}>Requires a Gemini API key</div>
          )}
        </div>

        {/* Model selectors */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Models</div>
          <ModelSelector
            label="Chat"
            provider={chatProvider}
            modelId={chatModelId}
            onProviderChange={handleChatProviderChange}
            onModelChange={handleChatModelChange}
          />
          {searchMode === 'llm' && (
            <ModelSelector
              label="Related"
              provider={relProvider}
              modelId={relModelId}
              onProviderChange={handleRelProviderChange}
              onModelChange={handleRelModelChange}
            />
          )}
        </div>

        {/* API Keys — only for selected providers */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>API Keys</div>

          {needsGemini && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Gemini
                {hasApiKey('gemini') && <span className={styles.keyBadge}>configured</span>}
              </label>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Gemini API key..."
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey('gemini'); }}
                />
                <button className={styles.saveBtn} onClick={() => handleSaveKey('gemini')}>Save</button>
                {hasApiKey('gemini') && (
                  <button className={styles.clearBtn} onClick={() => handleClearKey('gemini')}>Clear</button>
                )}
              </div>
              {saved === 'gemini' && <div className={styles.statusOk}>Saved!</div>}
              {!hasApiKey('gemini') && (
                <div className={styles.keyHint}>
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                    Get a key from Google AI Studio
                  </a>
                </div>
              )}
            </div>
          )}

          {needsAnthropic && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Anthropic
                {hasApiKey('anthropic') && <span className={styles.keyBadge}>configured</span>}
              </label>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="Anthropic API key..."
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey('anthropic'); }}
                />
                <button className={styles.saveBtn} onClick={() => handleSaveKey('anthropic')}>Save</button>
                {hasApiKey('anthropic') && (
                  <button className={styles.clearBtn} onClick={() => handleClearKey('anthropic')}>Clear</button>
                )}
              </div>
              {saved === 'anthropic' && <div className={styles.statusOk}>Saved!</div>}
              {!hasApiKey('anthropic') && (
                <div className={styles.keyHint}>
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                    Get a key from Anthropic Console
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Data */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Data</div>
          <div className={styles.dangerRow}>
            {clustersCleared ? (
              <span className={styles.statusOk}>Clusters cleared! They will regenerate on next load.</span>
            ) : (
              <button className={styles.clearBtn} onClick={handleClearClusters}>Clear clusters</button>
            )}
          </div>
          <div className={styles.dangerRow}>
            {cleared ? (
              <span className={styles.statusOk}>All data cleared!</span>
            ) : confirmClear ? (
              <>
                <span className={styles.confirmText}>This cannot be undone.</span>
                <button className={styles.dangerBtn} onClick={handleClearAllData}>Yes, clear everything</button>
                <button className={styles.clearBtn} onClick={() => setConfirmClear(false)}>Cancel</button>
              </>
            ) : (
              <button className={styles.dangerBtn} onClick={handleClearAllData}>Clear all data</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
