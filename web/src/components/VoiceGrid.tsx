import React from 'react';
import { Signal } from 'lucide-react';
import type { FrequencyInfo } from '../types';
import { getTalkgroupColor } from '../utils/colors';

interface VoiceGridProps {
  frequencies: Record<string, FrequencyInfo>;
}

export const VoiceGrid: React.FC<VoiceGridProps> = ({ frequencies }) => {
  const freqList = Object.values(frequencies);

  if (freqList.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Waiting for frequency channel updates from OP25...
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Signal size={15} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '0.80rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, color: 'var(--text-muted)' }}>
            Channels — Monitored Frequencies
          </h2>
          <span className="badge badge-muted mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>{freqList.length}</span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '12px'
      }}>
        {freqList.map((f) => {
          const mhz = (f.freq / 1_000_000).toFixed(6);
          const isControl = f.type.toLowerCase().includes('control') || f.type.toLowerCase().includes('cc');
          const isAlternate = f.type.toLowerCase().includes('alt');
          const isActiveCall = Boolean(f.active_tgid);
          const activeColor = getTalkgroupColor(f.active_tag);

          return (
            <div
              key={f.freq}
              className="glass-panel"
              style={{
                padding: '12px 14px',
                minHeight: '144px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: isActiveCall
                  ? '1px solid rgba(245, 158, 11, 0.7)'
                  : isControl
                  ? '1px solid rgba(0, 229, 255, 0.4)'
                  : '1px solid var(--border-subtle)',
                background: isActiveCall
                  ? 'linear-gradient(180deg, #1f1b13 0%, #151412 100%)'
                  : isControl
                  ? 'linear-gradient(180deg, #121c22 0%, #101418 100%)'
                  : 'linear-gradient(180deg, #18191f 0%, #121317 100%)',
                boxShadow: isActiveCall
                  ? '0 0 14px rgba(245, 158, 11, 0.18)'
                  : isControl
                  ? '0 0 12px rgba(0, 229, 255, 0.1)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                position: 'relative',
                overflow: 'hidden',
                transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              {/* Top Row: Freq & Type */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className="mono" style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {mhz}
                </span>

                <span className={`badge ${
                  isActiveCall
                    ? 'badge-amber'
                    : isControl
                    ? 'badge-cyan'
                    : isAlternate
                    ? 'badge-muted'
                    : 'badge-muted'
                }`}>
                  {isActiveCall && <span className="pulse-dot transmitting" />}
                  {isActiveCall ? 'TRANSMITTING' : isControl ? 'CONTROL' : isAlternate ? 'ALT CC' : 'VOICE'}
                </span>
              </div>

              {/* Middle Section: Fixed height container */}
              {isActiveCall ? (
                <div style={{
                  height: '62px',
                  background: 'rgba(0, 0, 0, 0.45)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  marginBottom: '8px',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}>
                  <div style={{ fontSize: '0.66rem', color: 'var(--accent-amber)', fontWeight: 700, letterSpacing: '0.04em' }}>
                    ACTIVE TALKGROUP:
                  </div>
                  <div style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: activeColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {f.active_tag || `TG ${f.active_tgid}`}
                  </div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {f.active_src ? (
                      <>ID: <span style={{ color: 'var(--accent-cyan)' }}>{f.active_src}</span></>
                    ) : (
                      <span>TGID: {f.active_tgid}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  height: '62px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  marginBottom: '8px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {isControl ? 'PRIMARY CC' : isAlternate ? 'ALTERNATE CC' : 'VOICE STANDBY'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: isControl ? 'var(--accent-cyan)' : 'var(--text-dim)' }}>
                    {isControl ? 'Listening for control signaling' : 'Channel standby / idle'}
                  </div>
                </div>
              )}

              {/* Bottom Row: Stats */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                <span>Hits: <strong className="mono" style={{ color: 'var(--text-muted)' }}>{f.counter.toLocaleString()}</strong></span>
                <span>Last: <strong style={{ color: isActiveCall ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{f.last_activity || '—'}</strong></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
