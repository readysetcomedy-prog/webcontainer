import { useEffect, useState } from 'react';

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

  useEffect(() => {
    setValue(initialContent);
  }, [initialContent]);

  const loadExample = () => {
    if (exampleContent) setValue(exampleContent);
  };

  return (
    <div className="popover env-panel">
      <div className="popover-title">Environment variables</div>
      <div className="popover-hint">
        Written to <code>.env.local</code> in the project root before the dev
        server starts. Values are saved in your browser and reused every time
        you open{repoKey ? <> <b>{repoKey}</b></> : ' this repo'}. Never sent
        anywhere else.
      </div>
      {exampleContent && (
        <button className="link-button" type="button" onClick={loadExample}>
          Load template from .env.example
        </button>
      )}
      <textarea
        className="env-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        placeholder={'VITE_SUPABASE_URL=https://...\nVITE_SUPABASE_ANON_KEY=...'}
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
