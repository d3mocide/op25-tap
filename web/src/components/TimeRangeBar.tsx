import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, History, Radio } from 'lucide-react';
import type { TimeRange } from '../types';
import { addDays, formatRange, fromInputValue, startOfDay, toInputValue } from '../utils/time';

interface TimeRangeBarProps {
  range: TimeRange | null;
  onChange: (range: TimeRange | null) => void;
  /** Earliest time raw history is kept for (retention cutoff), if any. */
  historyStart: number | null;
}

type Preset = { key: string; label: string; make: (now: number) => TimeRange };

const PRESETS: Preset[] = [
  { key: '1h', label: 'Last hour', make: (now) => ({ from: now - 3600, to: now }) },
  { key: '24h', label: 'Last 24h', make: (now) => ({ from: now - 86400, to: now }) },
  { key: 'today', label: 'Today', make: (now) => ({ from: startOfDay(now), to: addDays(now, 1) }) },
  { key: 'yesterday', label: 'Yesterday', make: (now) => ({ from: addDays(now, -1), to: startOfDay(now) }) },
  { key: '7d', label: '7 days', make: (now) => ({ from: addDays(now, -6), to: addDays(now, 1) }) },
  { key: '30d', label: '30 days', make: (now) => ({ from: addDays(now, -29), to: addDays(now, 1) }) },
];

const nowSec = () => Math.floor(Date.now() / 1000);

/** Live / History switch, range presets, custom range and step back/forward. */
export const TimeRangeBar: React.FC<TimeRangeBarProps> = ({ range, onChange, historyStart }) => {
  // Preset key plus the exact range it produced, so it un-highlights after a zoom or shift.
  const [lastPreset, setLastPreset] = useState<{ key: string; from: number; to: number } | null>(null);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const apply = (r: TimeRange, preset: string | null = null) => {
    const next = { from: Math.floor(Math.max(r.from, historyStart ?? 0)), to: Math.ceil(r.to) };
    setLastPreset(preset ? { key: preset, ...next } : null);
    setCustom(null);
    onChange(next);
  };
  const activePreset =
    range && lastPreset && lastPreset.from === range.from && lastPreset.to === range.to ? lastPreset.key : null;

  // Shift by the range's own length; whole-day ranges step by calendar days (DST-safe).
  const shift = (dir: -1 | 1) => {
    if (!range) return;
    const isDays = range.from === startOfDay(range.from) && range.to === startOfDay(range.to);
    if (isDays) {
      const days = Math.round((range.to - range.from) / 86400);
      apply({ from: addDays(range.from, dir * days), to: addDays(range.to, dir * days) });
    } else {
      const len = range.to - range.from;
      apply({ from: range.from + dir * len, to: range.to + dir * len });
    }
  };

  const minInput = historyStart ? toInputValue(historyStart) : undefined;
  const maxInput = toInputValue(nowSec() + 60);
  const canBack = !!range && (!historyStart || range.from > historyStart);
  const canForward = !!range && range.to < nowSec();

  const customFrom = custom?.from ?? (range ? toInputValue(range.from) : '');
  const customTo = custom?.to ?? (range ? toInputValue(Math.min(range.to, nowSec())) : '');
  const parsed = { from: fromInputValue(customFrom), to: fromInputValue(customTo) };
  const customValid = parsed.from !== null && parsed.to !== null && parsed.to > parsed.from;

  return (
    <div className="range-bar">
      <div className="segmented" role="group" aria-label="Data mode">
        <button className={!range ? 'on' : ''} onClick={() => onChange(null)} aria-pressed={!range}>
          <Radio size={13} /> Live
        </button>
        <button
          className={range ? 'on' : ''}
          aria-pressed={!!range}
          onClick={() => !range && apply(PRESETS[1].make(nowSec()), '24h')}
        >
          <History size={13} /> History
        </button>
      </div>

      {range && (
        <>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`chip ${activePreset === p.key ? 'on' : ''}`}
              aria-pressed={activePreset === p.key}
              onClick={() => apply(p.make(nowSec()), p.key)}
            >
              {p.label}
            </button>
          ))}

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <button className="btn" style={{ padding: '4px 6px' }} onClick={() => shift(-1)} disabled={!canBack} title="Previous period" aria-label="Previous period">
              <ChevronLeft size={14} />
            </button>
            <strong className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-main)', padding: '0 4px' }}>
              {formatRange(range.from, range.to)}
            </strong>
            <button className="btn" style={{ padding: '4px 6px' }} onClick={() => shift(1)} disabled={!canForward} title="Next period" aria-label="Next period">
              <ChevronRight size={14} />
            </button>
          </div>

          <form
            className="range-custom"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) apply({ from: parsed.from!, to: parsed.to! });
            }}
          >
            <input
              type="datetime-local"
              className="input-dt"
              aria-label="Range start"
              value={customFrom}
              min={minInput}
              max={maxInput}
              onChange={(e) => setCustom({ from: e.target.value, to: customTo })}
            />
            <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>to</span>
            <input
              type="datetime-local"
              className="input-dt"
              aria-label="Range end"
              value={customTo}
              min={minInput}
              max={maxInput}
              onChange={(e) => setCustom({ from: customFrom, to: e.target.value })}
            />
            <button type="submit" className="btn" disabled={!custom || !customValid}>Apply</button>
          </form>
        </>
      )}
    </div>
  );
};
