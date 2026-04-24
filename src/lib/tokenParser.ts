import type { ModelPreset } from './userSecrets';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: a.costUsd + b.costUsd,
    durationMs: a.durationMs + b.durationMs,
  };
}

export function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function isTrackable(preset: ModelPreset | null): boolean {
  if (!preset || !preset.trackTokens) return false;
  return preset.cli === 'claude';
}

/**
 * Returns the args to actually spawn with. For tracked Claude runs we
 * inject --output-format stream-json --verbose so the CLI emits
 * token/usage events we can parse. We also strip conflicting
 * --output-format and --verbose flags the user might have set.
 */
export function argsForRun(preset: ModelPreset, prompt: string): string[] {
  if (!isTrackable(preset)) {
    return [...preset.args, prompt];
  }
  const out: string[] = [];
  for (let i = 0; i < preset.args.length; i++) {
    const a = preset.args[i];
    if (a === '--output-format' && i + 1 < preset.args.length) {
      i++; // skip value
      continue;
    }
    if (a === '--verbose' || a === '-v') continue;
    out.push(a);
  }
  out.push('--output-format', 'stream-json', '--verbose');
  out.push(prompt);
  return out;
}

interface ParserState {
  buffer: string;
}

export function makeParser(): ParserState {
  return { buffer: '' };
}

export interface ParseResult {
  textAppend: string; // text to treat as user-visible response delta
  activity?: string[]; // new tool/progress lines observed this chunk
  usage?: Usage; // present when the final result event arrives
  errored?: string; // error message from a result event
}

/**
 * Feed raw stdout bytes; returns any extracted text delta + final usage.
 * Claude Code emits one JSON object per line in stream-json mode.
 */
export function feedClaudeStream(
  state: ParserState,
  chunk: string,
  prevText: string,
): ParseResult {
  state.buffer += chunk;
  let textAppend = '';
  const activity: string[] = [];
  let usage: Usage | undefined;
  let errored: string | undefined;
  let newPrevText = prevText;
  let nl: number;
  while ((nl = state.buffer.indexOf('\n')) >= 0) {
    const line = state.buffer.slice(0, nl).trim();
    state.buffer = state.buffer.slice(nl + 1);
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== 'object') continue;
    const e = evt as Record<string, unknown>;
    if (e.type === 'assistant' && e.message && typeof e.message === 'object') {
      const msg = e.message as Record<string, unknown>;
      const content = msg.content;
      if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const bt = (block as { type?: string }).type;
          if (bt === 'text') {
            const t = (block as { text?: string }).text;
            if (typeof t === 'string') texts.push(t);
          } else if (bt === 'tool_use') {
            const name = (block as { name?: string }).name ?? 'tool';
            const input = (block as { input?: Record<string, unknown> }).input ?? {};
            const summary = summarizeToolUse(name, input);
            if (summary) activity.push(summary);
          }
        }
        const fullText = texts.join('');
        if (fullText.length >= newPrevText.length && fullText.startsWith(newPrevText)) {
          textAppend += fullText.slice(newPrevText.length);
          newPrevText = fullText;
        } else if (fullText && fullText !== newPrevText) {
          // Restart of text (new turn / tool round). Append what's new.
          textAppend += (newPrevText ? '\n' : '') + fullText;
          newPrevText = fullText;
        }
      }
    } else if (e.type === 'result') {
      if (e.is_error) {
        errored = (e.result as string) || 'error';
      } else if (
        textAppend.length === 0 &&
        typeof e.result === 'string' &&
        e.result.length > newPrevText.length &&
        e.result.startsWith(newPrevText)
      ) {
        textAppend += e.result.slice(newPrevText.length);
        newPrevText = e.result;
      }
      const u = e.usage as Record<string, number> | undefined;
      usage = {
        inputTokens: (u?.input_tokens as number) ?? 0,
        outputTokens: (u?.output_tokens as number) ?? 0,
        cacheReadTokens: (u?.cache_read_input_tokens as number) ?? 0,
        cacheCreationTokens: (u?.cache_creation_input_tokens as number) ?? 0,
        costUsd:
          typeof e.total_cost_usd === 'number' ? (e.total_cost_usd as number) : 0,
        durationMs:
          typeof e.duration_ms === 'number' ? (e.duration_ms as number) : 0,
      };
    }
  }
  return { textAppend, activity: activity.length ? activity : undefined, usage, errored };
}

function summarizeToolUse(name: string, input: Record<string, unknown>): string | null {
  const firstString = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v) return v;
    }
    return null;
  };
  const truncate = (s: string, n = 80) =>
    s.length > n ? s.slice(0, n) + '…' : s;
  switch (name) {
    case 'Bash': {
      const cmd = firstString('command');
      return cmd ? `$ ${truncate(cmd, 120)}` : '$ (bash)';
    }
    case 'Read':
    case 'view_file':
      return `→ read ${firstString('file_path', 'path') ?? ''}`;
    case 'Edit':
    case 'edit_file':
      return `→ edit ${firstString('file_path', 'path') ?? ''}`;
    case 'Write':
    case 'write_file':
      return `→ write ${firstString('file_path', 'path') ?? ''}`;
    case 'Glob':
      return `→ glob ${firstString('pattern') ?? ''}`;
    case 'Grep':
    case 'search':
      return `→ grep ${truncate(firstString('pattern', 'query') ?? '', 60)}`;
    case 'WebFetch':
      return `→ fetch ${firstString('url') ?? ''}`;
    case 'TodoWrite':
      return '→ updated todo list';
    default:
      return `→ ${name}`;
  }
}
