import React, { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { TimeRange, TrendLeader, TrendsResponse } from '../types';
import { addDays, dayToTs, formatDuration } from '../utils/time';
import { BarTimeline } from './BarTimeline';
import { Sparkline } from './Sparkline';

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

function StatTile({ label, value, sub, series, labels, format }: {
  label: string;
  value: string;
  sub: React.ReactNode;
  series: number[];
  labels: string[];
  format?: (v: number) => string;
}) {
  return (
    <div className="glass-panel stat-tile">
      <span className="stat-label">{label}</span>
      <div className="stat-row" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <span className="stat-value mono">{value}</span>
        <Sparkline values={series} labels={labels} width={110} height={30} format={format} />
      </div>
      <span style={{ fontSize: '0.72rem' }}>{sub}</span>
    </div>
  );
}

function LeaderTable({ title, rows, idKey, labels }: {
  title: string;
  rows: TrendLeader[];
  idKey: 'tgid' | 'rid';
  labels: string[];
}) {
  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="stat-label" style={{ margin: 0 }}>{title}</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tactical-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>{idKey === 'tgid' ? 'Talkgroup' : 'Radio'}</th>
              <th style={{ textAlign: 'right' }}>Calls</th>
              <th className="hide-sm" style={{ textAlign: 'right' }}>Airtime</th>
              <th>Calls per day</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>No activity in this period.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.system_id}-${r[idKey]}`}>
                <td className="mono" style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                <td>
                  <div style={{ color: 'var(--text-main)' }}>{r.alias || `${idKey === 'tgid' ? 'TG' : 'RID'} ${r[idKey]}`}</div>
                  {r.alias && <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r[idKey]}</div>}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.calls.toLocaleString()}</td>
                <td className="mono hide-sm" style={{ textAlign: 'right' }}>{formatDuration(r.airtime_ms)}</td>
                <td><Sparkline values={r.series.calls} labels={labels} width={120} height={24} /></td>
              </tr>
            ))}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TrendingUp size={16} color="var(--accent-cyan)" />
        <h2 className="stat-label" style={{ margin: 0, marginRight: 8 }}>Trends</h2>
        {PERIODS.map((p) => (
          <button key={p} className={`chip ${days === p ? 'on' : ''}`} aria-pressed={days === p} onClick={() => setDays(p)}>
            {p} days
          </button>
        ))}
      </div>

      {!data ? (
        <div className="glass-panel" style={{ padding: 24, color: 'var(--text-dim)' }}>{loading ? 'Loading trends…' : 'Trends unavailable.'}</div>
      ) : (
        <div className={loading ? 'is-refetching' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <StatTile
              label="Calls"
              value={sum(t!.calls).toLocaleString()}
              sub={<Delta now={sum(t!.calls)} prev={data.previous_period.calls} />}
              series={t!.calls}
              labels={labels}
            />
            <StatTile
              label="Airtime"
              value={formatDuration(sum(t!.airtime_ms))}
              sub={<Delta now={sum(t!.airtime_ms)} prev={data.previous_period.airtime_ms} />}
              series={t!.airtime_ms}
              labels={labels}
              format={formatDuration}
            />
            <StatTile
              label="Active radios / day"
              value={activeDays ? Math.round(sum(t!.unique_rids) / activeDays).toLocaleString() : '0'}
              sub={<span className="delta-flat">peak {Math.max(0, ...t!.unique_rids).toLocaleString()}</span>}
              series={t!.unique_rids}
              labels={labels}
            />
            <StatTile
              label="Alerts"
              value={sum(t!.anomalies).toLocaleString()}
              sub={<Delta now={sum(t!.anomalies)} prev={data.previous_period.anomalies} />}
              series={t!.anomalies}
              labels={labels}
            />
          </div>

          <div className="glass-panel" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 32, gap: 8, flexWrap: 'wrap' }}>
              <h2 className="stat-label" style={{ margin: 0 }}>Calls per day</h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>Tap or click a day (or drag across several) to open it in History</span>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
            <LeaderTable title="Top talkgroups" rows={data.top_talkgroups} idKey="tgid" labels={labels} />
            <LeaderTable title="Top radios" rows={data.top_radios} idKey="rid" labels={labels} />
          </div>
        </div>
      )}
    </div>
  );
};
