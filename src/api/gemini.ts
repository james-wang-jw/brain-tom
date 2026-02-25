import type { Message } from '../types/index.ts';
import { logRequest, logResponse } from '../utils/logRequest.ts';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

function buildContents(messages: Message[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

export async function streamGemini(
  modelId: string,
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: Error) => void,
): Promise<void> {
  const _logMeta = { provider: 'gemini', model: modelId, type: 'stream' as const };
  logRequest({
    ..._logMeta,
    systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const _startTime = performance.now();

  const url = `${BASE_URL}/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: buildContents(messages),
    generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(`Gemini API error (${response.status}): ${errorBody}`);
      logResponse({ ..._logMeta, error: err.message, durationMs: Math.round(performance.now() - _startTime) });
      onError(err);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const err = new Error('No response body');
      logResponse({ ..._logMeta, error: err.message, durationMs: Math.round(performance.now() - _startTime) });
      onError(err);
      return;
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullText += text;
              onChunk(fullText);
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    }

    logResponse({ ..._logMeta, output: fullText, durationMs: Math.round(performance.now() - _startTime) });
    onDone(fullText);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logResponse({ ..._logMeta, error: error.message, durationMs: Math.round(performance.now() - _startTime) });
    onError(error);
  }
}

export async function callGemini(modelId: string, apiKey: string, prompt: string): Promise<string> {
  const _logMeta = { provider: 'gemini', model: modelId, type: 'completion' as const };
  logRequest({ ..._logMeta, prompt });
  const _startTime = performance.now();

  const url = `${BASE_URL}/${modelId}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
  });

  if (!response.ok) {
    const err = new Error(`Gemini API error: ${response.status}`);
    logResponse({ ..._logMeta, error: err.message, durationMs: Math.round(performance.now() - _startTime) });
    throw err;
  }

  const data = await response.json();
  const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  logResponse({ ..._logMeta, output, durationMs: Math.round(performance.now() - _startTime) });
  return output;
}
