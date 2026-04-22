import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import Toolbar from './components/Toolbar';
import FileTree from './components/FileTree';
import CodeEditor from './components/CodeEditor';
import Preview from './components/Preview';
import Terminal from './components/Terminal';
import type { FileEntry, LogLine } from './types';
import { filesToTree, getContainer, readAllFiles } from './lib/webcontainer';
import { fetchRepoFiles, parseRepoInput } from './lib/github';
import { deployToNetlify } from './lib/netlify';
import { STARTER_FILES } from './lib/starter';

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>(STARTER_FILES);
  const [activePath, setActivePath] = useState<string | null>('src/App.jsx');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [booting, setBooting] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logIdRef = useRef(0);
  const containerRef = useRef<WebContainer | null>(null);
  const devProcRef = useRef<WebContainerProcess | null>(null);

  const log = useCallback((text: string, kind: LogLine['kind'] = 'out') => {
    setLogs((prev) => [...prev, { id: ++logIdRef.current, text, kind }]);
  }, []);

  useEffect(() => {
    if (!globalThis.crossOriginIsolated) {
      log(
        'Page is not cross-origin isolated — WebContainer cannot start. Ensure the dev server sends COOP/COEP headers.',
        'err',
      );
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
        scripts = JSON.parse(pkg.content).scripts ?? {};
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

  const loadRepo = useCallback(
    async (repoInput: string, token: string) => {
      const c = containerRef.current;
      if (!c) return;
      try {
        if (token) localStorage.setItem('github_token', token);
        stopDev();
        setStatus('parsing repo…');
        const ref = parseRepoInput(repoInput);
        setStatus(`fetching ${ref.owner}/${ref.repo}…`);
        log(`Pulling ${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ''}`, 'info');
        const fetched = await fetchRepoFiles(ref, token || undefined, (d, t) => {
          setStatus(`fetching ${d}/${t} files…`);
        });
        setStatus(`mounting ${fetched.length} files…`);
        await c.mount(filesToTree(fetched));
        setFiles(fetched);
        const firstCodeFile = fetched.find((f) =>
          /\.(tsx?|jsx?|html|css|md|json)$/i.test(f.path),
        );
        setActivePath(firstCodeFile?.path ?? fetched[0]?.path ?? null);
        log(`Loaded ${fetched.length} files.`, 'info');
        setStatus('ready');
        await runDev(fetched);
      } catch (e) {
        log(`Pull failed: ${(e as Error).message}`, 'err');
        setStatus('pull failed');
      }
    },
    [log, runDev, stopDev],
  );

  const activeFile = files.find((f) => f.path === activePath) ?? null;

  const updateActiveFile = useCallback(
    (value: string) => {
      if (!activeFile) return;
      setFiles((prev) =>
        prev.map((f) => (f.path === activeFile.path ? { ...f, content: value } : f)),
      );
      const c = containerRef.current;
      if (c) {
        c.fs.writeFile(`/${activeFile.path}`, value).catch((err) => {
          log(`Write failed: ${(err as Error).message}`, 'err');
        });
      }
    },
    [activeFile, log],
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
          try {
            const pkg = JSON.parse(pkgFile.content);
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
        window.open(result.ssl_url ?? result.url, '_blank');
      } catch (e) {
        log(`Deploy failed: ${(e as Error).message}`, 'err');
        setStatus('deploy failed');
      }
    },
    [files, log, pipeProcess],
  );

  return (
    <div className="app">
      <Toolbar
        booting={booting}
        running={running}
        onLoadRepo={loadRepo}
        onRun={() => runDev()}
        onStop={stopDev}
        onDeploy={deploy}
      />
      <div className="main">
        <aside className="sidebar">
          <FileTree files={files} activePath={activePath} onSelect={setActivePath} />
        </aside>
        <section className="editor-pane">
          <CodeEditor
            path={activeFile?.path ?? null}
            value={activeFile?.content ?? ''}
            onChange={updateActiveFile}
          />
        </section>
        <section className="right-pane">
          <Preview url={previewUrl} status={status} />
          <Terminal logs={logs} />
        </section>
      </div>
    </div>
  );
}
