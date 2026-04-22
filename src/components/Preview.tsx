export default function Preview({
  url,
  status,
}: {
  url: string | null;
  status: string;
}) {
  return (
    <div className="preview-pane">
      <div className="preview-bar">
        <span className="preview-status">{status}</span>
        <span className="preview-url">{url ?? ''}</span>
      </div>
      {url ? (
        <iframe
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
