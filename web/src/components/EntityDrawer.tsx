import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Users, X } from 'lucide-react';
import { useFocus } from '../context/focus';
import type { Affiliation, EventItem, Radio as RadioRow, Talkgroup } from '../types';
import { getTalkgroupCategory } from '../utils/colors';
import { formatDuration, formatTs } from '../utils/time';
import { EntityLink, PinButton } from './EntityLink';
import { Sparkline } from './Sparkline';
import '../styles/drawer.css';

interface Props {
  affiliations: Affiliation[];
}

interface Loaded {
  /** Epoch seconds when the fetch completed; anchors the 24-hour chart. */
  at: number;
  events: EventItem[];
  stats: Talkgroup | RadioRow | null;
}

const HOURS = 24;

/** Calls per hour over the last 24 hours, oldest first. */
function hourlyCounts(events: EventItem[], nowSec: number): { values: number[]; labels: string[] } {
  const values = new Array(HOURS).fill(0);
  const labels: string[] = [];
  for (let i = 0; i < HOURS; i += 1) {
    const start = nowSec - (HOURS - i) * 3600;
    labels.push(new Date(start * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  }
  for (const ev of events) {
    const ago = Math.floor((nowSec - ev.ts) / 3600);
    if (ago >= 0 && ago < HOURS) values[HOURS - 1 - ago] += 1;
  }
  return { values, labels };
}

/** Right-hand glass drawer with the history of one talkgroup or radio. */
export const EntityDrawer: React.FC<Props> = ({ affiliations }) => {
  const { entity, close } = useFocus();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    const q = entity.kind === 'tg' ? `tgid=${entity.id}` : `rid=${entity.id}`;
    const since = Math.floor(Date.now() / 1000) - HOURS * 3600;
    const statsUrl = entity.kind === 'tg' ? `/api/talkgroups?search=${entity.id}&limit=20` : `/api/radios?search=${entity.id}&limit=20`;
    Promise.all([
      fetch(`/api/events?${q}&limit=400&since=${since}`).then((r) => (r.ok ? r.json() : [])),
      fetch(statsUrl).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([events, rows]: [EventItem[], Array<Talkgroup | RadioRow>]) => {
        if (cancelled) return;
        const stats = rows.find((r) => ('tgid' in r ? r.tgid : r.rid) === entity.id) ?? null;
        setData({ events, stats, at: Math.floor(Date.now() / 1000) });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [entity]);

  useEffect(() => {
    if (!entity) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entity, close]);

  const hourly = useMemo(() => (data ? hourlyCounts(data.events, data.at) : null), [data]);

  if (!entity) return null;

  const isTg = entity.kind === 'tg';
  const stats = data?.stats ?? null;
  const alias = stats?.alias ?? (data?.events[0] ? (isTg ? data.events[0].tg_alias : data.events[0].from_alias) : null);
  const cat = isTg ? getTalkgroupCategory(alias, (stats as Talkgroup | null)?.tg_group, (stats as Talkgroup | null)?.tg_tag) : null;

  // Who is on this talkgroup / which talkgroups this radio affiliated to, from the current roster.
  const related = new Map<number, { label: string; ts: number }>();
  for (const a of affiliations) {
    if (isTg && a.tgid === entity.id) {
      const prev = related.get(a.rid);
      if (!prev || a.ts > prev.ts) related.set(a.rid, { label: a.radio_alias || String(a.rid), ts: a.ts });
    } else if (!isTg && a.rid === entity.id) {
      const prev = related.get(a.tgid);
      if (!prev || a.ts > prev.ts) related.set(a.tgid, { label: a.tg_alias || `TG ${a.tgid}`, ts: a.ts });
    }
  }
  const relatedList = [...related.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, 12);

  return (
    <>
      <div className="drawer-scrim" onClick={close} />
      <aside className="glass-panel drawer" role="dialog" aria-label={isTg ? `Talkgroup ${entity.id}` : `Radio ${entity.id}`} style={cat ? ({ '--cat': cat.color } as React.CSSProperties) : undefined}>
        <header className="drawer-head">
          <div className="grow">
            <div className="drawer-kicker">
              {isTg ? <Radio size={13} /> : <Users size={13} />}
              {isTg ? 'TALKGROUP' : 'RADIO'}
              {cat && <span className="cat-tag">{cat.label}</span>}
            </div>
            <div className="drawer-id">{entity.id}</div>
            {alias && <div className="drawer-alias">{alias}</div>}
          </div>
          <div className="row">
            {isTg && <PinButton tgid={entity.id} always />}
            <button type="button" className="btn drawer-close" onClick={close} aria-label="Close details">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="drawer-body">
          {failed ? (
            <div className="empty-note">Couldn't load details.</div>
          ) : !data ? (
            <div className="skeleton-stack">
              <div className="skeleton h48" />
              <div className="skeleton h48" />
              <div className="skeleton h120" />
            </div>
          ) : (
            <>
              <div className="drawer-stats">
                <div><span>Calls</span><strong>{stats ? stats.call_count.toLocaleString() : data.events.length}</strong></div>
                <div><span>Airtime</span><strong>{stats ? formatDuration(stats.total_ms) : '—'}</strong></div>
                <div><span>First seen</span><strong>{stats?.first_seen ? formatTs(stats.first_seen, false) : '—'}</strong></div>
                <div><span>Last seen</span><strong>{stats?.last_seen ? formatTs(stats.last_seen, false) : '—'}</strong></div>
              </div>

              {hourly && (
                <section>
                  <h3 className="drawer-h">Last 24 hours <span>{data.events.length} calls</span></h3>
                  <div className="drawer-spark">
                    <Sparkline values={hourly.values} labels={hourly.labels} width={340} height={44} color={cat?.color ?? 'var(--accent-cyan)'} />
                  </div>
                </section>
              )}

              {relatedList.length > 0 && (
                <section>
                  <h3 className="drawer-h">{isTg ? 'Radios affiliated' : 'Talkgroups affiliated'}</h3>
                  <div className="drawer-chips">
                    {relatedList.map(([id, r]) => (
                      <EntityLink key={id} kind={isTg ? 'rid' : 'tg'} id={id} className="drawer-chip">{r.label}</EntityLink>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="drawer-h">Recent calls</h3>
                {data.events.length === 0 ? (
                  <div className="empty-note">No calls in the last 24 hours.</div>
                ) : (
                  <ul className="drawer-calls">
                    {data.events.slice(0, 40).map((ev) => (
                      <li key={ev.id}>
                        <div className="drawer-call-top">
                          <span className="cell-time">{formatTs(ev.ts)}</span>
                          {isTg ? (
                            ev.from_rid ? <EntityLink kind="rid" id={ev.from_rid} className="mono-cyan">{ev.from_rid}</EntityLink> : <span className="mono-dim">—</span>
                          ) : (
                            <EntityLink kind="tg" id={ev.to_tgid} className="drawer-tg">{ev.tg_tag ?? `TG ${ev.to_tgid}`}</EntityLink>
                          )}
                          <span className="mono-dim drawer-dur">{ev.duration_ms > 0 ? `${(ev.duration_ms / 1000).toFixed(1)}s` : '< 1s'}</span>
                        </div>
                        {ev.transcript && <div className="drawer-transcript">&ldquo;{ev.transcript}&rdquo;</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
