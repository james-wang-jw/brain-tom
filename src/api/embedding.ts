import { getApiKey } from '../utils/apiKey.ts';
import { logRequest, logResponse } from '../utils/logRequest.ts';

const EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

export async function embedText(text: string): Promise<number[]> {
  const apiKey = getApiKey('gemini');
  if (!apiKey) throw new Error('No Gemini API key configured');

  const _logMeta = { provider: 'gemini', model: 'gemini-embedding-001', type: 'completion' as const };
  logRequest({ ..._logMeta, prompt: `[embed] ${text.slice(0, 120)}` });
  const startTime = performance.now();

  const response = await fetch(`${EMBEDDING_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY',
      output_dimensionality: 768,
    }),
  });

  if (!response.ok) {
    const errMsg = `Gemini Embedding API error: ${response.status}`;
    logResponse({ ..._logMeta, error: errMsg, durationMs: Math.round(performance.now() - startTime) });
    throw new Error(errMsg);
  }

  const data = await response.json();
  const values: number[] = data?.embedding?.values;
  if (!values || !Array.isArray(values)) {
    const errMsg = 'Unexpected embedding response shape';
    logResponse({ ..._logMeta, error: errMsg, durationMs: Math.round(performance.now() - startTime) });
    throw new Error(errMsg);
  }

  logResponse({
    ..._logMeta,
    output: `[${values.length}-dim vector]`,
    durationMs: Math.round(performance.now() - startTime),
  });

  return values;
}
