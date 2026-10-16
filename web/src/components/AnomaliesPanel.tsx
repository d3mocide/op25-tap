import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { Anomaly } from '../types';
import { formatTs } from '../utils/time';
import { EntityLink } from './EntityLink';

/** Turns "RID 123" / "TG 456" in an alert's text into drawer links. */
function linkify(text: string): React.ReactNode[] {
  return text.split(/((?:RID|TG) \d+)/g).map((part, i) => {
    const m = /^(RID|TG) (\d+)$/.exec(part);
    return m ? (
      <EntityLink key={i} kind={m[1] === 'RID' ? 'rid' : 'tg'} id={Number(m[2])}>{part}</EntityLink>
    ) : (
      part
    );
  });
}

interface KindMeta {
  label: string;
  color: string;
}

/** Severity by colour: spikes are the loud ones, new radios on known talkgroups are routine. */
const KIND_META: Record<string, KindMeta> = {
  spike: { label: 'SPIKE', color: 'var(--accent-fire)' },
  new_rid: { label: 'NEW RID', color: 'var(--accent-amber)' },
  new_tg: { label: 'NEW TG', color: 'var(--accent-purple)' },
  new_site: { label: 'NEW SITE', color: 'var(--accent-cyan)' },
  new_rid_at_site: { label: 'RID AT SITE', color: 'var(--accent-blue)' },
  new_rid_on_tg: { label: 'RID ON TG', color: 'var(--text-muted)' },
};

interface AnomaliesPanelProps {
  anomalies: Anomaly[];
}

export const AnomaliesPanel: React.FC<AnomaliesPanelProps> = ({ anomalies }) => {
  const formatTime = (ts: number) => formatTs(ts);

  const kinds = KIND_META;
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const counts = anomalies.reduce<Record<string, number>>((m, a) => {
    m[a.kind] = (m[a.kind] ?? 0) + 1;
    return m;
  }, {});
  const shown = kindFilter ? anomalies.filter((a) => a.kind === kindFilter) : anomalies;
  const meta = (kind: string): KindMeta => kinds[kind] ?? { label: kind.replace(/_/g, ' ').toUpperCase(), color: 'var(--text-dim)' };

  return (
    <div className="glass-panel panel-col">
      <div className="panel-header">
        <div className="panel-title">
          <ShieldAlert size={16} color="var(--accent-fire)" />
          <h2>System Alerts & Forensics</h2>
          <span className={`badge ${anomalies.length > 0 ? 'badge-rose' : 'badge-muted'} mono badge-sm`}>
            {anomalies.length}
          </span>
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="alert-filters">
          <button type="button" className={`chip ${kindFilter === null ? 'on' : ''}`} onClick={() => setKindFilter(null)}>
            All <span className="mono">{anomalies.length}</span>
          </button>
          {Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip ${kindFilter === k ? 'on' : ''}`}
              style={{ '--chip': meta(k).color } as React.CSSProperties}
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
            >
              <span className="chip-dot" />{meta(k).label} <span className="mono">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="panel-scroll tall pad">
        {anomalies.length === 0 ? (
          <div className="empty-note">No anomaly events detected. System operating normally.</div>
        ) : (
          <div className="stack-tight">
            {shown.map((anom) => (
              <div
                key={anom.id}
                className="alert-row"
                style={{ '--accent': meta(anom.kind).color } as React.CSSProperties}
              >
                <div>
                  <div className="row alert-head">
                    <span className="alert-kind">{meta(anom.kind).label}</span>
                    <span className="mono-dim alert-time">{formatTime(anom.ts)}</span>
                  </div>
                  <div className="alert-details">{linkify(anom.details)}</div>
                  {(anom.radio_alias || anom.tg_alias) && (
                    <div className="alert-who">
                      {anom.radio_alias && <>Radio: <EntityLink kind="rid" id={anom.rid}>{anom.radio_alias}</EntityLink></>}
                      {anom.radio_alias && anom.tg_alias && ' | '}
                      {anom.tg_alias && <>Talkgroup: <EntityLink kind="tg" id={anom.tgid}>{anom.tg_alias}</EntityLink></>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
