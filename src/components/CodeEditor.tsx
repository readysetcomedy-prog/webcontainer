import Editor from '@monaco-editor/react';

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

export default function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  if (!path) {
    return (
      <div className="editor-empty">
        Select a file from the tree to start editing.
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
