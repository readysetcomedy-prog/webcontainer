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
import { newProjectId } from './lib/projects';
import {
  deleteProjectRemote,
  fetchProjects,
  upsertProjectRemote,
} from './lib/projectsRemote';
import { supabase } from './lib/supabase';
import { fetchUserSecrets, saveUserSecrets } from './lib/userSecrets';
import type { Session } from '@supabase/supabase-js';
import LoginGate from './components/LoginGate';

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
        if (
          secrets.lastActiveProjectId &&
          projs.some((p) => p.id === secrets.lastActiveProjectId)
        ) {
          setActiveProjectIdState(secrets.lastActiveProjectId);
        }
      } catch (e) {
        console.error('Failed to load session data', e);
      }
    })();
  }, [session]);

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

  const getStoredEnv = useCallback(
    (): string => activeProject?.envContent ?? '',
    [activeProject],
  );
  const setStoredEnv = useCallback(
    (_repoKey: string, content: string) => {
      if (!activeProject || !session) return;
      const updated: Project = {
        ...activeProject,
        envContent: content,
        updatedAt: Date.now(),
      };
      upsertProjectRemote(updated, session.user.id)
        .then((saved) =>
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx < 0) return [saved, ...prev];
            const next = [...prev];
            next[idx] = saved;
            return next;
          }),
        )
        .catch((e) => console.error('save env failed', e));
    },
    [activeProject, session],
  );

  const log = useCallback((text: string, kind: LogLine['kind'] = 'out') => {
    setLogs((prev) => [...prev, { id: ++logIdRef.current, text, kind }]);
  }, []);

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

  const pullRef = useCallback(
    async (ref: { owner: string; repo: string; ref?: string }, envOverride?: string) => {
      const c = containerRef.current;
      if (!c) return;
      try {
        stopDev();
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

        const repoKey = `${ref.owner}/${ref.repo}`;
        setCurrentRepoKey(repoKey);
        setCurrentBranch(ref.ref ?? null);
        const example = fetched.find((f) =>
          /^\.env\.(example|template|sample)$/i.test(f.path),
        );
        setExampleEnv(example ? textOf(example.content) : null);

        const envToUse = envOverride ?? activeProject?.envContent ?? '';
        if (envToUse) {
          await c.fs.writeFile('/.env.local', envToUse);
          log(
            `Wrote .env.local (${envToUse.split('\n').filter(Boolean).length} values).`,
            'info',
          );
        } else if (example) {
          log(
            `This repo has ${example.path}. Click "Env vars" to set values before running.`,
            'info',
          );
        }

        log(`Loaded ${fetched.length} files.`, 'info');
        setStatus('ready');
        await runDev(fetched);
      } catch (e) {
        log(`Pull failed: ${(e as Error).message}`, 'err');
        setStatus('pull failed');
      }
    },
    [activeProject, ghToken, log, runDev, stopDev],
  );

  const openUrl = useCallback(
    async (repoInput: string) => {
      try {
        const ref = parseRepoInput(repoInput);
        setActiveProjectIdState(null);
        persistSecret({ lastActiveProjectId: null });
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
      setActiveProjectIdState(null);
      persistSecret({ lastActiveProjectId: null });
      pullRef({ owner, repo, ref: branch });
    },
    [persistSecret, pullRef],
  );

  const openProject = useCallback(
    (p: Project) => {
      setActiveProjectIdState(p.id);
      persistSecret({ lastActiveProjectId: p.id });
      pullRef({ owner: p.owner, repo: p.repo, ref: p.branch }, p.envContent);
    },
    [persistSecret, pullRef],
  );

  const saveCurrentProject = useCallback(
    async (name: string) => {
      if (!currentRepoKey || !currentBranch || !session) return;
      const [owner, repo] = currentRepoKey.split('/');
      const envContent = activeProject?.envContent ?? '';
      const project: Project = {
        id: activeProject?.id ?? newProjectId(),
        name,
        owner,
        repo,
        branch: currentBranch,
        envContent,
        netlifySiteId: activeProject?.netlifySiteId,
        updatedAt: Date.now(),
      };
      try {
        const saved = await upsertProjectRemote(project, session.user.id);
        setProjects((prev) => {
          const idx = prev.findIndex((p) => p.id === saved.id);
          if (idx < 0) return [saved, ...prev];
          const next = [...prev];
          next[idx] = saved;
          return next;
        });
        setActiveProjectIdState(saved.id);
        persistSecret({ lastActiveProjectId: saved.id });
        log(`Saved project "${name}".`, 'info');
      } catch (e) {
        log(`Save project failed: ${(e as Error).message}`, 'err');
      }
    },
    [activeProject, currentBranch, currentRepoKey, log, session],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      if (!session) return;
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      try {
        const saved = await upsertProjectRemote(
          { ...p, name, updatedAt: Date.now() },
          session.user.id,
        );
        setProjects((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      } catch (e) {
        log(`Rename failed: ${(e as Error).message}`, 'err');
      }
    },
    [log, projects, session],
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
      const c = containerRef.current;
      if (c) {
        c.fs.writeFile(`/${activeFile.path}`, value).catch((err) => {
          log(`Write failed: ${(err as Error).message}`, 'err');
        });
      }
    },
    [activeFile, log],
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
      setStatus('downloaded');
    } catch (e) {
      log(`Download failed: ${(e as Error).message}`, 'err');
      setStatus('download failed');
    }
  }, [activeProject, currentBranch, currentRepoKey, log]);

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
      setStatus(`pushed ${commitSha.slice(0, 7)}`);
    } catch (e) {
      log(`Push failed: ${(e as Error).message}`, 'err');
      setStatus('push failed');
    }
  }, [currentBranch, currentRepoKey, dirtyPaths, files, ghToken, log]);

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
        log(`Deployed: ${result.ssl_url ?? result.url}`, 'info');
        setStatus(`deployed: ${result.ssl_url ?? result.url}`);
        if (activeProject && result.site_id && session) {
          try {
            const saved = await upsertProjectRemote(
              {
                ...activeProject,
                netlifySiteId: result.site_id,
                updatedAt: Date.now(),
              },
              session.user.id,
            );
            setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
            log(`Saved site_id to project "${activeProject.name}".`, 'info');
          } catch (e) {
            log(`Could not persist site_id: ${(e as Error).message}`, 'err');
          }
        }
        window.open(result.ssl_url ?? result.url, '_blank');
      } catch (e) {
        log(`Deploy failed: ${(e as Error).message}`, 'err');
        setStatus('deploy failed');
      }
    },
    [activeProject, files, log, pipeProcess],
  );

  const netlifySiteIdForToolbar = activeProject?.netlifySiteId ?? '';

  const saveNetlifySiteId = useCallback(
    (value: string) => {
      if (!activeProject || !session) return;
      upsertProjectRemote(
        {
          ...activeProject,
          netlifySiteId: value || undefined,
          updatedAt: Date.now(),
        },
        session.user.id,
      )
        .then((saved) =>
          setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p))),
        )
        .catch((e) => console.error('save site id failed', e));
    },
    [activeProject, session],
  );

  if (authChecking) {
    return <div className="login-shell"><div className="login-card">Loading…</div></div>;
  }
  if (!session) {
    return <LoginGate />;
  }

  return (
    <div className="app">
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
        onSignOut={() => supabase.auth.signOut()}
      />
      <Group orientation="horizontal" className="main">
        <Panel defaultSize={18} minSize={10} className="sidebar">
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
          <div className="sidebar-divider">Files</div>
          <FileTree files={files} activePath={activePath} onSelect={setActivePath} />
        </Panel>
        <Separator className="resize-x" />
        <Panel defaultSize={42} minSize={20}>
          <Group orientation="vertical">
            <Panel defaultSize={70} minSize={20} className="editor-pane">
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
            </Panel>
            <Separator className="resize-y" />
            <Panel defaultSize={30} minSize={10}>
              <Terminal logs={logs} />
            </Panel>
          </Group>
        </Panel>
        <Separator className="resize-x" />
        <Panel defaultSize={40} minSize={20}>
          <Preview url={previewUrl} status={status} />
        </Panel>
      </Group>
    </div>
  );
}
