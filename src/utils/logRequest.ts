/**
 * Logs LLM API request details to the browser console.
 * Called at the start of every LLM invocation (stream or single).
 */
export function logRequest(info: {
  provider: string;
  model: string;
  type: 'stream' | 'completion';
  systemPrompt?: string;
  messages?: { role: string; content: string }[];
  prompt?: string;
}) {
  const timestamp = new Date().toLocaleTimeString();

  console.group(`%c[LLM REQ ${info.type}] ${info.provider} / ${info.model}  @ ${timestamp}`, 'color: #7c8aff; font-weight: bold');

  if (info.systemPrompt) {
    console.groupCollapsed('System prompt');
    console.log(info.systemPrompt);
    console.groupEnd();
  }

  if (info.messages && info.messages.length > 0) {
    console.groupCollapsed(`Messages (${info.messages.length})`);
    for (const m of info.messages) {
      console.log(`%c${m.role}:%c ${m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content}`,
        'color: #f0a; font-weight: bold', 'color: inherit');
    }
    console.groupEnd();
  }

  if (info.prompt) {
    console.groupCollapsed('Prompt');
    console.log(info.prompt);
    console.groupEnd();
  }

  console.groupEnd();
}

/**
 * Logs LLM API response details to the browser console.
 * Called when an LLM invocation completes (or errors).
 */
export function logResponse(info: {
  provider: string;
  model: string;
  type: 'stream' | 'completion';
  output?: string;
  error?: string;
  durationMs?: number;
}) {
  const timestamp = new Date().toLocaleTimeString();
  const duration = info.durationMs != null ? ` (${info.durationMs}ms)` : '';

  if (info.error) {
    console.group(`%c[LLM ERR ${info.type}] ${info.provider} / ${info.model}${duration}  @ ${timestamp}`, 'color: #ef4444; font-weight: bold');
    console.error(info.error);
    console.groupEnd();
    return;
  }

  console.group(`%c[LLM RES ${info.type}] ${info.provider} / ${info.model}${duration}  @ ${timestamp}`, 'color: #22c55e; font-weight: bold');

  if (info.output) {
    console.groupCollapsed(`Output (${info.output.length} chars)`);
    console.log(info.output);
    console.groupEnd();
  }

  console.groupEnd();
}
