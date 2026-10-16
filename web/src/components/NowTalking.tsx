import React, { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useFocus } from '../context/focus';
import type { ChannelInfo, FrequencyInfo } from '../types';
import { getTalkgroupColor } from '../utils/colors';
import { EntityLink } from './EntityLink';
import '../styles/nowbar.css';

interface Props {
  frequencies: Record<string, FrequencyInfo>;
  channels: ChannelInfo[];
}

interface Started {
  tgid: number;
  at: number;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Slim strip under the header listing every call on the air right now with a
 * running timer. It keeps a fixed height whether or not anything is talking,
 * so the page below never shifts.
 */
export const NowTalking: React.FC<Props> = ({ frequencies, channels }) => {
  const { matches, follow, pins } = useFocus();
  const starts = useRef(new Map<number, Started>());
  const [, tick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const now = Date.now();
  const live = Object.values(frequencies).filter((f) => f.active_tgid);

  // Remember when each call keyed up; forget channels that went quiet.
  const liveFreqs = new Set(live.map((f) => f.freq));
  for (const key of [...starts.current.keys()]) if (!liveFreqs.has(key)) starts.current.delete(key);
  for (const f of live) {
    const prev = starts.current.get(f.freq);
    if (!prev || prev.tgid !== f.active_tgid) starts.current.set(f.freq, { tgid: f.active_tgid!, at: now });
  }

  const encrypted = new Set(channels.filter((c) => c.encrypted && c.freq).map((c) => c.freq));
  const focusing = follow && pins.size > 0;

  return (
    <div className="nowbar" role="status" aria-live="off">
      <span className="nowbar-label"><Mic size={13} /> ON AIR</span>
      {live.length === 0 ? (
        <span className="nowbar-quiet">Quiet: no active calls</span>
      ) : (
        <div className="nowbar-calls">
          {live.map((f) => {
            const secs = Math.max(0, Math.round((now - (starts.current.get(f.freq)?.at ?? now)) / 1000));
            const dim = focusing && !matches(f.active_tgid);
            return (
              <span
                key={f.freq}
                className={`nowbar-call ${dim ? 'dim' : ''}`}
                style={{ '--tg': getTalkgroupColor(f.active_tag) } as React.CSSProperties}
              >
                <span className="pulse-dot transmitting" />
                <EntityLink kind="tg" id={f.active_tgid} className="nowbar-tg">{f.active_tag || `TG ${f.active_tgid}`}</EntityLink>
                {f.active_src ? <EntityLink kind="rid" id={f.active_src} className="nowbar-src">{f.active_src}</EntityLink> : null}
                {encrypted.has(f.freq) && <span className="nowbar-enc">ENC</span>}
                <span className="nowbar-time">{clock(secs)}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};
