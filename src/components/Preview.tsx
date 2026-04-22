import { useEffect, useRef, useState } from 'react';

interface Tab {
  id: string;
  url: string;
  nonce: number;
}

const newId = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function resolveInput(input: string, base: string | null): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (!base) return null;
  try {
    return new URL(v.startsWith('/') ? v : `/${v}`, base).toString();
  } catch {
    return null;
  }
}

function shortLabel(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname === '/' ? '' : url.pathname;
    return path || url.host.split('.')[0];
  } catch {
    return u;
  }
}

export default function Preview({
  url,
  status,
}: {
  url: string | null;
  status: string;
}) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const lastSeededUrl = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!url) return;
    if (lastSeededUrl.current === url) return;
    lastSeededUrl.current = url;
    setTabs((prev) => {
      if (prev.length === 0) {
        const t: Tab = { id: newId(), url, nonce: 0 };
        setActiveId(t.id);
        return [t];
      }
      return prev.map((t, i) =>
        i === 0 ? { ...t, url, nonce: t.nonce + 1 } : t,
      );
    });
  }, [url]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'studio:open' || typeof data.url !== 'string') return;
      let target: URL;
      try {
        target = new URL(data.url);
      } catch {
        return;
      }
      if (target.origin === window.location.origin) return;
      const finalUrl = target.toString();
      setTabs((prev) => {
        if (prev.length === 0) {
          const t: Tab = { id: newId(), url: finalUrl, nonce: 0 };
          setActiveId(t.id);
          return [t];
        }
        const targetId = activeIdRef.current ?? prev[0].id;
        return prev.map((t) =>
          t.id === targetId ? { ...t, url: finalUrl, nonce: t.nonce + 1 } : t,
        );
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    setAddressInput(activeTab?.url ?? '');
  }, [activeTab?.id, activeTab?.url]);

  const switchTo = (id: string) => setActiveId(id);

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveId(fallback?.id ?? null);
      }
      return next;
    });
  };

  const addTab = (initialUrl?: string) => {
    const target = initialUrl ?? url ?? '';
    if (!target) return;
    const t: Tab = { id: newId(), url: target, nonce: 0 };
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  };

  const navigateActive = (input: string) => {
    if (!activeTab) {
      const resolved = resolveInput(input, url);
      if (resolved) addTab(resolved);
      return;
    }
    const resolved = resolveInput(input, activeTab.url);
    if (!resolved) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, url: resolved, nonce: t.nonce + 1 } : t,
      ),
    );
  };

  const reloadActive = () => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, nonce: t.nonce + 1 } : t,
      ),
    );
  };

  const goHome = () => {
    if (!activeTab || !url) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, url, nonce: t.nonce + 1 } : t,
      ),
    );
  };

  return (
    <div className="preview-pane">
      <div className="preview-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`preview-tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => switchTo(t.id)}
            title={t.url}
          >
            <span className="preview-tab-label">{shortLabel(t.url)}</span>
            <button
              className="preview-tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="preview-tab-add"
          title="New tab"
          onClick={() => addTab()}
          disabled={!url}
        >
          +
        </button>
      </div>
      <div className="preview-bar">
        <button
          className="icon-button"
          title="Reload"
          onClick={reloadActive}
          disabled={!activeTab}
        >
          ↻
        </button>
        <button
          className="icon-button"
          title="Go to dev server root"
          onClick={goHome}
          disabled={!url || !activeTab}
        >
          ⌂
        </button>
        <input
          className="preview-address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigateActive(addressInput);
          }}
          placeholder={url ?? 'Preview URL will appear here…'}
          spellCheck={false}
        />
        <span className="preview-status">{status}</span>
      </div>
      <div className="preview-frames">
        {tabs.length === 0 && (
          <div className="preview-empty">
            Preview will appear here once the dev server is running.
          </div>
        )}
        {tabs.map((t) => (
          <iframe
            key={`${t.id}-${t.nonce}`}
            className="preview-frame"
            src={t.url}
            title={`Preview ${t.id}`}
            allow="cross-origin-isolated"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-storage-access-by-user-activation allow-downloads"
            style={{ display: t.id === activeId ? 'block' : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}
