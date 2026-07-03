import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Toolbar from './components/Toolbar';
import FileTree from './components/FileTree';
import SearchPanel from './components/SearchPanel';
import type { JumpTarget } from './components/CodeEditor';
import CodeEditor from './components/CodeEditor';
import Preview from './components/Preview';
import Terminal from './components/Terminal';
import ProjectsSection from './components/ProjectsSection';
import GetTradingPage from './components/GetTradingPage';
import type { FileEntry, LogLine } from './types';
import { filesToTree, getContainer, readAllFiles } from './lib/webcontainer';
import type { GhUser } from './lib/github';
import {
  base64ToBytes,
  fetchRepoFiles,
  getUser,
  isBinaryPath,
  parseRepoInput,
} from './lib/github';
import PushDialog from './components/PushDialog';
import PullDialog from './components/PullDialog';
import { deployToNetlify } from './lib/netlify';
import JSZip from 'jszip';
import { STARTER_FILES } from './lib/starter';
import type { Project } from './lib/projects';
import {
  createLocalProject,
  deleteProjectRemote,
  fetchProjects,
  findOrCreateProject,
  renameGroup,
  updateProjectFields,
} from './lib/projectsRemote';
import { supabase } from './lib/supabase';
import { fetchUserSecrets, saveUserSecrets } from './lib/userSecrets';
import Toasts from './components/Toasts';
import type { Toast } from './components/Toasts';
import type { Session } from '@supabase/supabase-js';
import LoginGate from './components/LoginGate';
import LandingPage from './components/LandingPage';
import ChatPanel from './components/ChatPanel';
import Onboarding from './components/Onboarding';
import SettingsModal from './components/SettingsModal';
import ModelFormModal from './components/ModelFormModal';
import Tour from './components/Tour';
import { getTourSteps } from './lib/tourSteps';
import type { ModelPreset } from './lib/userSecrets';
import { AgentClient, type AgentInfo } from './lib/agentClient';

// VT100 tokens for the log panel's line-oriented terminal emulation.
// TOKEN matches one complete control unit: a CSI sequence (ESC[…letter),
// an OSC sequence (ESC]…BEL / ESC\), or a line move (\r\n, \r, \n).
// CARRY matches an INCOMPLETE trailing sequence — a lone ESC, a partial
// CSI without its final letter, or a bare \r that might pair with a \n
// in the next chunk — which must be held back and prepended to the next
// chunk, because process streams split escape sequences arbitrarily.
/* eslint-disable no-control-regex */
const TERM_TOKEN_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\r\n|\r|\n/g;
const TERM_CARRY_RE = /(?:\x1b(?:\[[0-9;?]*)?|\x1b\][^\x07\x1b]*|\r)$/;
/* eslint-enable no-control-regex */

const textOf = (c: string | Uint8Array): string =>
  typeof c === 'string' ? c : new TextDecoder('utf-8').decode(c);

function useIsMobile(): boolean {
  const query = '(max-width: 768px)';
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

type MobilePane = 'files' | 'editor' | 'preview' | 'console';

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>(STARTER_FILES);
  const [activePath, setActivePath] = useState<string | null>('src/App.jsx');
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [booting, setBooting] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [ghToken, setGhTokenState] = useState<string>('');
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [netlifyToken, setNetlifyTokenState] = useState<string>('');
  const [currentRepoKey, setCurrentRepoKey] = useState<string | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [exampleEnv, setExampleEnv] = useState<string | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  // Per-tab active project. We DON'T fall back to lastActiveProjectId
  // (which is shared across tabs via Supabase) until we've checked
  // sessionStorage first — otherwise opening a second tab would
  // silently inherit whatever project the most recent tab touched, and
  // the user could deploy/push to the wrong site without realising it.
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    () => {
      try {
        return sessionStorage.getItem('activeProjectId');
      } catch {
        return null;
      }
    },
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [agentInfo, setAgentInfoState] = useState<AgentInfo | null>(null);
  const agentRef = useRef<AgentClient | null>(null);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'chat'>('terminal');
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem('onboardingDismissed') === '1',
  );
  const [models, setModels] = useState<ModelPreset[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() =>
    localStorage.getItem('selectedModelId'),
  );
  const [modelModal, setModelModal] = useState<
    { kind: 'new' } | { kind: 'edit'; preset: ModelPreset } | null
  >(null);
  const [tourOpen, setTourOpen] = useState(false);
  const isMobile = useIsMobile();
  const [mobilePane, setMobilePane] = useState<MobilePane>('preview');

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      if (agentRef.current) {
        agentRef.current.disconnect();
        agentRef.current = null;
      }
      setAgentInfoState(null);
      return;
    }
    const client = new AgentClient(session.user.id);
    agentRef.current = client;
    const off = client.onAgent((info) => setAgentInfoState(info));
    client.connect();
    return () => {
      off();
      client.disconnect();
      if (agentRef.current === client) agentRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      setProjects([]);
      setGhTokenState('');
      setGhUser(null);
      setNetlifyTokenState('');
      setActiveProjectIdState(null);
      return;
    }
    (async () => {
      try {
        const [projs, secrets] = await Promise.all([
          fetchProjects(),
          fetchUserSecrets(),
        ]);
        setProjects(projs);
        setGhTokenState(secrets.githubToken);
        setNetlifyTokenState(secrets.netlifyToken);
        setModels(secrets.models);
        // Honour what this tab already had in sessionStorage; only fall
        // back to the cross-tab lastActiveProjectId if this tab is fresh.
        const tabActive = (() => {
          try {
            return sessionStorage.getItem('activeProjectId');
          } catch {
            return null;
          }
        })();
        if (tabActive && projs.some((p) => p.id === tabActive)) {
          setActiveProjectIdState(tabActive);
        } else if (
          secrets.lastActiveProjectId &&
          projs.some((p) => p.id === secrets.lastActiveProjectId)
        ) {
          setActiveProjectIdState(secrets.lastActiveProjectId);
        }
        const savedModel = localStorage.getItem('selectedModelId');
        if (!savedModel || !secrets.models.some((m) => m.id === savedModel)) {
          setSelectedModelId(secrets.models[0]?.id ?? null);
        }
      } catch (e) {
        console.error('Failed to load session data', e);
      }
    })();
  }, [session]);

  const saveModelsRemote = useCallback(
    (next: ModelPreset[]) => {
      if (!session) return;
      saveUserSecrets(session.user.id, { models: next }).catch((e) =>
        console.error('save models failed', e),
      );
    },
    [session],
  );

  const upsertModel = useCallback(
    (preset: ModelPreset) => {
      setModels((prev) => {
        const idx = prev.findIndex((m) => m.id === preset.id);
        const next = idx >= 0 ? prev.map((m) => (m.id === preset.id ? preset : m)) : [...prev, preset];
        saveModelsRemote(next);
        return next;
      });
      setSelectedModelId(preset.id);
      localStorage.setItem('selectedModelId', preset.id);
    },
    [saveModelsRemote],
  );

  const deleteModel = useCallback(
    (id: string) => {
      setModels((prev) => {
        const next = prev.filter((m) => m.id !== id);
        saveModelsRemote(next);
        return next;
      });
      if (selectedModelId === id) {
        setSelectedModelId(null);
        localStorage.removeItem('selectedModelId');
      }
    },
    [saveModelsRemote, selectedModelId],
  );

  const selectModel = useCallback((id: string) => {
    setSelectedModelId(id);
    localStorage.setItem('selectedModelId', id);
  }, []);

  const persistSecret = useCallback(
    (patch: {
      githubToken?: string;
      netlifyToken?: string;
      lastActiveProjectId?: string | null;
    }) => {
      if (!session) return;
      saveUserSecrets(session.user.id, patch).catch((e) =>
        console.error('save secret failed', e),
      );
    },
    [session],
  );
  const logIdRef = useRef(0);
  const containerRef = useRef<WebContainer | null>(null);
  const devProcRef = useRef<WebContainerProcess | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    try {
      if (activeProjectId) {
        sessionStorage.setItem('activeProjectId', activeProjectId);
      } else {
        sessionStorage.removeItem('activeProjectId');
      }
    } catch {
      // session storage disabled (private mode in some browsers); fine
    }
  }, [activeProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const currentLocalPath: string | null =
    activeProject && agentInfo
      ? activeProject.pathsByMachine?.[agentInfo.host] ??
        activeProject.localPath ??
        null
      : null;
  const agentMode = !!(currentLocalPath && agentInfo);
  const localPathRef = useRef<string | null>(null);
  useEffect(() => {
    localPathRef.current = currentLocalPath;
  }, [currentLocalPath]);

  const log = useCallback((text: string, kind: LogLine['kind'] = 'out') => {
    setLogs((prev) => [...prev, { id: ++logIdRef.current, text, kind }]);
  }, []);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const notify = useCallback(
    (
      kind: Toast['kind'],
      message: string,
      extras?: { url?: string; urlLabel?: string },
    ) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, kind, message, ...extras }]);
    },
    [],
  );
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getStoredEnv = useCallback(
    (): string => activeProject?.envContent ?? '',
    [activeProject],
  );
  const setStoredEnv = useCallback(
    (_repoKey: string, content: string) => {
      if (!activeProject) {
        log('Env not saved: no active project yet. Open a repo first.', 'err');
        return;
      }
      updateProjectFields(activeProject.id, { envContent: content })
        .then((saved) =>
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx < 0) return [saved, ...prev];
            const next = [...prev];
            next[idx] = saved;
            return next;
          }),
        )
        .catch((e) => log(`Save env failed: ${(e as Error).message}`, 'err'));
    },
    [activeProject, log],
  );

  useEffect(() => {
    if (!ghToken || ghUser) return;
    let cancelled = false;
    getUser(ghToken)
      .then((u) => {
        if (!cancelled) setGhUser(u);
      })
      .catch((e) => {
        if (cancelled) return;
        log(`Stored GitHub token is no longer valid: ${(e as Error).message}`, 'err');
        setGhTokenState('');
        persistSecret({ githubToken: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [ghToken, ghUser, log, persistSecret]);

  const connectGitHub = useCallback(
    (token: string, user: GhUser) => {
      setGhTokenState(token);
      setGhUser(user);
      persistSecret({ githubToken: token });
    },
    [persistSecret],
  );

  const disconnectGitHub = useCallback(() => {
    setGhTokenState('');
    setGhUser(null);
    persistSecret({ githubToken: '' });
  }, [persistSecret]);

  const setNetlifyToken = useCallback(
    (value: string) => {
      setNetlifyTokenState(value);
      persistSecret({ netlifyToken: value });
    },
    [persistSecret],
  );

  useEffect(() => {
    // Heads-up on small screens: WebContainer works in modern mobile Chrome,
    // but big npm installs can hit mobile memory limits. Warn and continue —
    // don't hard-block. (Previously this gate skipped the boot entirely,
    // which also silently disabled Deploy on phones since deploy() needs the
    // container. Let it try; real failures surface in the terminal.)
    if (window.matchMedia('(max-width: 768px)').matches) {
      log(
        'Mobile detected — Run/Preview is experimental on phones. Large npm installs may run out of memory; if an install hangs, try desktop. Everything else (edit, deploy, push) works here.',
        'info',
      );
    }
    if (!globalThis.crossOriginIsolated) {
      const host = window.location.hostname;
      const secureHost =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        window.location.protocol === 'https:';
      if (!secureHost) {
        log(
          `Page is not a secure context (current host: ${host}). WebContainer needs localhost, 127.0.0.1, or HTTPS. Try opening http://localhost:${window.location.port || '5173'} instead.`,
          'err',
        );
        setStatus('not cross-origin isolated');
      } else {
        log(
          'Page is not cross-origin isolated. The dev server should send COOP/COEP headers; try a hard refresh (Cmd/Ctrl+Shift+R) to bypass a cached response.',
          'err',
        );
        setStatus('not cross-origin isolated');
      }
      return;
    }
    let cancelled = false;
    setBooting(true);
    setStatus('booting WebContainer…');
    (async () => {
      try {
        const c = await getContainer();
        if (cancelled) return;
        containerRef.current = c;
        await c.mount(filesToTree(STARTER_FILES));
        c.on('server-ready', (_port, url) => {
          setPreviewUrl(url);
          setStatus(`preview ready: ${url}`);
        });
        c.on('error', (e) => log(`[container] ${e.message}`, 'err'));
        log('WebContainer booted.', 'info');
        setStatus('ready');
      } catch (e) {
        log(`Boot failed: ${(e as Error).message}`, 'err');
        setStatus('boot failed');
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log]);

  // Line-oriented terminal emulation, one stateful sink per process.
  // Bundler/npm output redraws progress in place with VT100 sequences
  // (cursor-up ESC[1A, erase-line ESC[2K, carriage returns) and the stream
  // chunks split those sequences ARBITRARILY — a naive per-chunk stripper
  // leaks fragments like "22m" when ESC[2 lands in one chunk and 2m in the
  // next. The sink carries incomplete trailing sequences between chunks,
  // tracks which visual line the cursor is on, and edits existing log
  // entries in place for redraws — so a progress bar renders as one line
  // updating in place, exactly like a real terminal.
  const makeTerminalSink = useCallback(
    (kind: LogLine['kind']) => {
      let carry = '';
      const lineIds: number[] = [];
      const lineTexts = new Map<number, string>();
      let openIndex = 0;
      let openText = '';

      const ensureEntry = (): number => {
        while (lineIds.length <= openIndex) {
          const id = ++logIdRef.current;
          lineIds.push(id);
          lineTexts.set(id, '');
          setLogs((prev) => [...prev, { id, text: '', kind }]);
        }
        return lineIds[openIndex];
      };
      const flush = () => {
        const id = ensureEntry();
        if (lineTexts.get(id) === openText) return;
        lineTexts.set(id, openText);
        const snapshot = openText;
        setLogs((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].id === id) {
              const copy = prev.slice();
              copy[i] = { ...copy[i], text: snapshot };
              return copy;
            }
          }
          return prev;
        });
      };
      const moveTo = (index: number) => {
        flush();
        openIndex = Math.max(0, index);
        const id = lineIds[openIndex];
        openText = id !== undefined ? lineTexts.get(id) ?? '' : '';
      };
      const writeText = (t: string) => {
        if (!t) return;
        for (const ch of t) {
          if (ch === '\x08') openText = openText.slice(0, -1);
          else if (ch === '\x07' || ch === '\x1b') continue;
          else openText += ch;
        }
        flush();
      };

      return (chunkText: string) => {
        const input = carry + chunkText;
        const held = input.match(TERM_CARRY_RE);
        const src = held ? input.slice(0, input.length - held[0].length) : input;
        carry = held ? held[0] : '';
        if (!src) return;

        let last = 0;
        let m: RegExpExecArray | null;
        TERM_TOKEN_RE.lastIndex = 0;
        while ((m = TERM_TOKEN_RE.exec(src))) {
          writeText(src.slice(last, m.index));
          last = m.index + m[0].length;
          const tok = m[0];
          if (tok === '\n' || tok === '\r\n') {
            moveTo(openIndex + 1);
          } else if (tok === '\r') {
            // Cursor to column 0 — following text overwrites the line.
            openText = '';
          } else if (tok.charCodeAt(0) === 0x1b && tok[1] === '[') {
            const final = tok[tok.length - 1];
            const n = parseInt(tok.slice(2, -1), 10) || 1;
            if (final === 'A') moveTo(openIndex - n);
            else if (final === 'B') moveTo(openIndex + n);
            else if (final === 'K') {
              openText = '';
              flush();
            } else if (final === 'D' || final === 'G') {
              // Column moves — progress bars use these like \r.
              openText = '';
            }
            // 'm' (styles), 'J', 'H', private modes: no visual effect here.
          }
          // OSC (title set): ignored.
        }
        writeText(src.slice(last));
      };
    },
    [],
  );

  const pipeProcess = useCallback(
    (p: WebContainerProcess, kind: LogLine['kind'] = 'out') => {
      const sink = makeTerminalSink(kind);
      const decoder = new TextDecoder();
      p.output.pipeTo(
        new WritableStream({
          write(chunk) {
            sink(
              typeof chunk === 'string'
                ? chunk
                : decoder.decode(chunk, { stream: true }),
            );
          },
        }),
      );
    },
    [makeTerminalSink],
  );

  // Bundler / dev-server error surfaced above the preview. Stripped of
  // ANSI codes and shown to the user so they don't have to dig through
  // the terminal to find what broke.
  const [devError, setDevError] = useState<string | null>(null);
  // Pipes the dev process's output through the same logs panel as
  // pipeProcess, but additionally scans for known error signatures and
  // bubbles them up to the studio surface. Cleared on the next
  // successful "Bundled" / "ready" line.
  const stripAnsi = (s: string) =>
    // eslint-disable-next-line no-control-regex
    s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const ERROR_HINT = /(^|\n)\s*(error:|SyntaxError:|TypeError:|Bundling failed|Failed to compile|Unable to resolve module|Cannot find module|Module not found)/i;
  const SUCCESS_HINT = /(Web Bundled|Bundled \d+ms|compiled successfully|ready in \d+ms|Local:\s+http)/i;
  const pipeDev = useCallback(
    (p: WebContainerProcess) => {
      let buffer = '';
      const sink = makeTerminalSink('out');
      const decoder = new TextDecoder();
      p.output.pipeTo(
        new WritableStream({
          write(chunk) {
            const text =
              typeof chunk === 'string'
                ? chunk
                : decoder.decode(chunk, { stream: true });
            sink(text);
            buffer = (buffer + stripAnsi(text)).slice(-4000); // keep last few KB
            if (ERROR_HINT.test(buffer)) {
              // Grab the error line + the next ~6 lines of context.
              const idx = buffer.search(ERROR_HINT);
              const tail = buffer.slice(idx).split('\n').slice(0, 8).join('\n').trim();
              setDevError(tail);
            } else if (SUCCESS_HINT.test(buffer)) {
              setDevError(null);
            }
          },
        }),
      );
    },
    [makeTerminalSink],
  );

  // Stable ref so callers (including effects) can rely on runDev's
  // identity not changing every time the file list updates. Without this
  // the auto-resync effect would re-run -> re-runDev -> setFiles ->
  // re-run effect, looping forever.
  const filesRef = useRef<FileEntry[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Track which project's deps are currently sitting in WebContainer's
  // /node_modules. If you switch to a different project we wipe before
  // installing — node_modules is shared across project boots in this
  // container, and Expo's peer-dep web is too brittle to survive
  // leftovers from a different project's tree.
  const installedForProjectRef = useRef<string | null>(null);

  // A generation token bumped any time the active project / path changes.
  // runDev captures it once at the top of the call; every await checks
  // that the token is still current and bails if not. Without this, a
  // slow `npm install` from project A could keep streaming output and
  // eventually call setPreviewUrl on the wrong project.
  const runGenRef = useRef(0);

  const runDev = useCallback(
    async (filesOverride?: FileEntry[]) => {
      const c = containerRef.current;
      if (!c) return;
      const gen = ++runGenRef.current;
      const projectFiles = filesOverride ?? filesRef.current;
      const pkg = projectFiles.find((f) => f.path === 'package.json');
      if (!pkg) {
        log('No package.json found — skipping install/run.', 'info');
        setStatus('ready (no package.json)');
        return;
      }
      let scripts: Record<string, string> = {};
      let deps: Record<string, string> = {};
      try {
        const parsed = JSON.parse(textOf(pkg.content));
        scripts = parsed.scripts ?? {};
        deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      } catch {
        log('Could not parse package.json.', 'err');
      }
      // Pick the right web-dev script. Expo projects often have a stray
      // `dev` script (or none) but also include a Vite config from a
      // template — picking `dev` would launch Vite on 5173 against a
      // file tree that has no Vite entry. Detect Expo and prefer its
      // own scripts; fall back to the generic order otherwise.
      const isExpo = !!deps.expo || !!deps['expo-router'];
      const order = isExpo
        ? ['web', 'start', 'dev']
        : ['dev', 'start', 'serve'];
      const startScript = order.find((name) => scripts[name]) ?? null;

      // Project changed since the last install? Wipe node_modules so the
      // new tree gets a clean install. Stay quiet otherwise — same
      // project re-runs (HMR config edit, manual Run) keep the cache
      // and reinstall fast.
      const projectId = activeProjectIdRef.current;
      const projectChanged =
        !!projectId && installedForProjectRef.current !== projectId;
      if (projectChanged) {
        setStatus('clearing previous project node_modules…');
        log('$ rm -rf /node_modules /package-lock.json', 'info');
        for (const dir of ['/node_modules', '/package-lock.json']) {
          try {
            const rm = await c.spawn('rm', ['-rf', dir]);
            if (runGenRef.current !== gen) {
              try { rm.kill(); } catch {}
              return;
            }
            await rm.exit;
          } catch {
            // already absent
          }
        }
      }

      setRunning(true);
      setStatus('installing dependencies…');
      // Expo's web target peer-deps tree doesn't satisfy npm's strict
      // resolver in many template versions; --legacy-peer-deps is what
      // every Expo doc recommends and what every CI uses.
      const installArgs = isExpo
        ? ['install', '--legacy-peer-deps']
        : ['install'];
      log(`$ npm ${installArgs.join(' ')}`, 'info');
      const install = await c.spawn('npm', installArgs);
      if (runGenRef.current !== gen) {
        try { install.kill(); } catch {}
        return;
      }
      pipeProcess(install);
      const code = await install.exit;
      if (runGenRef.current !== gen) return;
      if (code !== 0) {
        log(`npm install exited with code ${code}`, 'err');
        setStatus('install failed');
        setRunning(false);
        return;
      }
      installedForProjectRef.current = projectId ?? null;
      // Expo with no explicit web script: invoke `expo start --web` directly.
      // Pass --clear so Metro starts with a fresh cache — between project
      // switches its cache from the previous project routinely poisons the
      // next bundle (the entry.bundle 500 / "MIME type application/json"
      // errors come from there).
      let dev;
      if (isExpo) {
        // Belt and suspenders: nuke the on-disk caches that survive
        // npm install and the --clear flag's cleanup. node_modules/.cache
        // is Metro's transformer cache; .expo is Expo CLI's project
        // cache; .metro is some plugins' overflow. After a project
        // switch any of those can hold references to files that no
        // longer exist in the new tree.
        for (const dir of ['/node_modules/.cache', '/.expo', '/.expo-shared', '/.metro']) {
          try {
            const rm = await c.spawn('rm', ['-rf', dir]);
            if (runGenRef.current !== gen) {
              try { rm.kill(); } catch {}
              return;
            }
            await rm.exit;
          } catch {
            // dir didn't exist — fine
          }
        }
      }
      if (!startScript && isExpo) {
        setStatus('starting (expo start --web --clear)…');
        log('$ npx expo start --web --clear', 'info');
        dev = await c.spawn('npx', ['expo', 'start', '--web', '--clear']);
      } else if (!startScript) {
        log('No dev/start/serve/web script found in package.json.', 'info');
        setStatus('installed (no start script)');
        setRunning(false);
        return;
      } else if (isExpo) {
        // The user has a `web`/`start`/`dev` script but it's an Expo
        // project. Forward --clear through `npm run` so Metro still
        // gets the fresh-cache flag even though we're not invoking
        // expo directly.
        setStatus(`starting (npm run ${startScript} -- --clear)…`);
        log(`$ npm run ${startScript} -- --clear`, 'info');
        dev = await c.spawn('npm', ['run', startScript, '--', '--clear']);
      } else {
        setStatus(`starting (npm run ${startScript})…`);
        log(`$ npm run ${startScript}`, 'info');
        dev = await c.spawn('npm', ['run', startScript]);
      }
      if (runGenRef.current !== gen) {
        try { dev.kill(); } catch {}
        return;
      }
      devProcRef.current = dev;
      pipeDev(dev);
      setDevError(null); // fresh boot wipes the previous error banner
      dev.exit.then((exitCode) => {
        // If a newer dev process has replaced us (because we restarted
        // after a pull or full re-sync), let it own the state. Otherwise
        // we'd clear the new process's ref/preview from this old handler.
        if (devProcRef.current !== dev) return;
        log(`dev server exited (${exitCode})`, 'info');
        devProcRef.current = null;
        setRunning(false);
        setPreviewUrl(null);
        setStatus('stopped');
      });
    },
    [log, pipeProcess],
  );

  const stopDev = useCallback(() => {
    const p = devProcRef.current;
    if (!p) return;
    devProcRef.current = null; // detach immediately so the next runDev owns state
    try {
      p.kill();
    } catch {
      // already exited
    }
  }, []);

  // Coalesced restart. Multiple callers (the auto-resync effect, the
  // watcher's config-file detector, onPulled) can ask to restart while a
  // bulk operation is still flooding files in. We kill the dev server
  // immediately on the first call so it stops choking on mid-write
  // configs, then wait for the file flood to quiet down before booting
  // the new one. Each new request resets the timer.
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledRestart = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);
  const scheduleRestart = useCallback(
    (filesOverride?: FileEntry[]) => {
      stopDev();
      cancelScheduledRestart();
      const snapshot = filesOverride;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        runDev(snapshot ?? filesRef.current).catch((e) =>
          log(`Auto-restart failed: ${(e as Error).message}`, 'err'),
        );
      }, 800);
    },
    [cancelScheduledRestart, log, runDev, stopDev],
  );


  const loadFromAgent = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      const a = agentRef.current;
      if (!a || !path) return [];
      setStatus(`listing ${path}…`);
      const { entries } = await a.list(path, true);
      const filePaths = entries.filter((e) => !e.isDir).map((e) => e.path);
      setStatus(`reading ${filePaths.length} files from your laptop…`);
      const root = path.replace(/\/$/, '');
      const fileEntries: FileEntry[] = [];
      const concurrency = 12;
      let idx = 0;
      let done = 0;
      async function worker() {
        const agent = a!;
        while (idx < filePaths.length) {
          const i = idx++;
          const p = filePaths[i];
          try {
            // Binary files (jpg/png/etc.) round-trip via base64 — UTF-8
            // decoding mangles them into invalid bytes that break Metro
            // and Vite when they try to bundle the asset.
            if (isBinaryPath(p)) {
              const { content } = await agent.readFile(
                `${root}/${p}`,
                'base64',
              );
              fileEntries.push({ path: p, content: base64ToBytes(content) });
            } else {
              const { content } = await agent.readFile(`${root}/${p}`);
              fileEntries.push({ path: p, content });
            }
          } catch {
            // Skip unreadable (permission, etc.) — preview can survive
          }
          done++;
          if (done % 25 === 0) {
            setStatus(`reading ${done}/${filePaths.length} files from your laptop…`);
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, filePaths.length) }, worker),
      );
      return fileEntries;
    },
    [],
  );

  const pullRef = useCallback(
    async (ref: { owner: string; repo: string; ref?: string }) => {
      const c = containerRef.current;
      if (!c || !session) return;
      try {
        stopDev();

        const repoKey = `${ref.owner}/${ref.repo}`;
        const branchUsed = ref.ref ?? 'main';

        let project: Project;
        try {
          project = await findOrCreateProject(
            session.user.id,
            ref.owner,
            ref.repo,
            branchUsed,
          );
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === project.id);
            if (idx < 0) return [project, ...prev];
            const next = [...prev];
            next[idx] = project;
            return next;
          });
          setActiveProjectIdState(project.id);
          persistSecret({ lastActiveProjectId: project.id });
        } catch (e) {
          log(`Couldn't save project record: ${(e as Error).message}`, 'err');
          return;
        }

        setCurrentRepoKey(repoKey);
        setCurrentBranch(branchUsed);

        const pathForThisMachine = agentInfo
          ? project.pathsByMachine?.[agentInfo.host] ?? project.localPath ?? null
          : null;
        const useAgent = !!(pathForThisMachine && agentInfo);

        let fetched: FileEntry[];
        if (useAgent) {
          log(`Loading from your laptop: ${pathForThisMachine}`, 'info');
          fetched = await loadFromAgent(pathForThisMachine!);
          if (fetched.length === 0) {
            log(
              `No readable files found at ${pathForThisMachine}. Make sure the path is correct.`,
              'err',
            );
            notify('error', `No files found at ${pathForThisMachine}`);
            setStatus('agent load failed');
            return;
          }
        } else {
          setStatus(`fetching ${ref.owner}/${ref.repo}…`);
          log(
            `Pulling ${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ''}`,
            'info',
          );
          fetched = await fetchRepoFiles(ref, ghToken || undefined, (d, t) => {
            setStatus(`fetching ${d}/${t} files…`);
          });
        }

        setStatus(`mounting ${fetched.length} files…`);
        await c.mount(filesToTree(fetched));
        setFiles(fetched);
        setDirtyPaths(new Set());
        const firstCodeFile = fetched.find((f) =>
          /\.(tsx?|jsx?|html|css|md|json)$/i.test(f.path),
        );
        setActivePath(firstCodeFile?.path ?? fetched[0]?.path ?? null);

        const example = fetched.find((f) =>
          /^\.env\.(example|template|sample)$/i.test(f.path),
        );
        setExampleEnv(example ? textOf(example.content) : null);

        if (project.envContent) {
          await c.fs.writeFile('/.env.local', project.envContent);
          log(
            `Wrote .env.local (${project.envContent.split('\n').filter(Boolean).length} values).`,
            'info',
          );
        } else if (example) {
          log(
            `This repo has ${example.path}. Click "Env vars" to set values before running.`,
            'info',
          );
        }

        log(`Loaded ${fetched.length} files.`, 'info');
        notify(
          'success',
          useAgent
            ? `Loaded ${project.owner}/${project.repo}@${branchUsed} from your laptop`
            : `Pulled ${ref.owner}/${ref.repo}@${branchUsed} (${fetched.length} files)`,
        );
        setStatus('ready');
        await runDev(fetched);
      } catch (e) {
        const msg = (e as Error).message;
        log(`Pull failed: ${msg}`, 'err');
        notify('error', `Pull failed: ${msg}`);
        setStatus('pull failed');
      }
    },
    [agentInfo, ghToken, loadFromAgent, log, notify, persistSecret, runDev, session, stopDev],
  );

  const openUrl = useCallback(
    async (repoInput: string) => {
      try {
        const ref = parseRepoInput(repoInput);
        await pullRef(ref);
      } catch (e) {
        log(`Pull failed: ${(e as Error).message}`, 'err');
        setStatus('pull failed');
      }
    },
    [log, pullRef],
  );

  const selectBranch = useCallback(
    (owner: string, repo: string, branch: string) => {
      pullRef({ owner, repo, ref: branch });
    },
    [pullRef],
  );

  const openProject = useCallback(
    (p: Project) => {
      // Local-only project: just make it active. The watcher useEffect picks
      // it up from there and mounts disk -> WebContainer.
      if (!p.owner || !p.repo) {
        setActiveProjectIdState(p.id);
        persistSecret({ lastActiveProjectId: p.id });
        setCurrentRepoKey(null);
        setCurrentBranch(null);
        return;
      }
      pullRef({ owner: p.owner, repo: p.repo, ref: p.branch ?? undefined });
    },
    [pullRef, persistSecret],
  );

  const saveCurrentProject = useCallback(
    async (name: string) => {
      if (!activeProject) {
        log('Open a repo first — it saves automatically.', 'err');
        return;
      }
      try {
        const saved = await updateProjectFields(activeProject.id, { name });
        setProjects((prev) =>
          prev.map((x) => (x.id === saved.id ? saved : x)),
        );
        log(`Renamed project to "${name}".`, 'info');
      } catch (e) {
        log(`Rename failed: ${(e as Error).message}`, 'err');
      }
    },
    [activeProject, log],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      try {
        const saved = await updateProjectFields(id, { name });
        setProjects((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      } catch (e) {
        log(`Rename failed: ${(e as Error).message}`, 'err');
      }
    },
    [log],
  );

  const createLocalProjectFromUI = useCallback(
    async (name: string, path: string, groupName?: string | null) => {
      if (!session) throw new Error('Sign in first.');
      if (!agentInfo) throw new Error('Connect the local agent first.');
      const project = await createLocalProject(
        session.user.id,
        name,
        agentInfo.host,
        path,
        groupName,
      );
      setProjects((prev) => [project, ...prev]);
      // Activate it; the watcher useEffect will mount disk -> WebContainer.
      stopDev();
      setActiveProjectIdState(project.id);
      persistSecret({ lastActiveProjectId: project.id });
      setCurrentRepoKey(null);
      setCurrentBranch(null);
      log(`Created local project "${name}" at ${path}`, 'info');
      notify('success', `Opened ${path}`);
    },
    [agentInfo, log, notify, session, stopDev],
  );

  const setProjectGroup = useCallback(
    async (id: string, groupName: string | null) => {
      try {
        const saved = await updateProjectFields(id, { groupName });
        setProjects((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        log(
          groupName
            ? `Moved "${saved.name}" to group "${groupName}"`
            : `Removed "${saved.name}" from its group`,
          'info',
        );
      } catch (e) {
        log(`Set group failed: ${(e as Error).message}`, 'err');
        notify('error', `Set group failed: ${(e as Error).message}`);
      }
    },
    [log, notify],
  );

  const renameProjectGroup = useCallback(
    async (fromName: string, toName: string) => {
      if (!session) return;
      try {
        await renameGroup(session.user.id, fromName, toName);
        setProjects((prev) =>
          prev.map((p) =>
            p.groupName === fromName
              ? { ...p, groupName: toName.trim() || null }
              : p,
          ),
        );
        log(
          toName.trim()
            ? `Renamed group "${fromName}" → "${toName}"`
            : `Ungrouped every project that was in "${fromName}"`,
          'info',
        );
      } catch (e) {
        log(`Rename group failed: ${(e as Error).message}`, 'err');
        notify('error', `Rename group failed: ${(e as Error).message}`);
      }
    },
    [log, notify, session],
  );

  const setProjectLocalPath = useCallback(
    async (path: string) => {
      if (!activeProject) return;
      const hostname = agentInfo?.host;
      try {
        const patch: Parameters<typeof updateProjectFields>[1] = {};
        if (hostname) {
          const nextMap = { ...activeProject.pathsByMachine };
          if (path) nextMap[hostname] = path;
          else delete nextMap[hostname];
          patch.pathsByMachine = nextMap;
        } else {
          patch.localPath = path;
        }
        const saved = await updateProjectFields(activeProject.id, patch);
        setProjects((prev) =>
          prev.map((p) => (p.id === saved.id ? saved : p)),
        );
        log(
          `Local path saved for "${activeProject.name}"${hostname ? ` on ${hostname}` : ''}: ${path}`,
          'info',
        );
      } catch (e) {
        log(`Save local path failed: ${(e as Error).message}`, 'err');
        throw e;
      }
    },
    [activeProject, agentInfo, log],
  );

  const [followEdits, setFollowEdits] = useState(true);
  const [editorFlashKey, setEditorFlashKey] = useState(0);
  // Refs so the watcher effect doesn't re-run (and re-do its initial full
  // sync) every time the user clicks a different file or toggles follow.
  const followEditsRef = useRef(followEdits);
  const activePathRef = useRef(activePath);
  useEffect(() => {
    followEditsRef.current = followEdits;
  }, [followEdits]);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  useEffect(() => {
    if (!agentMode || !currentLocalPath || !activeProject) return;
    const a = agentRef.current;
    const c = containerRef.current;
    if (!a || !c) return;
    const path = currentLocalPath;
    const watchId = `proj-${activeProject.id}`;
    let cancelled = false;
    let off: () => void = () => {};

    (async () => {
      // Initial full sync: disk -> WebContainer. This makes disk the source
      // of truth as soon as the agent + a path are wired up, even if the
      // project was originally opened from GitHub at open time.
      try {
        setStatus(`syncing ${path} from your laptop…`);
        // Kill the dev server FIRST. Mounting hundreds of files with a
        // running Metro/Vite process means it sees every write live and
        // bails into "Restart the server… --clear" mode that we then
        // can't recover from cleanly.
        stopDev();
        const fetched = await loadFromAgent(path);
        if (cancelled) return;
        if (fetched.length > 0) {
          await c.mount(filesToTree(fetched));
          setFiles(fetched);
          setDirtyPaths(new Set());
          // If the user hasn't picked a file yet (or the previously active
          // one disappeared), surface something sensible.
          const current = activePathRef.current;
          if (!current || !fetched.some((f) => f.path === current)) {
            const firstCode = fetched.find((f) =>
              /\.(tsx?|jsx?|html|css|md|json)$/i.test(f.path),
            );
            setActivePath(firstCode?.path ?? fetched[0]?.path ?? null);
          }
          setStatus('synced from disk');
          notify(
            'success',
            `Synced ${fetched.length} files from ${path}`,
          );
          log(`Synced ${fetched.length} files from ${path}`, 'info');
          if (!cancelled) scheduleRestart(fetched);
        } else {
          log(`No readable files at ${path}.`, 'info');
        }
      } catch (e) {
        log(`Disk sync failed: ${(e as Error).message}`, 'err');
      }

      if (cancelled) return;

      off = a.watchStart(watchId, path, async (changes) => {
        try {
          const normalized = changes.map((c) => c.replace(/\\/g, '/'));
          const root = path.replace(/\/$/, '');
          // Sync each changed file from disk -> WebContainer so HMR fires.
          const updated: { path: string; content: string | Uint8Array }[] = [];
          await Promise.all(
            normalized.map(async (rel) => {
              try {
                if (isBinaryPath(rel)) {
                  const { content } = await a.readFile(
                    `${root}/${rel}`,
                    'base64',
                  );
                  const bytes = base64ToBytes(content);
                  await c.fs.writeFile(`/${rel}`, bytes);
                  updated.push({ path: rel, content: bytes });
                } else {
                  const { content } = await a.readFile(`${root}/${rel}`);
                  await c.fs.writeFile(`/${rel}`, content);
                  updated.push({ path: rel, content });
                }
              } catch {
                // File may have been deleted; ignore so the watcher keeps going.
              }
            }),
          );
          setFiles((prev) => {
            const byPath = new Map(prev.map((f) => [f.path, f]));
            for (const u of updated) byPath.set(u.path, u);
            return Array.from(byPath.values());
          });
          setDirtyPaths((prev) => {
            const next = new Set(prev);
            for (const c of normalized) next.delete(c);
            return next;
          });
          const currentActive = activePathRef.current;
          if (followEditsRef.current) {
            const codeChange = normalized.find((c) =>
              /\.(tsx?|jsx?|html?|css|scss|md|json|ya?ml|toml|sql|py|rb|go|rs|java|kt|swift|c|cpp|hpp?|sh|env|php|lua)$/i.test(
                c,
              ),
            );
            if (codeChange) {
              setActivePath(codeChange);
              setEditorFlashKey((k) => k + 1);
            } else if (normalized.some((c) => c === currentActive)) {
              setEditorFlashKey((k) => k + 1);
            }
          } else if (normalized.some((c) => c === currentActive)) {
            setEditorFlashKey((k) => k + 1);
          }
          notify(
            'info',
            `${changes.length} file${changes.length === 1 ? '' : 's'} synced from disk`,
          );
          // Files that don't HMR — Vite/Metro/Next need a fresh process
          // to pick up edits to their config or package.json. Without
          // this, the dev server prints "Restart the server to see the
          // new results" and the preview goes stale.
          const NEEDS_RESTART = /(^|\/)(package\.json|babel\.config\.[cm]?[jt]s|metro\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|tsconfig\.json|app\.json|app\.config\.[cm]?[jt]s)$/;
          const cfgChange = normalized.find((p) => NEEDS_RESTART.test(p));
          if (cfgChange) {
            log(`${cfgChange} changed — restarting dev server.`, 'info');
            scheduleRestart();
          }
        } catch (e) {
          log(`Watcher sync failed: ${(e as Error).message}`, 'err');
        }
      });
      log(`Watching ${path} for changes (will sync to preview).`, 'info');
    })();

    return () => {
      cancelled = true;
      // Bump the generation so any in-flight runDev (npm install, dev
      // spawn) for this project bails before it can step on the new
      // project's setState calls.
      runGenRef.current++;
      // Cancel any restart that hadn't fired yet — otherwise it'd boot
      // the previous project's files into the new project's WebContainer.
      cancelScheduledRestart();
      stopDev();
      setDevError(null);
      off();
    };
  }, [
    agentMode,
    activeProject,
    currentLocalPath,
    cancelScheduledRestart,
    log,
    notify,
    loadFromAgent,
    scheduleRestart,
    stopDev,
  ]);

  const buildExpo = useCallback(
    (platform: 'ios' | 'android') => {
      const a = agentRef.current;
      if (!a || !currentLocalPath) {
        notify('error', 'Build needs the local agent + project local path set.');
        return;
      }
      const id = `eas_${Date.now().toString(36)}`;
      log(`$ eas build --platform ${platform} --non-interactive`, 'info');
      notify('info', `Building for ${platform === 'ios' ? 'iOS' : 'Android'} via EAS — this can take a while.`);
      const off = a.onEvent((evt) => {
        if (evt.type === 'output' && evt.id === id) {
          log(evt.data, evt.stream === 'stderr' ? 'err' : 'out');
        } else if (evt.type === 'exit' && evt.id === id) {
          off();
          if (evt.code === 0) {
            notify('success', `EAS ${platform} build submitted. Check the EAS dashboard for the artifact.`, {
              url: 'https://expo.dev/accounts',
              urlLabel: 'Open EAS dashboard',
            });
          } else {
            notify('error', `EAS build exited with code ${evt.code}`);
          }
        }
      });
      a.exec({
        id,
        command: 'eas',
        args: ['build', '--platform', platform, '--non-interactive'],
        cwd: currentLocalPath,
      });
    },
    [currentLocalPath, log, notify],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await deleteProjectRemote(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (activeProjectId === id) {
          setActiveProjectIdState(null);
          persistSecret({ lastActiveProjectId: null });
        }
      } catch (e) {
        log(`Delete failed: ${(e as Error).message}`, 'err');
      }
    },
    [activeProjectId, log, persistSecret],
  );

  const saveEnv = useCallback(
    async (content: string, restart: boolean) => {
      const c = containerRef.current;
      if (!c || !currentRepoKey) return;
      setStoredEnv(currentRepoKey, content);
      try {
        await c.fs.writeFile('/.env.local', content);
        log(`Saved .env.local for ${currentRepoKey}.`, 'info');
      } catch (e) {
        log(`Failed to write .env.local: ${(e as Error).message}`, 'err');
        return;
      }
      if (restart) {
        stopDev();
        setTimeout(() => runDev(), 200);
      }
    },
    [currentRepoKey, log, runDev, setStoredEnv, stopDev],
  );

  const activeFile = files.find((f) => f.path === activePath) ?? null;
  const activeFileIsBinary =
    !!activeFile && typeof activeFile.content !== 'string';

  useEffect(() => {
    if (!agentMode || !activeFile || !currentLocalPath) return;
    if (typeof activeFile.content === 'string' && activeFile.content.length > 0) return;
    if (dirtyPaths.has(activeFile.path)) return;
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|pdf|zip|mp[34])$/i.test(activeFile.path)) {
      return;
    }
    const a = agentRef.current;
    if (!a) return;
    const path = activeFile.path;
    a.readFile(`${currentLocalPath.replace(/\/$/, '')}/${path}`)
      .then(({ content }) => {
        setFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, content } : f)),
        );
      })
      .catch((e) => log(`Read failed: ${(e as Error).message}`, 'err'));
  }, [agentMode, activeFile, currentLocalPath, dirtyPaths, log]);

  const updateActiveFile = useCallback(
    (value: string) => {
      if (!activeFile || typeof activeFile.content !== 'string') return;
      setFiles((prev) =>
        prev.map((f) => (f.path === activeFile.path ? { ...f, content: value } : f)),
      );
      setDirtyPaths((prev) => {
        if (prev.has(activeFile.path)) return prev;
        const next = new Set(prev);
        next.add(activeFile.path);
        return next;
      });
      if (agentMode && currentLocalPath) {
        const a = agentRef.current;
        if (a) {
          a.writeFile(
            `${currentLocalPath.replace(/\/$/, '')}/${activeFile.path}`,
            value,
          ).catch((err) => {
            log(`Write failed: ${(err as Error).message}`, 'err');
          });
        }
        return;
      }
      const c = containerRef.current;
      if (c) {
        c.fs.writeFile(`/${activeFile.path}`, value).catch((err) => {
          log(`Write failed: ${(err as Error).message}`, 'err');
        });
      }
    },
    [activeFile, currentLocalPath, agentMode, log],
  );

  const downloadProject = useCallback(async () => {
    const c = containerRef.current;
    if (!c) return;
    try {
      setStatus('preparing download…');
      const collected = await readAllFiles(c);
      const zip = new JSZip();
      for (const f of collected) {
        zip.file(f.path.replace(/^\//, ''), f.content);
      }
      if (activeProject?.envContent) {
        zip.file('.env.local', activeProject.envContent);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const baseName = activeProject?.repo && activeProject.branch
        ? `${activeProject.repo}-${activeProject.branch.replace(/\//g, '_')}`
        : activeProject
        ? activeProject.name.replace(/[^a-z0-9._-]+/gi, '_')
        : currentRepoKey
        ? `${currentRepoKey.split('/')[1]}-${(currentBranch ?? 'main').replace(/\//g, '_')}`
        : 'project';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log(`Downloaded ${baseName}.zip (${collected.length} files${activeProject?.envContent ? ' + .env.local' : ''}).`, 'info');
      notify(
        'success',
        `Downloaded ${baseName}.zip${activeProject?.envContent ? ' (with .env.local)' : ''}`,
      );
      setStatus('downloaded');
    } catch (e) {
      const msg = (e as Error).message;
      log(`Download failed: ${msg}`, 'err');
      notify('error', `Download failed: ${msg}`);
      setStatus('download failed');
    }
  }, [activeProject, currentBranch, currentRepoKey, log, notify]);

  const [pushDialogOpen, setPushDialogOpen] = useState(false);

  const pushToGitHub = useCallback(() => {
    if (!ghToken) {
      log('Connect GitHub first to push.', 'err');
      notify('error', 'Connect GitHub first.');
      return;
    }
    if (files.length === 0) {
      log('Nothing to push — no files loaded.', 'info');
      return;
    }
    setPushDialogOpen(true);
  }, [ghToken, files.length, log, notify]);

  const onPushed = useCallback(
    (r: {
      owner: string;
      repo: string;
      branch: string;
      commitSha: string;
      fileCount: number;
    }) => {
      setPushDialogOpen(false);
      setDirtyPaths(new Set());
      log(
        `Pushed ${r.fileCount} file${r.fileCount === 1 ? '' : 's'} to ${r.owner}/${r.repo}@${r.branch} (${r.commitSha.slice(0, 7)}).`,
        'info',
      );
      notify(
        'success',
        `Pushed ${r.fileCount} file${r.fileCount === 1 ? '' : 's'} to ${r.owner}/${r.repo}@${r.branch}`,
        {
          url: `https://github.com/${r.owner}/${r.repo}/commit/${r.commitSha}`,
          urlLabel: `View commit ${r.commitSha.slice(0, 7)}`,
        },
      );
      setStatus(`pushed ${r.commitSha.slice(0, 7)}`);
      // If this push targeted the current project's repo and the project is
      // local-only (no GitHub fields yet), link them so future pushes default
      // here. Or if branch differs, sync the branch.
      if (activeProject) {
        const patch: Record<string, string | null> = {};
        if (!activeProject.owner) patch.owner = r.owner;
        if (!activeProject.repo) patch.repo = r.repo;
        if (!activeProject.branch) patch.branch = r.branch;
        if (Object.keys(patch).length > 0) {
          updateProjectFields(activeProject.id, patch as never)
            .then((saved) =>
              setProjects((prev) =>
                prev.map((x) => (x.id === saved.id ? saved : x)),
              ),
            )
            .catch((e) =>
              log(`Couldn't link project to repo: ${(e as Error).message}`, 'err'),
            );
        }
      }
    },
    [activeProject, log, notify],
  );

  const [pullDialogOpen, setPullDialogOpen] = useState(false);

  const pullFromGitHub = useCallback(async () => {
    if (!ghToken) {
      log('Connect GitHub first to pull.', 'err');
      notify('error', 'Connect GitHub first.');
      return;
    }
    // If the agent + a path are wired up, the user wants the GitHub pull
    // to land on their laptop (the watcher then mirrors to the preview).
    // That's the bolt-with-a-real-disk flow. Open the dialog so they can
    // pick repo/branch/path explicitly.
    if (agentInfo) {
      setPullDialogOpen(true);
      return;
    }
    // Otherwise (no agent), keep the legacy in-WebContainer reload.
    if (!currentRepoKey || !currentBranch) {
      log('No repo loaded.', 'err');
      return;
    }
    if (dirtyPaths.size > 0) {
      const ok = window.confirm(
        `You have ${dirtyPaths.size} unpushed change${dirtyPaths.size === 1 ? '' : 's'}. Pulling will overwrite ${dirtyPaths.size === 1 ? 'it' : 'them'}. Continue?`,
      );
      if (!ok) return;
    }
    const [owner, repo] = currentRepoKey.split('/');
    await pullRef({ owner, repo, ref: currentBranch });
    setDirtyPaths(new Set());
  }, [agentInfo, currentBranch, currentRepoKey, dirtyPaths, ghToken, log, notify, pullRef]);

  const onPulled = useCallback(
    async (r: {
      owner: string;
      repo: string;
      branch: string;
      path: string;
      fileCount: number;
    }) => {
      setPullDialogOpen(false);
      log(
        `Pulled ${r.fileCount} files from ${r.owner}/${r.repo}@${r.branch} into ${r.path}`,
        'info',
      );
      notify(
        'success',
        `Pulled ${r.fileCount} files into ${r.path}`,
      );
      // If we pulled to a path that isn't the active project's machine
      // path, link it now so future opens use it. Same for blank
      // owner/repo/branch on a local-only project that just got a remote.
      let pulledIntoActiveProject = false;
      if (activeProject && agentInfo) {
        const pbm = activeProject.pathsByMachine ?? {};
        pulledIntoActiveProject = pbm[agentInfo.host] === r.path;
        if (!pulledIntoActiveProject) {
          try {
            const saved = await updateProjectFields(activeProject.id, {
              pathsByMachine: { ...pbm, [agentInfo.host]: r.path },
              localPath: activeProject.localPath ?? r.path,
              owner: activeProject.owner ?? r.owner,
              repo: activeProject.repo ?? r.repo,
              branch: activeProject.branch ?? r.branch,
            });
            setProjects((prev) =>
              prev.map((x) => (x.id === saved.id ? saved : x)),
            );
            // Updating pathsByMachine causes currentLocalPath to change,
            // which triggers the auto-resync effect — that handles the
            // mount + dev-server restart for us.
            return;
          } catch (e) {
            log(`Couldn't link path to project: ${(e as Error).message}`, 'err');
          }
        }
      }

      // Pull landed on the path the watcher is already watching. The
      // watcher mirrored every disk write into WebContainer as it
      // happened; all that's left is to give the dev server a fresh
      // process. scheduleRestart coalesces with whatever the watcher's
      // config-file detector already triggered, so we get exactly one
      // restart no matter how many configs the pull touched.
      if (pulledIntoActiveProject) {
        scheduleRestart();
      }
    },
    [activeProject, agentInfo, log, notify, scheduleRestart],
  );

  const deploy = useCallback(
    async (token: string, siteId: string) => {
      const c = containerRef.current;
      if (!c) return;
      try {
        setStatus('preparing build for deploy…');
        const pkgFile = files.find((f) => f.path === 'package.json');
        let deployFiles: FileEntry[] = files;
        if (pkgFile) {
          let deps: Record<string, string> = {};
          let scripts: Record<string, string> = {};
          try {
            const pkg = JSON.parse(textOf(pkgFile.content));
            deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
            scripts = pkg.scripts ?? {};
          } catch (e) {
            throw new Error(`Could not parse package.json: ${(e as Error).message}`);
          }

          // Match runDev's framework detection. Expo Router web is built with
          // `expo export -p web` (output → dist/), NOT `npm run build`. Most
          // Expo templates have no build script, or a stray Vite build script
          // from the template — in either case the old generic path would skip
          // the build and upload raw source, or fall through to a stray
          // public/ folder, producing a "deployed but blank" site.
          const isExpo = !!deps.expo || !!deps['expo-router'];

          // Deploy must be self-sufficient: pull → deploy shouldn't require a
          // dev-server Run first just to get dependencies installed (that's
          // the heavy path we want mobile users to be able to skip). If
          // node_modules is missing — or belongs to a different project than
          // the one being deployed — install before building.
          const projectId = activeProjectIdRef.current;
          const staleTree =
            !!projectId && installedForProjectRef.current !== null &&
            installedForProjectRef.current !== projectId;
          let needInstall = installedForProjectRef.current !== projectId;
          if (!needInstall) {
            try {
              await c.fs.readdir('/node_modules');
            } catch {
              needInstall = true;
            }
          }
          if (needInstall) {
            if (staleTree) {
              // node_modules belongs to a different project — wipe it like
              // runDev does, or npm reconciles against the wrong lockfile.
              log('$ rm -rf /node_modules /package-lock.json', 'info');
              for (const p of ['/node_modules', '/package-lock.json']) {
                try {
                  const rm = await c.spawn('rm', ['-rf', p]);
                  await rm.exit;
                } catch {
                  // already absent
                }
              }
            }
            setStatus('installing dependencies for deploy…');
            const installArgs = isExpo
              ? ['install', '--legacy-peer-deps']
              : ['install'];
            log(`$ npm ${installArgs.join(' ')}`, 'info');
            const install = await c.spawn('npm', installArgs);
            pipeProcess(install);
            const icode = await install.exit;
            if (icode !== 0) throw new Error(`npm install exited ${icode}`);
            installedForProjectRef.current = projectId ?? null;
          }

          setStatus('building for deploy…');
          let ranBuild = false;
          let outputDirs: string[];
          if (isExpo) {
            log('$ npx expo export -p web', 'info');
            const build = await c.spawn('npx', ['expo', 'export', '-p', 'web']);
            pipeProcess(build);
            const bcode = await build.exit;
            if (bcode !== 0) throw new Error(`expo export exited ${bcode}`);
            ranBuild = true;
            outputDirs = ['dist'];
          } else if (scripts.build) {
            log('$ npm run build', 'info');
            const build = await c.spawn('npm', ['run', 'build']);
            pipeProcess(build);
            const bcode = await build.exit;
            if (bcode !== 0) throw new Error(`build exited ${bcode}`);
            ranBuild = true;
            // Don't probe public/ here — for a project that builds, public/ is
            // a source asset dir, not the deployable output. Falling through to
            // it was a silent wrong-folder trap.
            outputDirs = ['dist', 'build', 'out'];
          } else {
            // No build step (plain static site): serve public/ if present,
            // otherwise the raw project files.
            outputDirs = ['public'];
          }

          let foundOutput = false;
          for (const dir of outputDirs) {
            try {
              await c.fs.readdir(`/${dir}`);
              const out = await readAllFiles(c, `/${dir}`);
              if (out.length === 0) continue;
              deployFiles = out.map((f) => ({
                ...f,
                path: f.path.replace(new RegExp(`^${dir}/`), ''),
              }));
              log(`Deploying ${deployFiles.length} files from /${dir}`, 'info');
              foundOutput = true;
              break;
            } catch {
              // directory not present, try next
            }
          }
          // If a build ran but produced no output dir, that's a real failure.
          // Do NOT silently upload raw source and report success — that's the
          // exact "deployed but broken" bug. Surface it so the deploy aborts.
          if (ranBuild && !foundOutput) {
            throw new Error(
              `Build finished but no output found in: ${outputDirs.join(', ')}/. ` +
                (isExpo
                  ? 'Expo web export should produce dist/ — check app.json has a web config (e.g. "web": { "bundler": "metro", "output": "single" }) and that expo-router web support is installed.'
                  : 'Check that your build script writes to dist/, build/, or out/.'),
            );
          }
        }
        setStatus('uploading to Netlify…');
        const result = await deployToNetlify(token, deployFiles, siteId || undefined);
        const liveUrl = result.ssl_url ?? result.url;
        log(`Deployed: ${liveUrl}`, 'info');
        notify('success', `Deployed to Netlify`, {
          url: liveUrl,
          urlLabel: 'Open live site',
        });
        setStatus(`deployed: ${liveUrl}`);
        if (activeProject && result.site_id) {
          try {
            const saved = await updateProjectFields(activeProject.id, {
              netlifySiteId: result.site_id,
            });
            setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
            log(`Saved site_id to project "${activeProject.name}".`, 'info');
          } catch (e) {
            log(`Could not persist site_id: ${(e as Error).message}`, 'err');
          }
        }
      } catch (e) {
        const msg = (e as Error).message;
        log(`Deploy failed: ${msg}`, 'err');
        notify('error', `Deploy failed: ${msg}`);
        setStatus('deploy failed');
      }
    },
    [activeProject, files, log, notify, pipeProcess],
  );

  const netlifySiteIdForToolbar = activeProject?.netlifySiteId ?? '';

  const saveNetlifySiteId = useCallback(
    (value: string) => {
      if (!activeProject) {
        log('Site id not saved: no active project yet. Open a repo first.', 'err');
        return;
      }
      updateProjectFields(activeProject.id, {
        netlifySiteId: value || undefined,
      })
        .then((saved) =>
          setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p))),
        )
        .catch((e) =>
          log(`Save site id failed: ${(e as Error).message}`, 'err'),
        );
    },
    [activeProject, log],
  );

  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '/';
  const isAppRoute =
    pathname === '/app' || pathname.startsWith('/app/');
  const isGetTradingRoute =
    pathname === '/gettrading' || pathname.startsWith('/gettrading/');

  if (isGetTradingRoute) {
    if (authChecking) {
      return <div className="login-shell"><div className="login-card">Loading…</div></div>;
    }
    if (!session) return <LoginGate />;
    return <GetTradingPage />;
  }

  if (!isAppRoute) {
    return <LandingPage />;
  }

  if (authChecking) {
    return <div className="login-shell"><div className="login-card">Loading…</div></div>;
  }
  if (!session) {
    return <LoginGate />;
  }

  const showOnboarding =
    !onboardingDismissed &&
    (!ghToken || projects.length === 0);
  const dismissOnboarding = () => {
    localStorage.setItem('onboardingDismissed', '1');
    setOnboardingDismissed(true);
  };

  return (
    <>
      <Toasts items={toasts} onDismiss={dismissToast} />
      {settingsOpen && (
        <SettingsModal
          email={session.user.email ?? ''}
          userId={session.user.id}
          ghToken={ghToken}
          netlifyToken={netlifyToken}
          projectCount={projects.length}
          models={models}
          onResetGhToken={disconnectGitHub}
          onResetNetlifyToken={() => setNetlifyToken('')}
          onEditModel={(preset) => setModelModal({ kind: 'edit', preset })}
          onDeleteModel={deleteModel}
          onAddModel={() => setModelModal({ kind: 'new' })}
          onSignOut={() => {
            supabase.auth.signOut();
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {modelModal && (
        <ModelFormModal
          initial={modelModal.kind === 'edit' ? modelModal.preset : undefined}
          onSave={(p) => {
            upsertModel(p);
            setModelModal(null);
          }}
          onClose={() => setModelModal(null)}
        />
      )}
      {tourOpen && (
        <Tour
          steps={getTourSteps({ setBottomTab })}
          onClose={() => setTourOpen(false)}
        />
      )}
      {pushDialogOpen && ghToken && (
        <PushDialog
          token={ghToken}
          files={files}
          dirtyPaths={dirtyPaths}
          initialOwner={activeProject?.owner ?? null}
          initialRepo={activeProject?.repo ?? null}
          initialBranch={activeProject?.branch ?? currentBranch}
          onClose={() => setPushDialogOpen(false)}
          onPushed={onPushed}
        />
      )}
      {pullDialogOpen && ghToken && agentInfo && agentRef.current && (
        <PullDialog
          token={ghToken}
          agent={agentRef.current}
          agentInfo={agentInfo}
          initialOwner={activeProject?.owner ?? null}
          initialRepo={activeProject?.repo ?? null}
          initialBranch={activeProject?.branch ?? currentBranch}
          initialPath={currentLocalPath}
          onClose={() => setPullDialogOpen(false)}
          onPulled={onPulled}
        />
      )}
    <div className="app">
      {showOnboarding && (
        <Onboarding
          hasGitHub={!!ghToken}
          hasAgent={!!agentInfo}
          hasNetlify={!!netlifyToken}
          onDismiss={dismissOnboarding}
        />
      )}
      <Toolbar
        booting={booting}
        running={running}
        token={ghToken}
        user={ghUser}
        onConnect={connectGitHub}
        onDisconnect={disconnectGitHub}
        onSelectBranch={selectBranch}
        onOpenUrl={openUrl}
        onRun={() => runDev()}
        onStop={stopDev}
        onDeploy={deploy}
        repoKey={currentRepoKey}
        envContent={getStoredEnv()}
        exampleEnv={exampleEnv}
        onSaveEnv={saveEnv}
        defaultNetlifySiteId={netlifySiteIdForToolbar}
        onSaveNetlifySiteId={saveNetlifySiteId}
        netlifyToken={netlifyToken}
        onSaveNetlifyToken={setNetlifyToken}
        dirtyCount={dirtyPaths.size}
        onPushToGitHub={pushToGitHub}
        onPullFromGitHub={pullFromGitHub}
        onDownload={downloadProject}
        canDownload={!!currentRepoKey}
        userEmail={session.user.email ?? ''}
        userId={session.user.id}
        onSignOut={() => supabase.auth.signOut()}
        agentInfo={agentInfo}
        agent={agentRef.current}
        activeProject={activeProject}
        onSetLocalPath={setProjectLocalPath}
        onBuildExpo={buildExpo}
        log={log}
        notify={notify}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTour={() => setTourOpen(true)}
        currentBranch={currentBranch}
      />
      {(() => {
        const filesNode = (
          <>
            <div data-tour="projects-section">
              <ProjectsSection
                projects={projects}
                activeId={activeProjectId}
                canSave={!!currentRepoKey && !!currentBranch}
                currentRepoKey={currentRepoKey}
                currentBranch={currentBranch}
                agent={agentRef.current}
                agentInfo={agentInfo}
                onOpen={openProject}
                onSaveCurrent={saveCurrentProject}
                onCreateLocal={createLocalProjectFromUI}
                onRename={renameProject}
                onDelete={deleteProject}
                onSetGroup={setProjectGroup}
                onRenameGroup={renameProjectGroup}
              />
            </div>
            <div className="sidebar-divider">Search</div>
            <div data-tour="search-panel">
              <SearchPanel
                files={files}
                resetKey={activeProjectId}
                onJumpTo={(hit) => {
                  setActivePath(hit.path);
                  setJumpTarget({
                    path: hit.path,
                    line: hit.line,
                    column: hit.column,
                    nonce: Date.now(),
                  });
                  if (isMobile) setMobilePane('editor');
                }}
              />
            </div>
            <div className="sidebar-divider">Files</div>
            <div data-tour="file-tree">
              <FileTree
                files={files}
                activePath={activePath}
                onSelect={(p) => {
                  setActivePath(p);
                  if (isMobile) setMobilePane('editor');
                }}
              />
            </div>
          </>
        );

        const editorNode = (
          <div className="editor-wrap">
            {agentMode && (
              <div className="editor-follow-bar">
                <label className="editor-follow-toggle">
                  <input
                    type="checkbox"
                    checked={followEdits}
                    onChange={(e) => setFollowEdits(e.target.checked)}
                  />
                  <span>Follow Claude's edits</span>
                </label>
                {activeFile && (
                  <span className="editor-follow-path">
                    {activeFile.path}
                  </span>
                )}
              </div>
            )}
            <div
              key={editorFlashKey}
              className={`editor-flash-host ${editorFlashKey ? 'flash' : ''}`}
            >
              <CodeEditor
                path={activeFile?.path ?? null}
                value={
                  activeFile && typeof activeFile.content === 'string'
                    ? activeFile.content
                    : ''
                }
                onChange={updateActiveFile}
                binary={activeFileIsBinary}
                jumpTo={jumpTarget}
              />
            </div>
          </div>
        );

        const consoleNode = (
          <div className="bottom-pane">
            <div className="bottom-tabs" data-tour="bottom-tabs">
              <button
                className={`bottom-tab ${bottomTab === 'terminal' ? 'active' : ''}`}
                onClick={() => setBottomTab('terminal')}
              >
                Terminal
              </button>
              <button
                className={`bottom-tab ${bottomTab === 'chat' ? 'active' : ''}`}
                onClick={() => setBottomTab('chat')}
              >
                Chat
                {agentInfo && <span className="bottom-tab-dot" />}
              </button>
              {chatStatus && (
                <div className="bottom-tabs-status">
                  <span className="bottom-tabs-status-spin" />
                  <span className="bottom-tabs-status-text">
                    {chatStatus}
                  </span>
                </div>
              )}
            </div>
            <div className="bottom-tab-body">
              <div
                className="bottom-tab-pane"
                style={{ display: bottomTab === 'terminal' ? 'block' : 'none' }}
              >
                <Terminal logs={logs} />
              </div>
              <div
                className="bottom-tab-pane"
                data-tour={bottomTab === 'chat' ? 'chat-panel' : undefined}
                style={{ display: bottomTab === 'chat' ? 'block' : 'none' }}
              >
                <ChatPanel
                  agent={agentRef.current}
                  agentInfo={agentInfo}
                  userId={session.user.id}
                  cwd={currentLocalPath ?? undefined}
                  models={models}
                  selectedModelId={selectedModelId}
                  onSelectModel={selectModel}
                  onAddModel={() => setModelModal({ kind: 'new' })}
                  onManageModels={() => setSettingsOpen(true)}
                  onStatusChange={setChatStatus}
                />
              </div>
            </div>
          </div>
        );

        const previewNode = (
          <Preview
            url={previewUrl}
            status={status}
            devError={devError}
            onDismissError={() => setDevError(null)}
            onJumpToTerminal={() => {
              setBottomTab('terminal');
              if (isMobile) setMobilePane('console');
            }}
          />
        );

        if (isMobile) {
          return (
            <div className="mobile-shell">
              <div className="mobile-panes">
                <div
                  className="mobile-pane mobile-pane-sidebar"
                  data-active={mobilePane === 'files'}
                >
                  {filesNode}
                </div>
                <div
                  className="mobile-pane"
                  data-active={mobilePane === 'editor'}
                >
                  {editorNode}
                </div>
                <div
                  className="mobile-pane"
                  data-active={mobilePane === 'preview'}
                >
                  {previewNode}
                </div>
                <div
                  className="mobile-pane"
                  data-active={mobilePane === 'console'}
                >
                  {consoleNode}
                </div>
              </div>
              <nav className="mobile-nav">
                <button
                  className={`mobile-nav-tab ${mobilePane === 'files' ? 'active' : ''}`}
                  onClick={() => setMobilePane('files')}
                >
                  Files
                </button>
                <button
                  className={`mobile-nav-tab ${mobilePane === 'editor' ? 'active' : ''}`}
                  onClick={() => setMobilePane('editor')}
                >
                  Editor
                </button>
                <button
                  className={`mobile-nav-tab ${mobilePane === 'preview' ? 'active' : ''}`}
                  onClick={() => setMobilePane('preview')}
                >
                  Preview
                </button>
                <button
                  className={`mobile-nav-tab ${mobilePane === 'console' ? 'active' : ''}`}
                  onClick={() => setMobilePane('console')}
                >
                  Console
                  {agentInfo && <span className="bottom-tab-dot" />}
                </button>
              </nav>
            </div>
          );
        }

        return (
          <Group orientation="horizontal" className="main">
            <Panel defaultSize={18} minSize={10} className="sidebar">
              {filesNode}
            </Panel>
            <Separator className="resize-x" />
            <Panel defaultSize={42} minSize={20}>
              <Group orientation="vertical">
                <Panel
                  defaultSize={70}
                  minSize={20}
                  className="editor-pane"
                  data-tour="editor-pane"
                >
                  {editorNode}
                </Panel>
                <Separator className="resize-y" />
                <Panel defaultSize={32} minSize={12}>
                  {consoleNode}
                </Panel>
              </Group>
            </Panel>
            <Separator className="resize-x" />
            <Panel defaultSize={40} minSize={20} data-tour="preview-pane">
              {previewNode}
            </Panel>
          </Group>
        );
      })()}
    </div>
    </>
  );
}
