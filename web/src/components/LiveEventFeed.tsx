import React, { useMemo, useState } from 'react';
import { Search, Zap } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import type { EventItem } from '../types';
import { formatSystemLabel, getSystemColor, getTalkgroupCategory, getTalkgroupColor } from '../utils/colors';
import { formatTs } from '../utils/time';
import { useFocus } from '../context/focus';
import { useHoldWhileHovered } from '../hooks/useHoldWhileHovered';
import { EntityLink, PinButton } from './EntityLink';

const eventKey = (ev: EventItem) => ev.id;

interface LiveEventFeedProps {
  events: EventItem[];
  historical?: boolean;
}

export const LiveEventFeed: React.FC<LiveEventFeedProps> = ({ events, historical = false }) => {
  const [filter, setFilter] = useState('');
  const isMobile = useIsMobile();
  const { matches } = useFocus();

  // Guarantee strict descending order (newest first) and deduplication
  const sortedEvents = useMemo(() => {
    const list = [...events].sort((a, b) => b.ts - a.ts);
    const result: EventItem[] = [];
    const seenIds = new Set<number>();

    for (const ev of list) {
      if (seenIds.has(ev.id)) continue;

      // Suppress zero-duration duplicates if a real call exists on this TG/freq within 5s
      if (ev.duration_ms === 0) {
        const hasRealCall = list.some(
          (other) =>
            other.id !== ev.id &&
            (other.to_tg ?? other.to_tgid) === (ev.to_tg ?? ev.to_tgid) &&
            (other.freq ?? other.frequency) === (ev.freq ?? ev.frequency) &&
            Math.abs(other.ts - ev.ts) <= 5.0 &&
            other.duration_ms > 0
        );
        if (hasRealCall) continue;
      }

      seenIds.add(ev.id);
      result.push(ev);
    }
    return result;
  }, [events]);

  const filtered = sortedEvents.filter((ev) => {
    if (!matches(ev.to_tg ?? ev.to_tgid)) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    const tgVal = ev.to_tg ?? ev.to_tgid;
    const tgName = ev.tg_tag ?? ev.tg_alias;
    const fromVal = ev.from ?? ev.from_rid;
    const freqVal = ev.freq ?? ev.frequency;
    const sysLabel = formatSystemLabel(ev.system);
    const siteLabel = ev.site_str || ev.site || '';
    const cat = getTalkgroupCategory(tgName, ev.tg_group, ev.category);
    return (
      (tgName && tgName.toLowerCase().includes(q)) ||
      (ev.from_alias && ev.from_alias.toLowerCase().includes(q)) ||
      (tgVal !== undefined && tgVal !== null && String(tgVal).includes(q)) ||
      (fromVal !== undefined && fromVal !== null && String(fromVal).includes(q)) ||
      (freqVal !== undefined && freqVal !== null && String(freqVal).includes(q)) ||
      (ev.system && ev.system.toLowerCase().includes(q)) ||
      sysLabel.toLowerCase().includes(q) ||
      cat.label.toLowerCase().includes(q) ||
      siteLabel.toLowerCase().includes(q)
    );
  });

  const { shown, pending, hoverProps, flush, holding } = useHoldWhileHovered(filtered, eventKey);

  return (
    <div className="glass-panel panel-col">
      <div className="panel-header">
        <div className="panel-title">
          <Zap size={15} color="var(--accent-cyan)" />
          <h2>{historical ? 'Call History' : 'Call History — Real-Time Stream'}</h2>
          <span className={`badge badge-muted mono badge-sm ${holding ? 'held' : ''}`} title={holding ? 'Paused while the pointer is over the list' : undefined}>{filtered.length}</span>
        </div>

        <div className="panel-search">
          <Search size={13} />
          <input
            type="text"
            className="input-search"
            placeholder="Filter calls..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
          <div className="new-pill-slot">
            {pending > 0 && (
              <button type="button" className="new-pill" onClick={flush} {...hoverProps}>
                {pending} new {pending === 1 ? 'call' : 'calls'}
              </button>
            )}
          </div>
      </div>

      <div className="panel-scroll" {...hoverProps}>
        {shown.length === 0 ? (
          <div className="empty-note">No call events recorded yet. Waiting for live transmissions...</div>
        ) : isMobile ? (
          <MobileCallList events={shown} />
        ) : (
          <table className="tactical-table call-table">
            <thead>
              <tr>
                <th className="c-time">Time</th>
                <th className="c-sys">Sys/Site</th>
                <th className="c-svc">Svc</th>
                <th className="c-tg">Talkgroup</th>
                <th className="c-freq">Frequency</th>
                <th className="c-src">Source</th>
                <th className="c-dur">Duration</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((ev, idx) => {
                const tgNum = ev.to_tg ?? ev.to_tgid;
                const tgName = ev.tg_tag ?? ev.tg_alias ?? (tgNum ? `TG ${tgNum}` : '—');
                const fromNum = ev.from ?? ev.from_rid;
                const freqNum = ev.freq ?? ev.frequency;
                const mhz = freqNum ? (freqNum / 1_000_000).toFixed(4) : '—';
                const durSec = ev.duration_ms > 0 ? (ev.duration_ms / 1000).toFixed(1) + 's' : '< 1s';
                const rowKey = ev.id || `${ev.ts}-${idx}`;
                const sysLabel = formatSystemLabel(ev.system);
                const siteLabel = ev.site_str || ev.site || '—';
                const cat = getTalkgroupCategory(tgName, ev.tg_group, ev.category);

                return (
                  <tr key={rowKey}>
                    <td className="cell-time">{formatTs(ev.ts)}</td>

                    <td className="cell-mono nowrap call-sys" style={{ '--sys': getSystemColor(sysLabel) } as React.CSSProperties}>
                      <span className="call-sys-label">{sysLabel}</span>
                      <span className="call-sep">·</span>
                      <span className="text-muted">{siteLabel}</span>
                    </td>

                    <td className="col-center nowrap">
                      <span className="cat-tag" style={{ '--cat': cat.color } as React.CSSProperties} title={cat.fullLabel || cat.label}>
                        {cat.label}
                      </span>
                    </td>

                    <td className="nowrap">
                      <div className="tg-line" style={{ '--tg': getTalkgroupColor(tgName) } as React.CSSProperties}>
                        <EntityLink kind="tg" id={tgNum}>{tgName}</EntityLink>
                        {tgNum && <span className="id-pill">{tgNum}</span>}
                        <PinButton tgid={tgNum} />
                      </div>
                    </td>

                    <td className="cell-mono cell-sm nowrap">{mhz}</td>

                    <td className="cell-mono nowrap">
                      {fromNum ? <EntityLink kind="rid" id={fromNum} className="mono-cyan cell-sm">{fromNum}</EntityLink> : <span className="mono-dim cell-sm">—</span>}
                      {ev.from_alias && <div className="mono-dim call-alias ellipsis">{ev.from_alias}</div>}
                    </td>

                    <td className="cell-mono cell-sm text-dim nowrap">{durSec}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

/** Phone layout: one compact two-line row per call instead of a 7-column table. */
const MobileCallList: React.FC<{ events: EventItem[] }> = ({ events }) => (
  <div>
    {events.map((ev, idx) => {
      const tgNum = ev.to_tg ?? ev.to_tgid;
      const tgName = ev.tg_tag ?? ev.tg_alias ?? (tgNum ? `TG ${tgNum}` : '—');
      const fromNum = ev.from ?? ev.from_rid;
      const freqNum = ev.freq ?? ev.frequency;
      const mhz = freqNum ? (freqNum / 1_000_000).toFixed(4) : null;
      const durSec = ev.duration_ms > 0 ? (ev.duration_ms / 1000).toFixed(1) + 's' : '< 1s';
      const sysLabel = formatSystemLabel(ev.system);
      const siteLabel = ev.site_str || ev.site || '—';
      const cat = getTalkgroupCategory(tgName, ev.tg_group, ev.category);

      return (
        <div key={ev.id || `${ev.ts}-${idx}`} className="call-row">
          <div className="call-row-line">
            <span className="cat-tag" style={{ '--cat': cat.color } as React.CSSProperties}>{cat.label}</span>
            <EntityLink kind="tg" id={tgNum} className="call-row-tg"><span style={{ color: getTalkgroupColor(tgName) }}>{tgName}</span></EntityLink>
            {tgNum && <span className="mono-dim call-row-id">{tgNum}</span>}
            <span className="call-row-time">{formatTs(ev.ts)}</span>
          </div>
          <div className="call-row-line mono call-row-sub">
            {fromNum ? <EntityLink kind="rid" id={fromNum} className="mono-cyan">{fromNum}</EntityLink> : <span>—</span>}
            {ev.from_alias && <span className="call-row-alias">{ev.from_alias}</span>}
            <span className="call-row-tail">
              {mhz && <>{mhz} · </>}
              <span style={{ color: getSystemColor(sysLabel) }}>{sysLabel}</span> {siteLabel} · {durSec}
            </span>
          </div>
        </div>
      );
    })}
  </div>
);
