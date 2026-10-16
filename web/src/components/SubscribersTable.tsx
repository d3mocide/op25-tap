import React, { useMemo, useState } from 'react';
import { Radio, Search, Users } from 'lucide-react';
import type { Affiliation } from '../types';
import { getTalkgroupCategory } from '../utils/colors';
import { formatTs } from '../utils/time';
import '../styles/subscribers.css';
import { useFocus } from '../context/focus';
import { useHoldWhileHovered } from '../hooks/useHoldWhileHovered';
import { EntityLink } from './EntityLink';

const subKey = (s: { rid: number }) => s.rid;

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
  const { matches } = useFocus();
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
    if (!matches(s.latest_tgid)) return false;
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

  const now = Date.now() / 1000;
  const { shown, pending, hoverProps, flush, holding } = useHoldWhileHovered(filtered, subKey);

  return (
    <div className="glass-panel panel-col">
      <div className="panel-header">
        <div className="panel-title">
          <Users size={15} color="var(--accent-cyan)" />
          <h2>Active Subscribers</h2>
          <span className={`badge badge-cyan mono badge-sm ${holding ? 'held' : ''}`} title={holding ? 'Paused while the pointer is over the list' : 'Unique active subscriber units'}>
            {filtered.length} {filtered.length === 1 ? 'Radio' : 'Radios'}
          </span>
        </div>

        <div className="panel-controls row sub-controls">
          <div className="seg">
            <button type="button" className={sortBy === 'recent' ? 'on' : ''} onClick={() => setSortBy('recent')} title="Sort by latest activity">
              Recent
            </button>
            <button type="button" className={sortBy === 'count' ? 'on' : ''} onClick={() => setSortBy('count')} title="Sort by number of times heard">
              Most Heard
            </button>
          </div>

          <div className="panel-search sub-search">
            <Search size={13} />
            <input
              type="text"
              className="input-search"
              placeholder="Filter RID / TG..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
          <div className="new-pill-slot">
            {pending > 0 && (
              <button type="button" className="new-pill" onClick={flush} {...hoverProps}>
                {pending} new {pending === 1 ? 'radio' : 'radios'}
              </button>
            )}
          </div>
      </div>

      <div className="panel-scroll pad" {...hoverProps}>
        {shown.length === 0 ? (
          <div className="empty-note">No active subscriber radios detected yet.</div>
        ) : (
          <div className="sub-grid">
            {shown.map((sub) => {
              const cat = getTalkgroupCategory(sub.latest_tg_alias);
              const fresh = now - sub.latest_ts < 60;
              const repeat = sub.hit_count > 1;

              return (
                <div key={sub.rid} className={`sub-card ${fresh ? 'fresh' : ''}`} style={{ '--cat': cat.color } as React.CSSProperties}>
                  <div className="sub-top">
                    <div className="grow">
                      <div className="sub-id">
                        {fresh ? <span className="pulse-dot sub-dot" title="Active in the last minute" /> : <Radio size={13} color="var(--text-dim)" />}
                        <EntityLink kind="rid" id={sub.rid}>{sub.rid}</EntityLink>
                      </div>
                      {sub.radio_alias && <div className="sub-alias">{sub.radio_alias}</div>}
                    </div>
                    <span className={`sub-heard ${repeat ? 'repeat' : ''}`} title={`${sub.hit_count} times heard`}>
                      {sub.hit_count}× <span>heard</span>
                    </span>
                  </div>

                  <div className="sub-tg">
                    <span className="cat-tag">{cat.label}</span>
                    <EntityLink kind="tg" id={sub.latest_tgid} className="sub-tg-name">{sub.latest_tg_alias || `TG ${sub.latest_tgid}`}</EntityLink>
                    <span className="sub-tg-id">{sub.latest_tgid}</span>
                  </div>

                  <div className="sub-foot">
                    <span>{formatTs(sub.latest_ts)}</span>
                    <span>Site {sub.latest_site_str || '—'}</span>
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
