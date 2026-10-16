import React, { useRef } from 'react';
import { Signal } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import type { FrequencyInfo } from '../types';
import { getTalkgroupColor } from '../utils/colors';
import '../styles/channels.css';
import { useFocus } from '../context/focus';
import { EntityLink } from './EntityLink';

interface VoiceGridProps {
  frequencies: Record<string, FrequencyInfo>;
}

interface LastCall {
  tag: string;
  src?: number;
}

type Kind = 'control' | 'alt' | 'voice';

const kindOf = (f: FrequencyInfo): Kind => {
  const type = f.type.toLowerCase();
  if (type.includes('alt')) return 'alt';
  if (type.includes('control') || type.includes('cc')) return 'control';
  return 'voice';
};

const KIND_LABEL: Record<Kind, string> = { control: 'CONTROL', alt: 'ALT CC', voice: 'VOICE' };
const label = (f: FrequencyInfo) => f.active_tag || `TG ${f.active_tgid}`;

/**
 * Every channel owns a fixed slot, in frequency order, for the life of the page.
 * A key-up changes a tile's colour and text, never its size or position, so the
 * layout below doesn't jump when calls start and stop. The last talkgroup heard
 * stays on an idle tile instead of vanishing.
 */
export const VoiceGrid: React.FC<VoiceGridProps> = ({ frequencies }) => {
  const freqList = Object.values(frequencies).sort((a, b) => a.freq - b.freq);
  const isMobile = useIsMobile();
  const lastCalls = useRef(new Map<number, LastCall>());
  const { matches, follow, pins } = useFocus();
  const dimmed = (f: FrequencyInfo) => follow && pins.size > 0 && Boolean(f.active_tgid) && !matches(f.active_tgid);

  if (freqList.length === 0) {
    return (
      <section className="chan-section" aria-busy="true" aria-label="Waiting for channel updates from OP25">
        <div className="panel-title dim chan-title">
          <Signal size={15} color="var(--accent-cyan)" />
          <h2>Channels — waiting for OP25</h2>
        </div>
        <div className="chan-grid">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="glass-panel chan-tile skeleton" />)}
        </div>
      </section>
    );
  }

  for (const f of freqList) {
    if (f.active_tgid) lastCalls.current.set(f.freq, { tag: label(f), src: f.active_src });
  }

  return (
    <section className="chan-section">
      <div className="panel-title dim chan-title">
        <Signal size={15} color="var(--accent-cyan)" />
        <h2>{isMobile ? 'Channels' : 'Channels — Monitored Frequencies'}</h2>
        <span className="badge badge-muted mono badge-sm">{freqList.length}</span>
      </div>

      {isMobile ? (
        <div className="glass-panel panel-clip">
          {freqList.map((f) => {
            const kind = kindOf(f);
            const live = Boolean(f.active_tgid);
            const last = lastCalls.current.get(f.freq);
            return (
              <div
                key={f.freq}
                className={`channel-row ${live ? 'live' : ''} ${kind === 'control' ? 'control' : ''} ${dimmed(f) ? 'dim' : ''}`}
                style={live ? ({ '--tg': getTalkgroupColor(f.active_tag) } as React.CSSProperties) : undefined}
              >
                <span className="channel-row-freq">{(f.freq / 1_000_000).toFixed(4)}</span>
                <div className="channel-row-main">
                  {live ? (
                    <>
                      <span className="pulse-dot transmitting" />
                      <EntityLink kind="tg" id={f.active_tgid} className="channel-row-tg">{label(f)}</EntityLink>
                      {f.active_src ? <span className="mono-cyan channel-row-src">{f.active_src}</span> : null}
                    </>
                  ) : (
                    <span className="channel-row-idle">
                      {kind === 'control' ? 'CONTROL' : kind === 'alt' ? 'ALT CC' : last ? `last: ${last.tag}` : 'IDLE'}
                    </span>
                  )}
                </div>
                <span className="channel-row-stats">
                  {f.counter.toLocaleString()} · <span className="channel-row-last">{f.last_activity || '—'}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="chan-grid">
          {freqList.map((f) => {
            const kind = kindOf(f);
            const live = Boolean(f.active_tgid);
            const last = lastCalls.current.get(f.freq);
            const color = getTalkgroupColor(f.active_tag);
            const state = live ? 'live' : kind === 'control' ? 'control' : 'idle';
            return (
              <div
                key={f.freq}
                className={`glass-panel chan-tile chan-${state} ${dimmed(f) ? 'dim' : ''}`}
                style={live ? ({ '--tg': color } as React.CSSProperties) : undefined}
              >
                <div className="chan-top">
                  <span className="chan-freq">{(f.freq / 1_000_000).toFixed(6)}</span>
                  <span className={`badge ${live ? 'badge-amber' : kind === 'control' ? 'badge-cyan' : 'badge-muted'}`}>
                    {live && <span className="pulse-dot transmitting" />}
                    {live ? 'ON AIR' : KIND_LABEL[kind]}
                  </span>
                </div>

                <div className="chan-line">
                  {live ? (
                    <>
                      <EntityLink kind="tg" id={f.active_tgid} className="chan-tg">{label(f)}</EntityLink>
                      {f.active_src ? <span className="chan-src">ID {f.active_src}</span> : <span className="chan-src">TGID {f.active_tgid}</span>}
                    </>
                  ) : kind === 'control' ? (
                    <span className="chan-note chan-note-cc">Primary control channel</span>
                  ) : kind === 'alt' ? (
                    <span className="chan-note">Alternate control</span>
                  ) : last ? (
                    <span className="chan-note">Last: <span className="chan-last-tg">{last.tag}</span></span>
                  ) : (
                    <span className="chan-note">Standby</span>
                  )}
                </div>

                <div className="chan-foot">
                  <span>Hits <strong className="mono">{f.counter.toLocaleString()}</strong></span>
                  <span>Last <strong className={live ? 'chan-now' : ''}>{f.last_activity || '—'}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
