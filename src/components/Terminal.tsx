import { useEffect, useRef } from 'react';
import type { LogLine } from '../types';

export default function Terminal({ logs }: { logs: LogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs]);
  return (
    <div className="terminal">
      {logs.map((l) => (
        <div key={l.id} className={`log log-${l.kind}`}>
          {l.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
