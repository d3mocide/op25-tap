import React, { useMemo, useState } from 'react';
import { Search, Zap } from 'lucide-react';
import type { EventItem } from '../types';
import { formatSystemLabel, getSystemColor, getTalkgroupCategory, getTalkgroupColor } from '../utils/colors';

interface LiveEventFeedProps {
  events: EventItem[];
}

export const LiveEventFeed: React.FC<LiveEventFeedProps> = ({ events }) => {
  const [filter, setFilter] = useState('');

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

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar styled like OP25 Call History bar */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={15} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, color: 'var(--text-main)' }}>
            Call History — Real-Time Stream
          </h2>
          <span className="badge badge-muted mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>{filtered.length}</span>
        </div>

        <div style={{ position: 'relative', minWidth: '180px', marginLeft: 'auto' }}>
          <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            className="input-search"
            placeholder="Filter calls..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', paddingLeft: '28px' }}
          />
        </div>
      </div>

      {/* Events Table Container */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '520px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            No call events recorded yet. Waiting for live transmissions...
          </div>
        ) : (
          <table className="tactical-table">
            <thead>
              <tr>
                <th style={{ width: '74px', whiteSpace: 'nowrap' }}>Time</th>
                <th style={{ width: '84px', whiteSpace: 'nowrap' }}>Sys/Site</th>
                <th style={{ width: '56px', textAlign: 'center', whiteSpace: 'nowrap' }}>Svc</th>
                <th style={{ minWidth: '135px', whiteSpace: 'nowrap' }}>Talkgroup</th>
                <th style={{ width: '92px', whiteSpace: 'nowrap' }}>Frequency</th>
                <th style={{ width: '78px', whiteSpace: 'nowrap' }}>Source</th>
                <th style={{ width: '56px', whiteSpace: 'nowrap' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev, idx) => {
                const tgNum = ev.to_tg ?? ev.to_tgid;
                const tgName = ev.tg_tag ?? ev.tg_alias ?? (tgNum ? `TG ${tgNum}` : '—');
                const fromNum = ev.from ?? ev.from_rid;
                const freqNum = ev.freq ?? ev.frequency;
                // 4 decimal places for clean readable frequencies e.g. 851.7250
                const mhz = freqNum ? (freqNum / 1_000_000).toFixed(4) : '—';
                const durSec = ev.duration_ms > 0 ? (ev.duration_ms / 1000).toFixed(1) + 's' : '< 1s';
                const tgColor = getTalkgroupColor(tgName);
                const rowKey = ev.id || `${ev.ts}-${idx}`;
                const sysLabel = formatSystemLabel(ev.system);
                const sysColor = getSystemColor(sysLabel);
                const siteLabel = ev.site_str || ev.site || '1.26';
                const cat = getTalkgroupCategory(tgName, ev.tg_group, ev.category);

                return (
                  <tr key={rowKey}>
                    <td className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      {formatTime(ev.ts)}
                    </td>

                    <td className="mono" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      <span style={{ color: sysColor, fontWeight: 700 }}>{sysLabel}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 3px' }}>·</span>
                      <span style={{ color: 'var(--text-muted)' }}>{siteLabel}</span>
                    </td>

                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <span
                        className="mono"
                        style={{
                          display: 'inline-block',
                          fontSize: '0.64rem',
                          fontWeight: 800,
                          color: cat.color,
                          background: `${cat.color}18`,
                          border: `1px solid ${cat.color}45`,
                          padding: '1px 5px',
                          borderRadius: '3px',
                          letterSpacing: '0.04em',
                        }}
                        title={cat.fullLabel || cat.label}
                      >
                        {cat.label}
                      </span>
                    </td>

                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600, color: tgColor, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span>{tgName}</span>
                        {tgNum && (
                          <span
                            className="mono"
                            style={{
                              fontSize: '0.68rem',
                              color: 'var(--text-dim)',
                              fontWeight: 500,
                              background: 'rgba(255, 255, 255, 0.06)',
                              padding: '1px 5px',
                              borderRadius: '3px',
                            }}
                          >
                            {tgNum}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                      {mhz}
                    </td>

                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {fromNum ? (
                        <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '0.78rem' }}>
                          {fromNum}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>—</span>
                      )}
                      {ev.from_alias && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ev.from_alias}
                        </div>
                      )}
                    </td>

                    <td className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {durSec}
                    </td>
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
