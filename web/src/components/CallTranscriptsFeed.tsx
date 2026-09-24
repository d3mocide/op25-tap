import React, { useMemo, useRef, useState } from 'react';
import { Headphones, MessageSquareQuote, Play, Radio, Search, Square, Volume2 } from 'lucide-react';
import type { EventItem } from '../types';
import { formatSystemLabel, getSystemColor, getTalkgroupColor } from '../utils/colors';
import { formatTs } from '../utils/time';

interface CallTranscriptsFeedProps {
  events: EventItem[];
  historical?: boolean;
}

export const CallTranscriptsFeed: React.FC<CallTranscriptsFeedProps> = ({ events, historical = false }) => {
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
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Panel Header */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquareQuote size={16} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '0.84rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, color: 'var(--text-main)' }}>
            {historical ? 'Voice Intercepts & Transcriptions' : 'Voice Intercepts & Live Transcriptions'}
          </h2>
          <span className="badge badge-cyan mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
            {filtered.length} {filtered.length === 1 ? 'call' : 'calls'}
          </span>
        </div>

        <div style={{ position: 'relative', minWidth: '220px', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            className="input-search"
            placeholder="Search transcripts, RID, talkgroups..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', paddingLeft: '28px' }}
          />
        </div>
      </div>

      {/* Feed List Container */}
      <div style={{ padding: '12px', maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            <Headphones size={24} style={{ display: 'block', margin: '0 auto 8px', color: 'var(--text-dim)', opacity: 0.5 }} />
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
                style={{
                  background: isThisPlaying ? 'rgba(0, 229, 255, 0.05)' : 'rgba(15, 16, 20, 0.65)',
                  border: `1px solid ${isThisPlaying ? 'rgba(0, 229, 255, 0.35)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Meta Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {/* Timestamp */}
                    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600 }}>
                      {formatTime(ev.ts)}
                    </span>

                    {/* Station / System Badge */}
                    <span
                      className="mono"
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: sysColor,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: `1px solid ${sysColor}50`,
                        padding: '1px 6px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {sysLabel}
                    </span>

                    {/* Talkgroup Pill */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.04)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <Radio size={12} color={tgColor} />
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: tgColor }}>
                        {tgName}
                      </span>
                      {tgNum && (
                        <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', background: 'rgba(0, 0, 0, 0.3)', padding: '1px 5px', borderRadius: '3px' }}>
                          {tgNum}
                        </span>
                      )}
                    </div>

                    {/* Source RID */}
                    {fromNum ? (
                      <span className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Source: <strong style={{ color: 'var(--accent-cyan)' }}>ID {fromNum}</strong>
                        {ev.from_alias && <span style={{ color: 'var(--text-dim)', marginLeft: '4px' }}>({ev.from_alias})</span>}
                      </span>
                    ) : null}

                    {/* Frequency */}
                    {mhz && (
                      <span className="mono" style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                        {mhz} MHz
                      </span>
                    )}

                    {/* Duration */}
                    <span className="badge badge-muted mono" style={{ fontSize: '0.68rem', padding: '1px 5px' }}>
                      {durSec}
                    </span>
                  </div>

                  {/* Play Audio Button */}
                  {ev.has_audio && (
                    <button
                      type="button"
                      onClick={() => toggleAudio(ev.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: isThisPlaying ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 229, 255, 0.12)',
                        border: `1px solid ${isThisPlaying ? '#ef4444' : 'rgba(0, 229, 255, 0.4)'}`,
                        color: isThisPlaying ? '#ef4444' : 'var(--accent-cyan)',
                        borderRadius: '4px',
                        padding: '3px 9px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        letterSpacing: '0.04em',
                        transition: 'all 0.15s ease',
                      }}
                      title={isThisPlaying ? 'Stop playback' : 'Play recorded call audio'}
                    >
                      {isThisPlaying ? <Square size={11} /> : <Play size={11} />}
                      <span>{isThisPlaying ? 'STOP' : 'PLAY AUDIO'}</span>
                    </button>
                  )}
                </div>

                {/* Transcription Text Bubble */}
                {ev.transcript ? (
                  <div
                    style={{
                      background: 'rgba(0, 229, 255, 0.04)',
                      borderLeft: '3px solid var(--accent-cyan)',
                      borderRadius: '0 4px 4px 0',
                      padding: '6px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Volume2 size={13} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.80rem', color: '#f1f5f9', fontWeight: 500, lineHeight: 1.4, letterSpacing: '0.01em' }}>
                      &ldquo;{ev.transcript}&rdquo;
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', fontStyle: 'italic', paddingLeft: '4px' }}>
                    Transcribing audio transmission...
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
