import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Clock,
  Network,
  Radio,
  History,
  Keyboard,
  RefreshCw,
  Star,
  TrendingUp,
  Users,
  Waves,
} from 'lucide-react';
import { AsciiBackdrop, BACKDROP_MODES, readBackdropMode, saveBackdropMode } from './components/AsciiBackdrop';
import type { BackdropMode } from './components/AsciiBackdrop';
import { EntityDrawer } from './components/EntityDrawer';
import { NowTalking } from './components/NowTalking';
import { ShortcutHelp } from './components/ShortcutHelp';
import { Toasts } from './components/Toasts';
import { FocusProvider, useFocus } from './context/focus';
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
import type { EventItem, StorageStats } from './types';
import { formatBytes, formatTs } from './utils/time';

type ActiveTab = 'monitor' | 'trends' | 'plots' | 'subscribers' | 'talkgroups' | 'topology' | 'anomalies';

// Tabs that only make sense against the live receiver.
const LIVE_ONLY: ActiveTab[] = ['plots', 'topology'];

const TAB_KEYS: ActiveTab[] = ['monitor', 'trends', 'plots', 'subscribers', 'talkgroups', 'topology', 'anomalies'];
const MODE_LABEL: Record<BackdropMode, string> = { off: 'Off', subtle: 'Subtle', normal: 'Normal', lively: 'Lively' };

export function App() {
  return (
    <FocusProvider>
      <AppInner />
    </FocusProvider>
  );
}

function AppInner() {
  const { matches, follow, setFollow, pins, entity, close } = useFocus();
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
  const [backdropMode, setBackdropMode] = useState<BackdropMode>(readBackdropMode);
  const [helpOpen, setHelpOpen] = useState(false);

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

  const cycleBackdrop = () => {
    setBackdropMode((m) => {
      const next = BACKDROP_MODES[(BACKDROP_MODES.indexOf(m) + 1) % BACKDROP_MODES.length];
      saveBackdropMode(next);
      return next;
    });
  };

  const goLive = () => setRange(null);
  const goHistory = () => {
    const now = Math.floor(Date.now() / 1000);
    if (!isHistory) setRange({ from: now - 86400, to: now });
  };

  /** Show a call in History with five minutes of context either side. */
  const jumpToCall = (ev: EventItem) => {
    setRange({ from: Math.floor(ev.ts - 300), to: Math.ceil(ev.ts + 300) });
    setActiveTab('monitor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Keyboard shortcuts (ignored while typing or with a modifier held).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      const n = Number(k);
      if (n >= 1 && n <= TAB_KEYS.length) {
        const target = TAB_KEYS[n - 1];
        if (!(isHistory && LIVE_ONLY.includes(target))) selectTab(target);
      } else if (k === 'l') goLive();
      else if (k === 'h') goHistory();
      else if (k === 'f') setFollow(!follow);
      else if (k === 'a') cycleBackdrop();
      else if (k === '?') setHelpOpen((o) => !o);
      else if (k === ' ') {
        e.preventDefault();
        window.dispatchEvent(new Event('op25:toggle-audio'));
      } else if (k === '/') {
        const box = Array.from(document.querySelectorAll<HTMLInputElement>('.input-search')).find((i) => i.offsetParent !== null);
        if (box) {
          e.preventDefault();
          box.focus();
        }
      } else if (k === 'escape' && entity) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
        className={`btn tab-btn ${tab === id ? 'btn-active' : ''} ${disabled ? 'is-disabled' : ''}`}
        disabled={disabled}
        title={disabled ? 'Live only: switch to Live to view' : undefined}
      >
        {icon}
        <span>{label}</span>
        {badge}
      </button>
    );
  };

  return (
    <div className="app-shell">
      {backdropMode !== 'off' && (
        <AsciiBackdrop
          frozen={isHistory}
          density={backdropMode}
          accepts={matches}
          state={{
            frequencies: telemetry.frequencies,
            channels: telemetry.channels,
            errorHz: telemetry.error_hz,
            connected: telemetry.connected && wsConnected,
          }}
        />
      )}
      {/* Top Telemetry Header */}
      <Header telemetry={telemetry} wsConnected={wsConnected} />

      {!isHistory && !(telemetry.connected && wsConnected) && (
        <div className="offline-banner" role="status">
          <strong>{wsConnected ? 'RECEIVER OFFLINE' : 'RECONNECTING'}</strong>
          <span>
            {telemetry.last_poll
              ? `Showing the last data received ${formatAgo(telemetry.last_poll)}.`
              : 'Waiting for the first update from OP25.'}
          </span>
        </div>
      )}

      {/* Who is on the air right now, on every tab */}
      {!isHistory && <NowTalking frequencies={telemetry.frequencies} channels={telemetry.channels} />}

      {/* Navigation Bar (sticky, horizontally scrollable strip on phones) */}
      <nav className="app-nav">
        <div className="segmented nav-mode" role="group" aria-label="Data mode">
          <button className={!isHistory ? 'on' : ''} onClick={goLive} aria-pressed={!isHistory} title="Live (L)">
            <Radio size={13} /> Live
          </button>
          <button className={isHistory ? 'on' : ''} onClick={goHistory} aria-pressed={isHistory} title="History (H)">
            <History size={13} /> History
          </button>
        </div>
        <div className="app-tabs">
          {tabButton('monitor', isHistory ? <Clock size={15} /> : <Activity size={15} />,
            isHistory ? 'History' : 'Monitor')}
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

        <div className="app-nav-actions">
        <button
          onClick={() => setFollow(!follow)}
          disabled={pins.size === 0}
          className={`btn app-refresh ${follow && pins.size > 0 ? 'btn-active' : ''}`}
          title={pins.size === 0 ? 'Pin talkgroups with the star, then follow them here (F)' : 'Show only pinned talkgroups (F)'}
          aria-pressed={follow}
          aria-label="Follow pinned talkgroups"
        >
          <Star size={14} fill={follow && pins.size > 0 ? 'currentColor' : 'none'} />
          {pins.size > 0 && <span>{pins.size}</span>}
        </button>

        <button
          onClick={cycleBackdrop}
          className={`btn app-refresh ${backdropMode !== 'off' ? 'btn-active' : ''}`}
          title={`Airwaves backdrop: ${MODE_LABEL[backdropMode]} (click or press A to change)`}
          aria-label={`Airwaves backdrop: ${MODE_LABEL[backdropMode]}`}
        >
          <Waves size={14} />
          <span className="lbl">Airwaves</span>
          <span className="mode-pips" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={BACKDROP_MODES.indexOf(backdropMode) >= n ? 'on' : ''} />
            ))}
          </span>
        </button>

        {!isHistory && (
          <button
            onClick={handleManualRefresh}
            className="btn app-refresh"
            title="Refresh database records"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? 'pulse-dot' : ''} />
          </button>
        )}
        </div>
      </nav>

      <TimeRangeBar range={range} onChange={setRange} historyStart={storage?.history_start_ts ?? null} />

      {/* Main Tab Views */}
      <main className={`app-main ${isHistory && history.loading ? 'is-refetching' : ''}`}>
        {tab === 'monitor' && (
          <div className="stack">
            {isHistory ? (
              <div className="glass-panel panel-pad">
                <div className="chart-head">
                  <span className="stat-label">
                    Activity · <span className="mono text-main">{timelineCalls.toLocaleString()}</span> calls
                  </span>
                  <span className="chart-hint">
                    {isMobile ? 'Drag to zoom · tap a bar to drill in' : 'Drag to zoom · click a bar to drill in · browser Back to zoom out'} · <span className="text-amber">▬</span> alerts
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
            <div className="split-grid">
              <div className="split-pane stack-tight">
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
              <CallTranscriptsFeed events={events} historical={isHistory} onJumpToCall={isHistory ? undefined : jumpToCall} />
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
          <div className="grow"><PlotsView telemetry={telemetry} /></div>
        )}

        {tab === 'subscribers' && (
          <div className="grow"><SubscribersTable affiliations={affiliations} /></div>
        )}

        {tab === 'talkgroups' && (
          <div className="grow"><TalkgroupDirectory talkgroups={talkgroups} /></div>
        )}

        {tab === 'topology' && (
          <div className="grow"><TopologyView telemetry={telemetry} /></div>
        )}

        {tab === 'anomalies' && (
          <div className="grow"><AnomaliesPanel anomalies={anomalies} /></div>
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="app-footer">
        <div className="app-footer-group">
          <span>Protocol: <strong>APCO-25 Phase 1 / 2</strong></span>
          <span>Target: <strong className="mono">{telemetry.target_url ? telemetry.target_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Connected'}</strong></span>
          <span className="footer-sep">|</span>
          <span>Inspired by <a href="https://github.com/colonelpanichacks/trunk-tap" target="_blank" rel="noreferrer">trunk-tap</a></span>
          <span className="footer-sep">|</span>
          <span>Engine: <a href="https://github.com/boatbod/op25" target="_blank" rel="noreferrer">boatbod/op25</a></span>
        </div>
        <div className="app-footer-group">
          {storage && (
            <span
              title={`Raw history is kept ${storage.retention_days > 0 ? `${storage.retention_days} days` : 'forever'}; call audio ${storage.audio_retention_hours} hours; daily trends indefinitely.`}
            >
              Storage: <strong className="mono">DB {formatBytes(storage.db_bytes)}</strong>
              {' · '}
              <strong className="mono">Audio {formatBytes(storage.audio_bytes)}</strong>
              {' · '}
              Retention <strong>{storage.retention_days > 0 ? `${storage.retention_days}d` : 'off'}</strong>
            </span>
          )}
          <span>WebSocket Stream: <strong className={wsConnected ? 'ws-ok' : 'ws-bad'}>{wsConnected ? 'Connected' : 'Reconnecting...'}</strong></span>
          <button type="button" className="footer-keys" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            <Keyboard size={12} /> Shortcuts
          </button>
          <span>op25-tap v0.3.0</span>
        </div>
      </footer>

      <Toasts anomalies={anomalies} enabled={!isHistory} onOpen={() => selectTab('anomalies')} />
      <EntityDrawer affiliations={affiliations} />
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default App;
