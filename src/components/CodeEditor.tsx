import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
};

function langFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANG_BY_EXT[ext] ?? 'plaintext';
}

export interface JumpTarget {
  // path is informational; CodeEditor only honours this when path matches
  // the currently open file (the parent is responsible for switching paths
  // first). nonce changes when the same line should be jumped to again.
  path: string;
  line: number;
  column: number;
  nonce: number;
}

export default function CodeEditor({
  path,
  value,
  onChange,
  binary,
  jumpTo,
}: {
  path: string | null;
  value: string;
  onChange: (value: string) => void;
  binary?: boolean;
  jumpTo?: JumpTarget | null;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // Apply jump targets after mount, and re-apply when nonce/path/line changes.
  useEffect(() => {
    if (!jumpTo || !path) return;
    if (jumpTo.path !== path) return;
    const ed = editorRef.current;
    if (!ed) return;
    // Defer slightly so Monaco has the model populated when we switched
    // files in the same render.
    const t = setTimeout(() => {
      try {
        ed.revealLineInCenter(jumpTo.line);
        ed.setPosition({ lineNumber: jumpTo.line, column: jumpTo.column });
        ed.focus();
      } catch {
        // model not ready yet; ignore
      }
    }, 30);
    return () => clearTimeout(t);
  }, [jumpTo, path]);

  if (!path) {
    return (
      <div className="editor-empty">
        Select a file from the tree to start editing.
      </div>
    );
  }
  if (binary) {
    return (
      <div className="editor-empty">
        <div><b>{path}</b></div>
        <div>Binary file — preview/edit not supported in the editor.</div>
      </div>
    );
  }
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={path}
      language={langFor(path)}
      value={value}
      onMount={onMount}
      onChange={(v) => onChange(v ?? '')}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
      }}
    />
  );
}
