import React, { useEffect, useId, useRef, useState } from 'react';
import { formatDuration } from '../utils/time';

export interface BarBucket {
  start: number; // epoch seconds
  end: number;
  calls: number;
  airtime_ms: number;
  anomalies: number;
}

interface BarTimelineProps {
  buckets: BarBucket[];
  height?: number;
  /** Called with a sub-range from a drag, or a single bucket from a click. */
  onSelect?: (from: number, to: number) => void;
  formatTick: (ts: number) => string;
  formatBucket: (b: BarBucket) => string;
  selectHint?: string;
}

const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 18;
const ANOM_BAND = 6;

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/**
 * Calls-per-bucket bar chart. Alerts are marked in the amber band above the bars.
 * Hover shows the bucket; click zooms to it; drag selects a sub-range.
 */
export const BarTimeline: React.FC<BarTimelineProps> = ({
  buckets, height = 96, onSelect, formatTick, formatBucket, selectHint,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = buckets.length;
  const plotW = width - PAD_L - PAD_R;
  const plotTop = PAD_T + ANOM_BAND;
  const plotH = height - plotTop - PAD_B;
  const maxCalls = niceMax(Math.max(0, ...buckets.map((b) => b.calls)));
  const slot = n ? plotW / n : plotW;
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0; // 2px surface gap between bars when there's room
  const barW = Math.max(1, slot - gap);
  const y = (v: number) => plotTop + plotH - (v / maxCalls) * plotH;

  const indexAt = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - PAD_L) / slot);
    return Math.min(n - 1, Math.max(0, i));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onSelect || !n) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = indexAt(e.clientX);
    setDrag({ a: i, b: i });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!n) return;
    const i = indexAt(e.clientX);
    setHover(i);
    if (drag) setDrag({ ...drag, b: i });
  };
  const onPointerUp = () => {
    if (drag && onSelect) {
      const lo = Math.min(drag.a, drag.b);
      const hi = Math.max(drag.a, drag.b);
      onSelect(buckets[lo].start, buckets[hi].end);
    }
    setDrag(null);
  };

  const ticks = (() => {
    if (!n) return [];
    const want = Math.max(2, Math.floor(plotW / 110));
    const step = Math.max(1, Math.ceil(n / want));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    return out;
  })();

  const hb = hover !== null ? buckets[hover] : null;
  const sel = drag ? { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) } : null;

  return (
    <div ref={wrapRef} className="bar-timeline">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Calls over time"
        className={onSelect ? 'bar-svg selectable' : 'bar-svg'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setHover(null); }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.95} />
            <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0.25} />
          </linearGradient>
        </defs>
        {/* Recessive grid: baseline + max */}
        <line x1={PAD_L} x2={width - PAD_R} y1={y(0)} y2={y(0)} stroke="var(--border-button)" />
        <line x1={PAD_L} x2={width - PAD_R} y1={y(maxCalls)} y2={y(maxCalls)} stroke="var(--border-subtle)" strokeDasharray="2 3" />
        <text className="chart-axis" x={PAD_L - 6} y={y(maxCalls) + 3} textAnchor="end">{maxCalls}</text>
        <text className="chart-axis" x={PAD_L - 6} y={y(0) + 3} textAnchor="end">0</text>

        {sel && (
          <rect
            x={PAD_L + sel.lo * slot}
            y={PAD_T}
            width={(sel.hi - sel.lo + 1) * slot}
            height={height - PAD_T - PAD_B}
            fill="var(--accent-cyan)"
            opacity={0.12}
          />
        )}

        {buckets.map((b, i) => {
          const x = PAD_L + i * slot + gap / 2;
          const h = y(0) - y(b.calls);
          const r = Math.min(2, barW / 2, h);
          return (
            <g key={b.start}>
              {b.calls > 0 && (
                // Rounded data-end, square at the baseline.
                <path
                  d={`M${x},${y(0)} V${y(b.calls) + r} Q${x},${y(b.calls)} ${x + r},${y(b.calls)} H${x + barW - r} Q${x + barW},${y(b.calls)} ${x + barW},${y(b.calls) + r} V${y(0)} Z`}
                  fill={`url(#${gid})`}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
              )}
              {b.anomalies > 0 && (
                <rect x={x} y={PAD_T} width={Math.max(2, barW)} height={ANOM_BAND - 2} rx={1} fill="var(--accent-amber)" />
              )}
            </g>
          );
        })}

        {hover !== null && (
          <line
            x1={PAD_L + hover * slot + slot / 2}
            x2={PAD_L + hover * slot + slot / 2}
            y1={PAD_T}
            y2={y(0)}
            stroke="var(--text-dim)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {ticks.map((i) => (
          <text key={i} className="chart-axis" x={PAD_L + i * slot} y={height - 4}>
            {formatTick(buckets[i].start)}
          </text>
        ))}
      </svg>

      {hb && !drag && (
        <div
          className="chart-tooltip bar-tip"
          style={{ left: Math.min(width - 170, Math.max(0, PAD_L + (hover ?? 0) * slot - 60)) }}
        >
          <div className="bar-tip-title">{formatBucket(hb)}</div>
          <div><strong>{hb.calls.toLocaleString()}</strong> calls · <strong>{formatDuration(hb.airtime_ms)}</strong></div>
          {hb.anomalies > 0 && (
            <div><strong className="bar-tip-alerts">{hb.anomalies}</strong> alerts</div>
          )}
          {selectHint && <div className="bar-tip-hint">{selectHint}</div>}
        </div>
      )}
    </div>
  );
};
