import React, { useMemo, useRef, useState } from 'react';
import { Headphones, History, MessageSquareQuote, Play, Radio, Search, Square, Volume2 } from 'lucide-react';
import type { EventItem } from '../types';
import { formatSystemLabel, getSystemColor, getTalkgroupColor } from '../utils/colors';
import { formatTs } from '../utils/time';
import '../styles/feeds.css';
import { useFocus } from '../context/focus';
import { EntityLink, PinButton } from './EntityLink';

/** Wraps matches of the search text in <mark>. */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return parts;
}

interface CallTranscriptsFeedProps {
  events: EventItem[];
  historical?: boolean;
  /** Open this call's moment in History (a few minutes either side). */
  onJumpToCall?: (ev: EventItem) => void;
}

export const CallTranscriptsFeed: React.FC<CallTranscriptsFeedProps> = ({ events, historical = false, onJumpToCall }) => {
  const { matches } = useFocus();
  const [filter, setFilter] = useState('');
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggleAudio = (id: number) => {
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(`/api/audio/call/${id}`);
    audioRef.current = audio;
    setPlayingId(id);

    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingId(null);
      audioRef.current = null;
    };

    audio.play().catch(() => {
      setPlayingId(null);
      audioRef.current = null;
    });
  };

  // Only consider events that have audio or a transcript
  const transcriptEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.ts - a.ts);
    const seen = new Set<number>();
    const result: EventItem[] = [];
    for (const ev of sorted) {
      if (seen.has(ev.id)) continue;
      if (!ev.has_audio && !ev.transcript) continue;
      seen.add(ev.id);
      result.push(ev);
    }
    return result;
  }, [events]);

  const filtered = transcriptEvents.filter((ev) => {
    if (!matches(ev.to_tg ?? ev.to_tgid)) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    const tgVal = ev.to_tg ?? ev.to_tgid;
    const tgName = ev.tg_tag ?? ev.tg_alias;
    const fromVal = ev.from ?? ev.from_rid;
    const transcript = ev.transcript?.toLowerCase();
    const sysLabel = formatSystemLabel(ev.system);
    return (
      (tgName && tgName.toLowerCase().includes(q)) ||
      (ev.from_alias && ev.from_alias.toLowerCase().includes(q)) ||
      (tgVal !== undefined && tgVal !== null && String(tgVal).includes(q)) ||
      (fromVal !== undefined && fromVal !== null && String(fromVal).includes(q)) ||
      (transcript && transcript.includes(q)) ||
      (ev.system && ev.system.toLowerCase().includes(q)) ||
      sysLabel.toLowerCase().includes(q)
    );
  });

  const formatTime = (ts: number) => formatTs(ts);

  return (
    <div className="glass-panel panel-col auto-h">
      <div className="panel-header">
        <div className="panel-title">
          <MessageSquareQuote size={16} color="var(--accent-cyan)" />
          <h2>{historical ? 'Voice Intercepts & Transcriptions' : 'Voice Intercepts & Live Transcriptions'}</h2>
          <span className="badge badge-cyan mono badge-sm">
            {filtered.length} {filtered.length === 1 ? 'call' : 'calls'}
          </span>
        </div>

        <div className="panel-search wide">
          <Search size={13} />
          <input
            type="text"
            className="input-search"
            placeholder="Search transcripts, RID, talkgroups..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="panel-scroll pad xcript-list">
        {filtered.length === 0 ? (
          <div className="empty-note xcript-empty">
            <Headphones size={24} />
            No recorded voice intercepts captured yet. Calls will appear here as voice transmissions finish and transcribe.
          </div>
        ) : (
          filtered.map((ev) => {
            const tgNum = ev.to_tg ?? ev.to_tgid;
            const tgName = ev.tg_tag ?? ev.tg_alias ?? (tgNum ? `TG ${tgNum}` : '—');
            const tgColor = getTalkgroupColor(tgName);
            const fromNum = ev.from ?? ev.from_rid;
            const freqNum = ev.freq ?? ev.frequency;
            const mhz = freqNum ? (freqNum / 1_000_000).toFixed(4) : null;
            const durSec = ev.duration_ms > 0 ? (ev.duration_ms / 1000).toFixed(1) + 's' : '< 1s';
            const isThisPlaying = playingId === ev.id;
            const sysLabel = formatSystemLabel(ev.system);
            const sysColor = getSystemColor(sysLabel);

            return (
              <div
                key={ev.id}
                className={`xcript ${isThisPlaying ? 'playing' : ''}`}
                style={{ '--tg': tgColor, '--sys': sysColor } as React.CSSProperties}
              >
                <div className="xcript-meta">
                  <div className="row-wrap xcript-meta-l">
                    <span className="xcript-time">{formatTime(ev.ts)}</span>
                    <span className="xcript-sys">{sysLabel}</span>

                    <div className="xcript-tg">
                      <Radio size={12} color={tgColor} />
                      <EntityLink kind="tg" id={tgNum} className="xcript-tg-name">{tgName}</EntityLink>
                      {tgNum && <span className="id-pill">{tgNum}</span>}
                      <PinButton tgid={tgNum} />
                    </div>

                    {fromNum ? (
                      <span className="xcript-src">
                        Source: <EntityLink kind="rid" id={fromNum} className="xcript-rid">ID {fromNum}</EntityLink>
                        {ev.from_alias && <span className="xcript-alias">({ev.from_alias})</span>}
                      </span>
                    ) : null}

                    {mhz && <span className="mono-dim xcript-freq">{mhz} MHz</span>}

                    <span className="badge badge-muted mono badge-sm">{durSec}</span>
                  </div>

                  <div className="row">
                  {onJumpToCall && (
                    <button type="button" className="jump-btn" onClick={() => onJumpToCall(ev)} title="Show this call in History, with the calls around it">
                      <History size={11} /> <span>HISTORY</span>
                    </button>
                  )}
                  {ev.has_audio && (
                    <button
                      type="button"
                      onClick={() => toggleAudio(ev.id)}
                      className={`play-btn ${isThisPlaying ? 'stop' : ''}`}
                      title={isThisPlaying ? 'Stop playback' : 'Play recorded call audio'}
                    >
                      {isThisPlaying ? <Square size={11} /> : <Play size={11} />}
                      <span>{isThisPlaying ? 'STOP' : 'PLAY AUDIO'}</span>
                    </button>
                  )}
                  </div>
                </div>

                {ev.transcript ? (
                  <div className="xcript-bubble">
                    <Volume2 size={13} color="var(--accent-cyan)" />
                    <span>&ldquo;{highlight(ev.transcript, filter)}&rdquo;</span>
                  </div>
                ) : (
                  <div className="xcript-pending">Transcribing audio transmission...</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
