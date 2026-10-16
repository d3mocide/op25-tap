import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { TimeRange, TrendLeader, TrendsResponse } from '../types';
import { addDays, dayToTs, formatDuration } from '../utils/time';
import { BarTimeline } from './BarTimeline';
import { Sparkline } from './Sparkline';
import { getTalkgroupCategory } from '../utils/colors';
import '../styles/trends.css';

interface TrendsDashboardProps {
  /** Jump into history mode for a range (a day clicked on the chart). */
  onOpenRange: (range: TimeRange) => void;
}

const PERIODS = [7, 30, 90];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const dayLabel = (day: string) =>
  new Date(dayToTs(day) * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="delta-flat">no prior data</span>;
  const pct = ((now - prev) / prev) * 100;
  const arrow = Math.abs(pct) < 0.5 ? '→' : pct > 0 ? '↑' : '↓';
  return (
    <span className="delta-flat">
      {arrow} {Math.abs(pct).toFixed(0)}% vs previous period
    </span>
  );
}

function StatTile({ label, value, sub, series, labels, format, color }: {
  label: string;
  color?: string;
  value: string;
  sub: React.ReactNode;
  series: number[];
  labels: string[];
  format?: (v: number) => string;
}) {
  return (
    <div className="glass-panel stat-tile" style={color ? ({ '--tile': color } as React.CSSProperties) : undefined}>
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-value">{value}</span>
        <Sparkline values={series} labels={labels} width={110} height={30} format={format} color={color} />
      </div>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function LeaderTable({ title, rows, idKey, labels }: {
  title: string;
  rows: TrendLeader[];
  idKey: 'tgid' | 'rid';
  labels: string[];
}) {
  const maxCalls = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <div className="glass-panel panel-clip">
      <div className="panel-header">
        <h2 className="stat-label">{title}</h2>
      </div>
      <div className="table-scroll">
        <table className="tactical-table">
          <thead>
            <tr>
              <th className="rank-col">#</th>
              <th>{idKey === 'tgid' ? 'Talkgroup' : 'Radio'}</th>
              <th className="col-right">Calls</th>
              <th className="hide-sm col-right">Airtime</th>
              <th>Calls per day</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="empty-note">No activity in this period.</td></tr>
            )}
            {rows.map((r, i) => {
              const cat = idKey === 'tgid' ? getTalkgroupCategory(r.alias) : null;
              return (
              <tr key={`${r.system_id}-${r[idKey]}`}>
                <td className="mono-dim">{i + 1}</td>
                <td>
                  <div className="leader-name">
                    {cat && <span className="cat-tag" style={{ '--cat': cat.color } as React.CSSProperties}>{cat.label}</span>}
                    <span>{r.alias || `${idKey === 'tgid' ? 'TG' : 'RID'} ${r[idKey]}`}</span>
                  </div>
                  {r.alias && <div className="mono-dim leader-id">{r[idKey]}</div>}
                </td>
                <td className="cell-mono col-right leader-calls" style={{ '--pct': `${Math.round((r.calls / maxCalls) * 100)}%` } as React.CSSProperties}>
                  <span>{r.calls.toLocaleString()}</span>
                </td>
                <td className="cell-mono hide-sm col-right">{formatDuration(r.airtime_ms)}</td>
                <td><Sparkline values={r.series.calls} labels={labels} width={120} height={24} /></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Long-range trends from the daily rollups (these outlive raw event retention). */
export const TrendsDashboard: React.FC<TrendsDashboardProps> = ({ onOpenRange }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      fetch(`/api/trends?days=${days}&top=10`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          if (d) setData(d);
          setLoading(false);
        })
        .catch(() => !cancelled && setLoading(false));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [days]);

  const labels = data ? data.days.map(dayLabel) : [];
  const t = data?.totals;
  const activeDays = t ? t.calls.filter((c) => c > 0).length : 0;

  return (
    <div className="stack">
      <div className="row-wrap">
        <TrendingUp size={16} color="var(--accent-cyan)" />
        <h2 className="stat-label trends-title">Trends</h2>
        {PERIODS.map((p) => (
          <button key={p} className={`chip ${days === p ? 'on' : ''}`} aria-pressed={days === p} onClick={() => setDays(p)}>
            {p} days
          </button>
        ))}
      </div>

      {!data ? (
        loading ? (
        <div className="stat-grid" aria-busy="true" aria-label="Loading trends">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="glass-panel stat-tile skeleton skel-tile" />)}
        </div>
      ) : (
        <div className="glass-panel empty-note">Trends unavailable. The receiver may be offline; try again shortly.</div>
      )
      ) : (
        <div className={`stack ${loading ? 'is-refetching' : ''}`}>
          <div className="stat-grid">
            <StatTile
              label="Calls"
              value={sum(t!.calls).toLocaleString()}
              sub={<Delta now={sum(t!.calls)} prev={data.previous_period.calls} />}
              series={t!.calls}
              labels={labels}
              color="var(--accent-cyan)"
            />
            <StatTile
              label="Airtime"
              value={formatDuration(sum(t!.airtime_ms))}
              sub={<Delta now={sum(t!.airtime_ms)} prev={data.previous_period.airtime_ms} />}
              series={t!.airtime_ms}
              labels={labels}
              format={formatDuration}
              color="var(--accent-amber)"
            />
            <StatTile
              label="Active radios / day"
              value={activeDays ? Math.round(sum(t!.unique_rids) / activeDays).toLocaleString() : '0'}
              sub={<span className="delta-flat">peak {Math.max(0, ...t!.unique_rids).toLocaleString()}</span>}
              series={t!.unique_rids}
              labels={labels}
              color="var(--accent-emerald)"
            />
            <StatTile
              label="Alerts"
              value={sum(t!.anomalies).toLocaleString()}
              sub={<Delta now={sum(t!.anomalies)} prev={data.previous_period.anomalies} />}
              series={t!.anomalies}
              labels={labels}
              color="var(--accent-fire)"
            />
          </div>

          <div className="glass-panel panel-pad">
            <div className="chart-head">
              <h2 className="stat-label">Calls per day</h2>
              <span className="chart-hint">Tap or click a day (or drag across several) to open it in History</span>
            </div>
            <BarTimeline
              height={140}
              buckets={data.days.map((d, i) => ({
                start: dayToTs(d),
                end: addDays(dayToTs(d), 1),
                calls: t!.calls[i],
                airtime_ms: t!.airtime_ms[i],
                anomalies: t!.anomalies[i],
              }))}
              formatTick={(ts) => new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              formatBucket={(b) => dayLabel(new Date(b.start * 1000).toLocaleDateString('en-CA'))}
              onSelect={(from, to) => onOpenRange({ from, to })}
              selectHint="Click to open this day"
            />
          </div>

          <div className="leader-grid">
            <LeaderTable title="Top talkgroups" rows={data.top_talkgroups} idKey="tgid" labels={labels} />
            <LeaderTable title="Top radios" rows={data.top_radios} idKey="rid" labels={labels} />
          </div>
        </div>
      )}
    </div>
  );
};
