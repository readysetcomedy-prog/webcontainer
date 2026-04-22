import { useEffect, useRef, useState, type DragEvent } from 'react';

export interface EnvPanelProps {
  repoKey: string | null;
  initialContent: string;
  exampleContent: string | null;
  onSave: (content: string, restart: boolean) => void;
  onClose: () => void;
}

export default function EnvPanel({
  repoKey,
  initialContent,
  exampleContent,
  onSave,
  onClose,
}: EnvPanelProps) {
  const [value, setValue] = useState(initialContent);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialContent);
  }, [initialContent]);

  const loadExample = () => {
    if (exampleContent) setValue(exampleContent);
  };

  const readFile = async (file: File) => {
    const text = await file.text();
    setValue(text);
    setFileName(file.name);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  return (
    <div
      className={`popover env-panel ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="popover-title">Environment variables</div>
      <div className="popover-hint">
        Drop your local <code>.env</code> file below (or upload/paste).
        Contents are written to <code>.env.local</code> in the project root
        before the dev server starts, and saved in your browser for{' '}
        {repoKey ? <b>{repoKey}</b> : 'this repo'}. Never sent anywhere else.
      </div>
      <div className="env-actions">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={onFilePicked}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload .env file
        </button>
        {exampleContent && (
          <button className="link-button" type="button" onClick={loadExample}>
            Use .env.example as template
          </button>
        )}
        {fileName && <span className="env-filename">Loaded: {fileName}</span>}
      </div>
      <textarea
        className="env-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        placeholder={
          'Drop your .env file here, or paste:\nVITE_SUPABASE_URL=https://...\nVITE_SUPABASE_ANON_KEY=...'
        }
      />
      <div className="popover-actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => onSave(value, false)}>Save</button>
        <button className="primary" onClick={() => onSave(value, true)}>
          Save &amp; restart
        </button>
      </div>
    </div>
  );
}
