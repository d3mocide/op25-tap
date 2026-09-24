import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { Anomaly } from '../types';

interface AnomaliesPanelProps {
  anomalies: Anomaly[];
}

export const AnomaliesPanel: React.FC<AnomaliesPanelProps> = ({ anomalies }) => {
  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case 'new_rid':
        return <span className="badge badge-amber">NEW RID</span>;
      case 'new_tg':
        return <span className="badge badge-purple">NEW TG</span>;
      case 'spike':
        return <span className="badge badge-rose">SPIKE</span>;
      case 'new_site':
        return <span className="badge badge-cyan">NEW SITE</span>;
      default:
        return <span className="badge badge-muted">{kind.toUpperCase()}</span>;
    }
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert size={16} color="var(--accent-rose)" />
          <h2 style={{ fontSize: '0.86rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, color: 'var(--text-dim)' }}>
            System Alerts & Forensics
          </h2>
          <span className={`badge ${anomalies.length > 0 ? 'badge-rose' : 'badge-muted'} mono`} style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
            {anomalies.length}
          </span>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '550px', padding: '12px' }}>
        {anomalies.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
            No anomaly events detected. System operating normally.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {anomalies.map((anom) => (
              <div
                key={anom.id}
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    {getKindBadge(anom.kind)}
                    <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      {formatTime(anom.ts)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 500 }}>
                    {anom.details}
                  </div>
                  {(anom.radio_alias || anom.tg_alias) && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {anom.radio_alias && `Radio: ${anom.radio_alias}`}
                      {anom.radio_alias && anom.tg_alias && ' | '}
                      {anom.tg_alias && `Talkgroup: ${anom.tg_alias}`}
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
