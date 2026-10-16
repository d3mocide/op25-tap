import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import type { Anomaly } from '../types';
import '../styles/toasts.css';

interface Toast {
  id: number;
  kind: string;
  details: string;
  tone: 'alert' | 'notice';
}

/** Kinds worth interrupting for. Routine "new radio on a known talkgroup" stays on the Alerts tab. */
const LOUD: Record<string, Toast['tone']> = {
  spike: 'alert',
  new_tg: 'notice',
  new_site: 'notice',
  new_rid: 'notice',
};
const LABEL: Record<string, string> = { spike: 'SPIKE', new_tg: 'NEW TALKGROUP', new_site: 'NEW SITE', new_rid: 'NEW RADIO' };
const LIFETIME_MS = 9000;
const MAX = 3;

interface Props {
  anomalies: Anomaly[];
  /** Only live data raises toasts; history never does. */
  enabled: boolean;
  onOpen: () => void;
}

/** Brief top-right notices for notable alerts that arrive while you're watching. */
export const Toasts: React.FC<Props> = ({ anomalies, enabled, onOpen }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Anything already present at mount, or arriving while disabled, is not "new".
  const seen = useRef<Set<number> | null>(null);
  // The alert list is empty until the first REST load lands, so "already seen" alone isn't enough:
  // only alerts raised after the page opened count as new.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    if (seen.current === null || !enabled) {
      seen.current = new Set(anomalies.map((a) => a.id));
      return;
    }
    const fresh = anomalies.filter((a) => !seen.current!.has(a.id) && a.ts * 1000 >= openedAt - 5000);
    for (const a of fresh) seen.current.add(a.id);
    const loud = fresh.filter((a) => LOUD[a.kind]);
    if (loud.length === 0) return;
    setToasts((prev) =>
      [...loud.map((a): Toast => ({ id: a.id, kind: a.kind, details: a.details, tone: LOUD[a.kind] })), ...prev].slice(0, MAX),
    );
    for (const a of loud) window.setTimeout(() => setToasts((p) => p.filter((t) => t.id !== a.id)), LIFETIME_MS);
  }, [anomalies, enabled, openedAt]);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <ShieldAlert size={15} />
          <button type="button" className="toast-main" onClick={() => { onOpen(); setToasts((p) => p.filter((x) => x.id !== t.id)); }}>
            <strong>{LABEL[t.kind] ?? t.kind.toUpperCase()}</strong>
            <span>{t.details}</span>
          </button>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};
