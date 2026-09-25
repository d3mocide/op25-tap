import React, { useMemo, useState } from 'react';
import { Radio, Search, Users } from 'lucide-react';
import type { Affiliation } from '../types';
import { getTalkgroupColor } from '../utils/colors';
import { formatTs } from '../utils/time';

interface SubscribersTableProps {
  affiliations: Affiliation[];
}

interface UniqueSubscriber {
  rid: number;
  radio_alias?: string | null;
  latest_ts: number;
  latest_tgid: number;
  latest_tg_alias?: string | null;
  latest_site_str?: string | null;
  hit_count: number;
}

export const SubscribersTable: React.FC<SubscribersTableProps> = ({ affiliations }) => {
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'count'>('recent');

  // Collapse raw affiliation stream into unique active subscriber roster
  const uniqueSubscribers = useMemo(() => {
    const map = new Map<number, UniqueSubscriber>();

    for (const a of affiliations) {
      const existing = map.get(a.rid);
      if (!existing) {
        map.set(a.rid, {
          rid: a.rid,
          radio_alias: a.radio_alias,
          latest_ts: a.ts,
          latest_tgid: a.tgid,
          latest_tg_alias: a.tg_alias,
          latest_site_str: a.site_str,
          hit_count: 1,
        });
      } else {
        existing.hit_count += 1;
        // Keep the latest timestamp and latest affiliated talkgroup
        if (a.ts > existing.latest_ts) {
          existing.latest_ts = a.ts;
          existing.latest_tgid = a.tgid;
          existing.latest_tg_alias = a.tg_alias || existing.latest_tg_alias;
          existing.latest_site_str = a.site_str || existing.latest_site_str;
          if (a.radio_alias) existing.radio_alias = a.radio_alias;
        }
      }
    }

    const list = Array.from(map.values());
    if (sortBy === 'count') {
      return list.sort((a, b) => b.hit_count - a.hit_count || b.latest_ts - a.latest_ts);
    }
    return list.sort((a, b) => b.latest_ts - a.latest_ts);
  }, [affiliations, sortBy]);

  const filtered = uniqueSubscribers.filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      String(s.rid).includes(q) ||
      String(s.latest_tgid).includes(q) ||
      (s.latest_tg_alias && s.latest_tg_alias.toLowerCase().includes(q)) ||
      (s.radio_alias && s.radio_alias.toLowerCase().includes(q)) ||
      (s.latest_site_str && s.latest_site_str.toLowerCase().includes(q))
    );
  });

  const formatTime = (ts: number) => formatTs(ts);

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Panel Header */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={15} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, color: 'var(--text-main)' }}>
            Active Subscribers
          </h2>
          <span className="badge badge-cyan mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }} title="Unique active subscriber units">
            {filtered.length} {filtered.length === 1 ? 'Radio' : 'Radios'}
          </span>
        </div>

        <div className="panel-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          {/* Sort Switcher */}
          <div style={{ display: 'inline-flex', background: 'rgba(0, 0, 0, 0.35)', borderRadius: '4px', padding: '2px', border: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setSortBy('recent')}
              style={{
                background: sortBy === 'recent' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                border: 'none',
                color: sortBy === 'recent' ? 'var(--text-main)' : 'var(--text-dim)',
                fontSize: '0.68rem',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Sort by latest activity"
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => setSortBy('count')}
              style={{
                background: sortBy === 'count' ? 'rgba(0, 229, 255, 0.15)' : 'transparent',
                border: 'none',
                color: sortBy === 'count' ? 'var(--accent-cyan)' : 'var(--text-dim)',
                fontSize: '0.68rem',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Sort by number of times heard"
            >
              Most Heard
            </button>
          </div>

          {/* Search Filter */}
          <div className="panel-search" style={{ position: 'relative', minWidth: '150px' }}>
            <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              className="input-search"
              placeholder="Filter RID / TG..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: '100%', paddingLeft: '28px' }}
            />
          </div>
        </div>
      </div>

      {/* Subscriber Card Grid Container */}
      <div className="panel-scroll" style={{ flex: 1, overflowY: 'auto', maxHeight: '520px', padding: '12px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            No active subscriber radios detected yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))',
              gap: '10px',
            }}
          >
            {filtered.map((sub) => {
              const tgColor = getTalkgroupColor(sub.latest_tg_alias);

              return (
                <div key={sub.rid} className="subscriber-card">
                  {/* Top Row: Radio ID + Count Heard Badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Radio size={13} color="var(--accent-cyan)" />
                        <span className="mono" style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          ID {sub.rid}
                        </span>
                      </div>
                      {sub.radio_alias && (
                        <div style={{ fontSize: '0.70rem', color: 'var(--accent-cyan)', marginTop: '2px', fontWeight: 600 }}>
                          {sub.radio_alias}
                        </div>
                      )}
                    </div>

                    {/* Count of that ID heard */}
                    <span
                      className="mono"
                      style={{
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: sub.hit_count > 1 ? 'rgba(0, 229, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${sub.hit_count > 1 ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255, 255, 255, 0.12)'}`,
                        color: sub.hit_count > 1 ? 'var(--accent-cyan)' : 'var(--text-dim)',
                        whiteSpace: 'nowrap',
                      }}
                      title={`${sub.hit_count} times heard`}
                    >
                      {sub.hit_count}× <span style={{ fontSize: '0.60rem', opacity: 0.75, textTransform: 'uppercase' }}>heard</span>
                    </span>
                  </div>

                  {/* Middle Row: Latest Affiliated Talkgroup */}
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: tgColor,
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sub.latest_tg_alias || `TG ${sub.latest_tgid}`}
                    </span>
                    <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                      {sub.latest_tgid}
                    </span>
                  </div>

                  {/* Bottom Row: Last Seen Timestamp & Site */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.70rem', color: 'var(--text-muted)' }}>
                    <span className="mono">{formatTime(sub.latest_ts)}</span>
                    <span className="mono" style={{ color: 'var(--text-dim)' }}>
                      Site {sub.latest_site_str || '1.26'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
