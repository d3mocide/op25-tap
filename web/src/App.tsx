import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Clock,
  Network,
  Radio,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { AnomaliesPanel } from './components/AnomaliesPanel';
import { BarTimeline } from './components/BarTimeline';
import { CallTranscriptsFeed } from './components/CallTranscriptsFeed';
import { Header } from './components/Header';
import { LiveEventFeed } from './components/LiveEventFeed';
import { PlotsView } from './components/PlotsView';
import { SubscribersTable } from './components/SubscribersTable';
import { TalkgroupDirectory } from './components/TalkgroupDirectory';
import { TimeRangeBar } from './components/TimeRangeBar';
import { TopologyView } from './components/TopologyView';
import { TrendsDashboard } from './components/TrendsDashboard';
import { VoiceGrid } from './components/VoiceGrid';
import { useHistoryData } from './hooks/useHistoryData';
import { useLiveTelemetry } from './hooks/useLiveTelemetry';
import { useIsMobile } from './hooks/useIsMobile';
import { useTimeRange } from './hooks/useTimeRange';
import type { StorageStats } from './types';
import { formatBytes, formatTs } from './utils/time';

type ActiveTab = 'monitor' | 'trends' | 'plots' | 'subscribers' | 'talkgroups' | 'topology' | 'anomalies';

// Tabs that only make sense against the live receiver.
const LIVE_ONLY: ActiveTab[] = ['plots', 'topology'];

export function App() {
  const live = useLiveTelemetry();
  const { telemetry, wsConnected, refreshData } = live;
  const { range, setRange } = useTimeRange();
  const history = useHistoryData(range);
  const isHistory = range !== null;
  const isMobile = useIsMobile();

  // Panels read from whichever source the mode selects.
  const events = isHistory ? history.events : live.events;
  const talkgroups = isHistory ? history.talkgroups : live.talkgroups;
  const affiliations = isHistory ? history.affiliations : live.affiliations;
  const anomalies = isHistory ? history.anomalies : live.anomalies;

  const [activeTab, setActiveTab] = useState<ActiveTab>('monitor');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [storage, setStorage] = useState<StorageStats | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/storage')
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setStorage(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const tab = isHistory && LIVE_ONLY.includes(activeTab) ? 'monitor' : activeTab;
  const timelineCalls = history.timeline?.buckets.reduce((n, b) => n + b.calls, 0) ?? 0;

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshData();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const selectTab = (id: ActiveTab) => {
    setActiveTab(id);
    // On phones the tab strip is sticky; bring the new view's top into sight.
    if (isMobile) window.scrollTo({ top: 0 });
  };

  const tabButton = (id: ActiveTab, icon: React.ReactNode, label: string, badge?: React.ReactNode) => {
    const disabled = isHistory && LIVE_ONLY.includes(id);
    return (
      <button
        onClick={(e) => {
          selectTab(id);
          e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
        className={`btn tab-btn ${tab === id ? 'btn-active' : ''}`}
        disabled={disabled}
        title={disabled ? 'Live only: switch to Live to view' : undefined}
        style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        {icon}
        <span>{label}</span>
        {badge}
      </button>
    );
  };

  return (
    <div className="app-shell">
      {/* Top Telemetry Header */}
      <Header telemetry={telemetry} wsConnected={wsConnected} />

      {/* Live / History + range: scopes every panel below */}
      <TimeRangeBar range={range} onChange={setRange} historyStart={storage?.history_start_ts ?? null} />

      {/* Navigation Bar (sticky, horizontally scrollable strip on phones) */}
      <nav className="app-nav">
        <div className="app-tabs">
          {tabButton('monitor', isHistory ? <Clock size={15} /> : <Activity size={15} />,
            isHistory ? (isMobile ? 'History' : 'Call History') : (isMobile ? 'Monitor' : 'Live Monitor'))}
          {tabButton('trends', <TrendingUp size={15} />, 'Trends')}
          {tabButton('plots', <BarChart2 size={15} />, isMobile ? 'Scopes' : 'RF Scopes',
            <span className="tab-badge">{telemetry.plot_files?.length || 0}</span>)}
          {tabButton('subscribers', <Users size={15} />, 'Subscribers',
            <span className="tab-badge">{affiliations.length}</span>)}
          {tabButton('talkgroups', <Radio size={15} />, 'Talkgroups',
            <span className="tab-badge">{talkgroups.length}</span>)}
          {tabButton('topology', <Network size={15} />, 'Topology',
            <span className="tab-badge">{telemetry.adjacent_sites?.length || 0}</span>)}
          {tabButton('anomalies', <AlertTriangle size={15} />, 'Alerts',
            <span className={`tab-badge ${anomalies.length > 0 ? 'tab-badge-rose' : ''}`}>{anomalies.length}</span>)}
        </div>

        {!isHistory && (
          <button
            onClick={handleManualRefresh}
            className="btn app-refresh"
            title="Refresh database records"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? 'pulse-dot' : ''} />
            {!isMobile && <span>Refresh</span>}
          </button>
        )}
      </nav>

      {/* Main Tab Views */}
      <main
        className={isHistory && history.loading ? 'is-refetching' : ''}
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        {tab === 'monitor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {isHistory ? (
              <div className="glass-panel" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: isMobile ? 28 : 36 }}>
                  <span className="stat-label">
                    Activity · <span className="mono" style={{ color: 'var(--text-main)' }}>{timelineCalls.toLocaleString()}</span> calls
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    {isMobile ? 'Drag to zoom · tap a bar to drill in' : 'Drag to zoom · click a bar to drill in · browser Back to zoom out'} · <span style={{ color: 'var(--accent-amber)' }}>▬</span> alerts
                  </span>
                </div>
                {history.timeline && (
                  <BarTimeline
                    buckets={history.timeline.buckets.map((b) => ({ ...b, start: b.t, end: b.t + history.timeline!.bucket_sec }))}
                    formatTick={(ts) => formatTs(ts, false)}
                    formatBucket={(b) => `${formatTs(b.start, false)} – ${formatTs(b.end, false)}`}
                    onSelect={(from, to) => setRange({ from, to })}
                  />
                )}
              </div>
            ) : (
              /* Monitored Voice Frequencies Grid */
              <VoiceGrid frequencies={telemetry.frequencies} />
            )}

            {/* Split View: Event Feed & Subscribers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(480px, 100%), 1fr))', gap: '16px' }}>
              <div className="split-pane" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <LiveEventFeed events={events} historical={isHistory} />
                {isHistory && history.hasMore && (
                  <button className="btn" onClick={history.loadMore} disabled={history.loading}>
                    Load older calls ({events.length.toLocaleString()} of {timelineCalls.toLocaleString()} shown)
                  </button>
                )}
              </div>
              <div className="split-pane">
                <SubscribersTable affiliations={affiliations} />
              </div>
            </div>

            {/* Dedicated Full-Width Audio Intercepts & Transcriptions Feed */}
            <div>
              <CallTranscriptsFeed events={events} historical={isHistory} />
            </div>
          </div>
        )}

        {tab === 'trends' && (
          <TrendsDashboard
            onOpenRange={(r) => {
              setRange(r);
              selectTab('monitor');
            }}
          />
        )}

        {tab === 'plots' && (
          <div style={{ flex: 1 }}>
            <PlotsView telemetry={telemetry} />
          </div>
        )}

        {tab === 'subscribers' && (
          <div style={{ flex: 1 }}>
            <SubscribersTable affiliations={affiliations} />
          </div>
        )}

        {tab === 'talkgroups' && (
          <div style={{ flex: 1 }}>
            <TalkgroupDirectory talkgroups={talkgroups} />
          </div>
        )}

        {tab === 'topology' && (
          <div style={{ flex: 1 }}>
            <TopologyView telemetry={telemetry} />
          </div>
        )}

        {tab === 'anomalies' && (
          <div style={{ flex: 1 }}>
            <AnomaliesPanel anomalies={anomalies} />
          </div>
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="app-footer">
        <div className="app-footer-group">
          <span>Protocol: <strong style={{ color: 'var(--text-muted)' }}>APCO-25 Phase 1 / 2</strong></span>
          <span>Target: <strong className="mono" style={{ color: 'var(--text-muted)' }}>{telemetry.target_url ? telemetry.target_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Connected'}</strong></span>
          <span className="footer-sep">|</span>
          <span>Inspired by <a href="https://github.com/colonelpanichacks/trunk-tap" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>trunk-tap</a></span>
          <span className="footer-sep">|</span>
          <span>Engine: <a href="https://github.com/boatbod/op25" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>boatbod/op25</a></span>
        </div>
        <div className="app-footer-group">
          {storage && (
            <span
              title={`Raw history is kept ${storage.retention_days > 0 ? `${storage.retention_days} days` : 'forever'}; call audio ${storage.audio_retention_hours} hours; daily trends indefinitely.`}
            >
              Storage: <strong className="mono" style={{ color: 'var(--text-muted)' }}>DB {formatBytes(storage.db_bytes)}</strong>
              {' · '}
              <strong className="mono" style={{ color: 'var(--text-muted)' }}>Audio {formatBytes(storage.audio_bytes)}</strong>
              {' · '}
              Retention <strong style={{ color: 'var(--text-muted)' }}>{storage.retention_days > 0 ? `${storage.retention_days}d` : 'off'}</strong>
            </span>
          )}
          <span>WebSocket Stream: <strong style={{ color: wsConnected ? 'var(--accent-emerald)' : 'var(--accent-fire)' }}>{wsConnected ? 'Connected' : 'Reconnecting...'}</strong></span>
          <span>op25-tap v0.3.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
