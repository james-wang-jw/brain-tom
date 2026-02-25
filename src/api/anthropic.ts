import type { Message } from '../types/index.ts';
import { logRequest, logResponse } from '../utils/logRequest.ts';

const BASE_URL = 'https://api.anthropic.com/v1';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildMessages(messages: Message[]): AnthropicMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export async function streamAnthropic(
  modelId: string,
  apiKey: string,
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: Error) => void,
): Promise<void> {
  const _logMeta = { provider: 'anthropic', model: modelId, type: 'stream' as const };
  logRequest({
    ..._logMeta,
    systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const _startTime = performance.now();

  const body = {
    model: modelId,
    max_tokens: 8192,
    system: systemPrompt,
    messages: buildMessages(messages),
    stream: true,
  };

  try {
    const response = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(`Claude API error (${response.status}): ${errorBody}`);
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
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
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

export async function callAnthropic(modelId: string, apiKey: string, prompt: string): Promise<string> {
  const _logMeta = { provider: 'anthropic', model: modelId, type: 'completion' as const };
  logRequest({ ..._logMeta, prompt });
  const _startTime = performance.now();

  const response = await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = new Error(`Claude API error: ${response.status}`);
    logResponse({ ..._logMeta, error: err.message, durationMs: Math.round(performance.now() - _startTime) });
    throw err;
  }

  const data = await response.json();
  const output = data?.content?.[0]?.text || '';
  logResponse({ ..._logMeta, output, durationMs: Math.round(performance.now() - _startTime) });
  return output;
}
