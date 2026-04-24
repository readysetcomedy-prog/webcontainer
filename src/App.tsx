import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Toolbar from './components/Toolbar';
import FileTree from './components/FileTree';
import CodeEditor from './components/CodeEditor';
import Preview from './components/Preview';
import Terminal from './components/Terminal';
import ProjectsSection from './components/ProjectsSection';
import type { FileEntry, LogLine } from './types';
import { filesToTree, getContainer, readAllFiles } from './lib/webcontainer';
import type { GhUser } from './lib/github';
import {
  fetchRepoFiles,
  getUser,
  parseRepoInput,
  pushCommit,
} from './lib/github';
import { deployToNetlify } from './lib/netlify';
import JSZip from 'jszip';
import { STARTER_FILES } from './lib/starter';
import type { Project } from './lib/projects';
import {
  deleteProjectRemote,
  fetchProjects,
  findOrCreateProject,
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

const textOf = (c: string | Uint8Array): string =>
  typeof c === 'string' ? c : new TextDecoder('utf-8').decode(c);

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>(STARTER_FILES);
  const [activePath, setActivePath] = useState<string | null>('src/App.jsx');
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
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    null,
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [agentInfo, setAgentInfoState] = useState<AgentInfo | null>(null);
  const agentRef = useRef<AgentClient | null>(null);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'chat'>('terminal');
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
        if (
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

  const pipeProcess = useCallback(
    (p: WebContainerProcess, kind: LogLine['kind'] = 'out') => {
      p.output.pipeTo(
        new WritableStream({
          write(chunk) {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            setLogs((prev) => [...prev, { id: ++logIdRef.current, text, kind }]);
          },
        }),
      );
    },
    [],
  );

  const runDev = useCallback(
    async (filesOverride?: FileEntry[]) => {
      const c = containerRef.current;
      if (!c) return;
      const projectFiles = filesOverride ?? files;
      const pkg = projectFiles.find((f) => f.path === 'package.json');
      if (!pkg) {
        log('No package.json found — skipping install/run.', 'info');
        setStatus('ready (no package.json)');
        return;
      }
      let scripts: Record<string, string> = {};
      try {
        scripts = JSON.parse(textOf(pkg.content)).scripts ?? {};
      } catch {
        log('Could not parse package.json.', 'err');
      }
      const startScript = scripts.dev
        ? 'dev'
        : scripts.start
        ? 'start'
        : scripts.serve
        ? 'serve'
        : null;
      setRunning(true);
      setStatus('installing dependencies…');
      log('$ npm install', 'info');
      const install = await c.spawn('npm', ['install']);
      pipeProcess(install);
      const code = await install.exit;
      if (code !== 0) {
        log(`npm install exited with code ${code}`, 'err');
        setStatus('install failed');
        setRunning(false);
        return;
      }
      if (!startScript) {
        log('No dev/start/serve script found in package.json.', 'info');
        setStatus('installed (no start script)');
        setRunning(false);
        return;
      }
      setStatus(`starting (npm run ${startScript})…`);
      log(`$ npm run ${startScript}`, 'info');
      const dev = await c.spawn('npm', ['run', startScript]);
      devProcRef.current = dev;
      pipeProcess(dev);
      dev.exit.then((exitCode) => {
        log(`dev server exited (${exitCode})`, 'info');
        devProcRef.current = null;
        setRunning(false);
        setPreviewUrl(null);
        setStatus('stopped');
      });
    },
    [files, log, pipeProcess],
  );

  const stopDev = useCallback(() => {
    devProcRef.current?.kill();
  }, []);

  const [localDevId, setLocalDevId] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const localDevIdRef = useRef<string | null>(null);

  const stopLocalDev = useCallback(() => {
    const a = agentRef.current;
    if (!a || !localDevIdRef.current) return;
    a.kill(localDevIdRef.current);
  }, []);

  const runLocalDev = useCallback(async () => {
    const a = agentRef.current;
    const project = activeProject;
    const root = currentLocalPath;
    if (!a || !project || !root) {
      log('Local Run needs the agent + a project local path.', 'err');
      return;
    }
    stopLocalDev();
    setLocalPreviewUrl(null);
    setRunning(true);

    let scripts: Record<string, string> = {};
    try {
      const { content } = await a.readFile(`${root}/package.json`);
      scripts = JSON.parse(content).scripts ?? {};
    } catch (e) {
      log(`Could not read package.json: ${(e as Error).message}`, 'err');
    }
    const startScript = scripts.dev
      ? 'dev'
      : scripts.start
      ? 'start'
      : scripts.serve
      ? 'serve'
      : null;

    const hasNodeModules = (await a.exists(`${root}/node_modules`)).exists;
    if (!hasNodeModules) {
      setStatus('installing dependencies on laptop…');
      log('$ npm install (on laptop)', 'info');
      const installId = `inst_${Date.now().toString(36)}`;
      await new Promise<void>((resolve) => {
        const off = a.onEvent((evt) => {
          if (evt.type === 'output' && evt.id === installId) {
            log(evt.data, evt.stream === 'stderr' ? 'err' : 'out');
          } else if (evt.type === 'exit' && evt.id === installId) {
            off();
            resolve();
          }
        });
        a.exec({ id: installId, command: 'npm', args: ['install'], cwd: root });
      });
    }

    if (!startScript) {
      log('No dev/start/serve script in package.json.', 'err');
      setRunning(false);
      setStatus('no start script');
      return;
    }

    const id = `dev_${Date.now().toString(36)}`;
    localDevIdRef.current = id;
    setLocalDevId(id);
    setStatus(`starting on laptop (npm run ${startScript})…`);
    log(`$ npm run ${startScript} (on laptop)`, 'info');
    const urlRe = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"]*)?/;
    const off = a.onEvent((evt) => {
      if (evt.type === 'output' && evt.id === id) {
        log(evt.data, evt.stream === 'stderr' ? 'err' : 'out');
        const m = evt.data.match(urlRe);
        if (m && !localPreviewUrl) {
          const url = m[0]
            .replace('0.0.0.0', 'localhost')
            .replace('127.0.0.1', 'localhost');
          setLocalPreviewUrl(url);
          setStatus(`local server ready: ${url}`);
          notify('success', `Dev server ready on your laptop`, {
            url,
            urlLabel: 'Open in new tab',
          });
        }
      } else if (evt.type === 'exit' && evt.id === id) {
        off();
        log(`local dev server exited (${evt.code})`, 'info');
        if (localDevIdRef.current === id) {
          localDevIdRef.current = null;
          setLocalDevId(null);
          setLocalPreviewUrl(null);
          setRunning(false);
          setStatus('stopped');
        }
      }
    });
    a.exec({ id, command: 'npm', args: ['run', startScript], cwd: root });
  }, [activeProject, currentLocalPath, localPreviewUrl, log, notify, stopLocalDev]);

  const loadFromAgent = useCallback(
    async (path: string) => {
      const a = agentRef.current;
      if (!a || !path) return;
      setStatus(`listing ${path}…`);
      const { entries } = await a.list(path, true);
      const fileEntries: FileEntry[] = entries
        .filter((e) => !e.isDir)
        .map((e) => ({ path: e.path, content: '' }));
      setFiles(fileEntries);
      setDirtyPaths(new Set());
      const firstCodeFile = fileEntries.find((f) =>
        /\.(tsx?|jsx?|html|css|md|json)$/i.test(f.path),
      );
      setActivePath(firstCodeFile?.path ?? fileEntries[0]?.path ?? null);
    },
    [],
  );

  const pullRef = useCallback(
    async (ref: { owner: string; repo: string; ref?: string }) => {
      const c = containerRef.current;
      if (!c || !session) return;
      try {
        stopDev();
        stopLocalDev();
        setLocalPreviewUrl(null);

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

        if (useAgent) {
          log(`Loading from local agent: ${pathForThisMachine}`, 'info');
          try {
            await loadFromAgent(pathForThisMachine!);
            setStatus('ready (local agent)');
            notify(
              'success',
              `Loaded ${project.owner}/${project.repo}@${branchUsed} from your local machine`,
            );
            log(
              `Local mode active. Files come from ${pathForThisMachine} on your machine. Use Chat to edit with Claude.`,
              'info',
            );
          } catch (e) {
            log(`Local listing failed: ${(e as Error).message}`, 'err');
            notify('error', `Local listing failed: ${(e as Error).message}`);
            setStatus('agent load failed');
          }
          return;
        }

        setStatus(`fetching ${ref.owner}/${ref.repo}…`);
        log(
          `Pulling ${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ''}`,
          'info',
        );
        const fetched = await fetchRepoFiles(ref, ghToken || undefined, (d, t) => {
          setStatus(`fetching ${d}/${t} files…`);
        });
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
          `Pulled ${ref.owner}/${ref.repo}@${branchUsed} (${fetched.length} files)`,
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
    [agentInfo, ghToken, loadFromAgent, log, notify, persistSecret, runDev, session, stopDev, stopLocalDev],
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
      pullRef({ owner: p.owner, repo: p.repo, ref: p.branch });
    },
    [pullRef],
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

  useEffect(() => {
    if (!agentMode || !currentLocalPath || !activeProject) return;
    const a = agentRef.current;
    if (!a) return;
    const path = currentLocalPath;
    const watchId = `proj-${activeProject.id}`;
    const off = a.watchStart(watchId, path, async (changes) => {
      try {
        const normalized = changes.map((c) => c.replace(/\\/g, '/'));
        const { entries } = await a.list(path, true);
        const fileSet = entries.filter((e) => !e.isDir).map((e) => e.path);
        setFiles((prev) => {
          const prevByPath = new Map(prev.map((f) => [f.path, f]));
          const changedSet = new Set(normalized);
          return fileSet.map((p) => {
            const existing = prevByPath.get(p);
            if (!existing) return { path: p, content: '' };
            if (changedSet.has(p)) return { path: p, content: '' };
            return existing;
          });
        });
        setDirtyPaths((prev) => {
          const next = new Set(prev);
          for (const c of normalized) next.delete(c);
          return next;
        });
        // Auto-follow Claude's latest edit so the user sees it live
        if (followEdits) {
          const codeChange = normalized.find((c) =>
            /\.(tsx?|jsx?|html?|css|scss|md|json|ya?ml|toml|sql|py|rb|go|rs|java|kt|swift|c|cpp|hpp?|sh|env|php|lua)$/i.test(
              c,
            ),
          );
          if (codeChange && fileSet.includes(codeChange)) {
            setActivePath(codeChange);
            setEditorFlashKey((k) => k + 1);
          } else if (normalized.some((c) => c === activePath)) {
            setEditorFlashKey((k) => k + 1);
          }
        } else if (normalized.some((c) => c === activePath)) {
          setEditorFlashKey((k) => k + 1);
        }
        notify(
          'info',
          `${changes.length} file${changes.length === 1 ? '' : 's'} changed on disk`,
        );
      } catch (e) {
        log(`Watcher refresh failed: ${(e as Error).message}`, 'err');
      }
    });
    log(`Watching ${path} for changes.`, 'info');
    return () => {
      off();
    };
  }, [agentMode, activeProject, currentLocalPath, log, notify, followEdits, activePath]);

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
      const baseName = activeProject
        ? `${activeProject.repo}-${activeProject.branch.replace(/\//g, '_')}`
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

  const pushToGitHub = useCallback(async () => {
    if (!ghToken) {
      log('Connect GitHub first to push.', 'err');
      return;
    }
    if (!currentRepoKey || !currentBranch) {
      log('No repo loaded.', 'err');
      return;
    }
    if (dirtyPaths.size === 0) {
      log('Nothing to push — no files edited since last sync.', 'info');
      return;
    }
    const [owner, repo] = currentRepoKey.split('/');
    const dirty = files.filter((f) => dirtyPaths.has(f.path));
    const message =
      dirty.length <= 3
        ? `studio: ${dirty.map((f) => f.path).join(', ')}`
        : `studio: update ${dirty.length} files`;
    setStatus(`pushing ${dirty.length} file${dirty.length === 1 ? '' : 's'}…`);
    try {
      const { commitSha } = await pushCommit(
        ghToken,
        owner,
        repo,
        currentBranch,
        dirty,
        message,
      );
      setDirtyPaths(new Set());
      log(
        `Pushed ${dirty.length} file${dirty.length === 1 ? '' : 's'} to ${owner}/${repo}@${currentBranch} (${commitSha.slice(0, 7)}).`,
        'info',
      );
      notify(
        'success',
        `Pushed ${dirty.length} file${dirty.length === 1 ? '' : 's'} to ${owner}/${repo}@${currentBranch}`,
        {
          url: `https://github.com/${owner}/${repo}/commit/${commitSha}`,
          urlLabel: `View commit ${commitSha.slice(0, 7)}`,
        },
      );
      setStatus(`pushed ${commitSha.slice(0, 7)}`);
    } catch (e) {
      const msg = (e as Error).message;
      log(`Push failed: ${msg}`, 'err');
      notify('error', `Push failed: ${msg}`);
      setStatus('push failed');
    }
  }, [currentBranch, currentRepoKey, dirtyPaths, files, ghToken, log, notify]);

  const pullFromGitHub = useCallback(async () => {
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
  }, [currentBranch, currentRepoKey, dirtyPaths, log, pullRef]);

  const deploy = useCallback(
    async (token: string, siteId: string) => {
      const c = containerRef.current;
      if (!c) return;
      try {
        setStatus('preparing build for deploy…');
        const pkgFile = files.find((f) => f.path === 'package.json');
        let deployFiles: FileEntry[] = files;
        if (pkgFile) {
          try {
            const pkg = JSON.parse(textOf(pkgFile.content));
            if (pkg.scripts?.build) {
              log('$ npm run build', 'info');
              const build = await c.spawn('npm', ['run', 'build']);
              pipeProcess(build);
              const bcode = await build.exit;
              if (bcode !== 0) throw new Error(`build exited ${bcode}`);
              for (const dir of ['dist', 'build', 'out', 'public']) {
                try {
                  await c.fs.readdir(`/${dir}`);
                  const out = await readAllFiles(c, `/${dir}`);
                  deployFiles = out.map((f) => ({
                    ...f,
                    path: f.path.replace(new RegExp(`^${dir}/`), ''),
                  }));
                  log(`Deploying ${deployFiles.length} files from /${dir}`, 'info');
                  break;
                } catch {
                  // directory not present, try next
                }
              }
            }
          } catch (e) {
            log(`Build skipped: ${(e as Error).message}`, 'err');
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

  const isAppRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname === '/app' ||
      window.location.pathname.startsWith('/app/'));

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
        onRun={() => (agentMode ? runLocalDev() : runDev())}
        onStop={() => (agentMode ? stopLocalDev() : stopDev())}
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
      <Group orientation="horizontal" className="main">
        <Panel defaultSize={18} minSize={10} className="sidebar">
          <div data-tour="projects-section">
            <ProjectsSection
              projects={projects}
              activeId={activeProjectId}
              canSave={!!currentRepoKey && !!currentBranch}
              currentRepoKey={currentRepoKey}
              currentBranch={currentBranch}
              onOpen={openProject}
              onSaveCurrent={saveCurrentProject}
              onRename={renameProject}
              onDelete={deleteProject}
            />
          </div>
          <div className="sidebar-divider">Files</div>
          <div data-tour="file-tree">
            <FileTree files={files} activePath={activePath} onSelect={setActivePath} />
          </div>
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
                  />
                </div>
              </div>
            </Panel>
            <Separator className="resize-y" />
            <Panel defaultSize={32} minSize={12}>
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
                </div>
                <div className="bottom-tab-body">
                  <div
                    className="bottom-tab-pane"
                    data-tour={bottomTab === 'chat' ? undefined : undefined}
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
                    />
                  </div>
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
        <Separator className="resize-x" />
        <Panel defaultSize={40} minSize={20} data-tour="preview-pane">
          <Preview
            url={agentMode ? localPreviewUrl : previewUrl}
            status={
              agentMode
                ? localPreviewUrl
                  ? `local server: ${localPreviewUrl}`
                  : localDevId
                  ? 'starting local dev server…'
                  : 'local mode — press Run to start dev server'
                : status
            }
          />
        </Panel>
      </Group>
    </div>
    </>
  );
}
