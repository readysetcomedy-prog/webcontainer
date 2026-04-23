import { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  url?: string;
  urlLabel?: string;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const delay = toast.kind === 'error' ? 8000 : 4500;
    const t = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, delay);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div className={`toast toast-${toast.kind} ${leaving ? 'leaving' : ''}`}>
      <div className="toast-icon">
        {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '✕' : 'ℹ'}
      </div>
      <div className="toast-body">
        <div className="toast-message">{toast.message}</div>
        {toast.url && (
          <a
            className="toast-link"
            href={toast.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {toast.urlLabel ?? toast.url}
          </a>
        )}
      </div>
      <button
        className="toast-close"
        onClick={() => {
          setLeaving(true);
          setTimeout(() => onDismiss(toast.id), 200);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
