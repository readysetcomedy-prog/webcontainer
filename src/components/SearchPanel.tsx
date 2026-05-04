import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '../types';

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  // The matching line, with a small window around it so results are
  // legible without opening the file.
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchPanelProps {
  files: FileEntry[];
  onJumpTo: (hit: SearchHit) => void;
  // Reset the input from outside (e.g. when the user switches projects).
  resetKey?: string | null;
}

const MAX_HITS_PER_FILE = 20;
const MAX_TOTAL_HITS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip files bigger than 2MB

const SKIP_DIR_RE =
  /(^|\/)(node_modules|\.git|dist|build|\.next|\.expo|\.expo-shared|\.metro|coverage|\.cache|out)(\/|$)/;

const TEXT_EXT_RE =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|html?|css|scss|sass|less|svg|ya?ml|toml|sql|py|rb|go|rs|java|kt|swift|c|cpp|hpp?|sh|bash|zsh|env|php|lua|txt|xml|gradle|properties|gitignore|dockerfile|makefile)$/i;

function isSearchable(file: FileEntry): boolean {
  if (typeof file.content !== 'string') return false;
  if (file.content.length > MAX_FILE_BYTES) return false;
  if (SKIP_DIR_RE.test(file.path)) return false;
  // Files without an extension are usually configs / dotfiles — search them.
  if (!file.path.includes('.')) return true;
  return TEXT_EXT_RE.test(file.path);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RawHit {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

function searchFile(
  content: string,
  re: RegExp,
  capPerFile: number,
): RawHit[] {
  const out: RawHit[] = [];
  // Iterate line by line so we can report line numbers cheaply.
  let lineNo = 0;
  let lastIdx = 0;
  while (lastIdx <= content.length) {
    const nl = content.indexOf('\n', lastIdx);
    const end = nl < 0 ? content.length : nl;
    const line = content.slice(lastIdx, end);
    lineNo++;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      out.push({
        line: lineNo,
        column: m.index + 1,
        preview: line,
        matchStart: m.index,
        matchEnd: m.index + m[0].length,
      });
      if (out.length >= capPerFile) return out;
      if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on /a*/
    }
    if (nl < 0) break;
    lastIdx = nl + 1;
  }
  return out;
}

export default function SearchPanel({
  files,
  onJumpTo,
  resetKey,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when the project changes.
  useEffect(() => {
    setQuery('');
    setDebounced('');
  }, [resetKey]);

  // Debounce query → search trigger.
  useEffect(() => {
    if (!query.trim()) {
      setDebounced('');
      return;
    }
    setSearching(true);
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { results, totalHits, truncated, error } = useMemo(() => {
    const q = debounced.trim();
    if (!q) {
      return { results: [] as { path: string; hits: RawHit[] }[], totalHits: 0, truncated: false, error: null as string | null };
    }
    let pattern: string;
    try {
      if (regex) {
        // Validate user-provided regex.
        new RegExp(q);
        pattern = q;
      } else {
        pattern = escapeRegExp(q);
      }
      if (wholeWord) pattern = `\\b${pattern}\\b`;
    } catch (e) {
      return { results: [], totalHits: 0, truncated: false, error: (e as Error).message };
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return { results: [], totalHits: 0, truncated: false, error: (e as Error).message };
    }
    const grouped: { path: string; hits: RawHit[] }[] = [];
    let total = 0;
    let truncated = false;
    for (const f of files) {
      if (!isSearchable(f)) continue;
      const remaining = MAX_TOTAL_HITS - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const cap = Math.min(MAX_HITS_PER_FILE, remaining);
      const hits = searchFile(f.content as string, re, cap);
      if (hits.length > 0) {
        grouped.push({ path: f.path, hits });
        total += hits.length;
      }
    }
    grouped.sort((a, b) => a.path.localeCompare(b.path));
    return { results: grouped, totalHits: total, truncated, error: null };
  }, [debounced, files, caseSensitive, wholeWord, regex]);

  useEffect(() => {
    if (!debounced.trim()) {
      setSearching(false);
      return;
    }
    // useMemo above is synchronous so by the time the next render runs
    // results are populated; flip the spinner off.
    setSearching(false);
  }, [debounced, results]);

  // Cmd/Ctrl+Shift+F focuses the search input from anywhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const renderPreview = (hit: RawHit) => {
    const before = hit.preview.slice(0, hit.matchStart);
    const match = hit.preview.slice(hit.matchStart, hit.matchEnd);
    const after = hit.preview.slice(hit.matchEnd);
    // Trim ridiculously long lines so each row stays scannable.
    const trim = (s: string, max: number, fromEnd = false) =>
      s.length > max ? (fromEnd ? '…' + s.slice(-max) : s.slice(0, max) + '…') : s;
    return (
      <>
        <span className="search-hit-before">{trim(before, 60, true)}</span>
        <mark className="search-hit-match">{trim(match, 80)}</mark>
        <span className="search-hit-after">{trim(after, 80)}</span>
      </>
    );
  };

  return (
    <div className="search-panel">
      <div className="search-input-row">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search files… (Cmd/Ctrl+Shift+F)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => setQuery('')}
            title="Clear"
            type="button"
          >
            ✕
          </button>
        )}
      </div>
      <div className="search-options">
        <button
          className={`search-option ${caseSensitive ? 'on' : ''}`}
          onClick={() => setCaseSensitive((v) => !v)}
          title="Match case"
          type="button"
        >
          Aa
        </button>
        <button
          className={`search-option ${wholeWord ? 'on' : ''}`}
          onClick={() => setWholeWord((v) => !v)}
          title="Whole word"
          type="button"
        >
          ab
        </button>
        <button
          className={`search-option ${regex ? 'on' : ''}`}
          onClick={() => setRegex((v) => !v)}
          title="Regular expression"
          type="button"
        >
          .*
        </button>
      </div>
      <div className="search-results">
        {error && <div className="search-error">{error}</div>}
        {!error && debounced && !searching && totalHits === 0 && (
          <div className="search-empty">No matches.</div>
        )}
        {!error && debounced && (
          <div className="search-summary">
            {totalHits} match{totalHits === 1 ? '' : 'es'} in {results.length}{' '}
            file{results.length === 1 ? '' : 's'}
            {truncated && ' (truncated)'}
          </div>
        )}
        {results.map((g) => (
          <div key={g.path} className="search-file-group">
            <div className="search-file-header" title={g.path}>
              {g.path}
              <span className="search-file-count">{g.hits.length}</span>
            </div>
            {g.hits.map((h, i) => (
              <button
                key={`${g.path}:${h.line}:${h.column}:${i}`}
                className="search-hit-row"
                onClick={() =>
                  onJumpTo({
                    path: g.path,
                    line: h.line,
                    column: h.column,
                    preview: h.preview,
                    matchStart: h.matchStart,
                    matchEnd: h.matchEnd,
                  })
                }
                title={`${g.path}:${h.line}:${h.column}`}
              >
                <span className="search-hit-line">{h.line}</span>
                <span className="search-hit-text">{renderPreview(h)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
