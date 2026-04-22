import { useRef, useState } from 'react';

export default function Preview({
  url,
  status,
}: {
  url: string | null;
  status: string;
}) {
  const [nonce, setNonce] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refresh = () => setNonce((n) => n + 1);
  const openExternal = () => {
    if (url) window.open(url, '_blank');
  };
  return (
    <div className="preview-pane">
      <div className="preview-bar">
        <button
          className="icon-button"
          title="Reload preview"
          onClick={refresh}
          disabled={!url}
        >
          ↻
        </button>
        <button
          className="icon-button"
          title="Open preview in new tab"
          onClick={openExternal}
          disabled={!url}
        >
          ↗
        </button>
        <span className="preview-status">{status}</span>
        <span className="preview-url">{url ?? ''}</span>
      </div>
      {url ? (
        <iframe
          key={nonce}
          ref={iframeRef}
          className="preview-frame"
          src={url}
          title="Preview"
          allow="cross-origin-isolated"
        />
      ) : (
        <div className="preview-empty">Preview will appear here once the dev server is running.</div>
      )}
    </div>
  );
}
