import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Network,
  Radio,
  RefreshCw,
  Users,
} from 'lucide-react';
import { AnomaliesPanel } from './components/AnomaliesPanel';
import { CallTranscriptsFeed } from './components/CallTranscriptsFeed';
import { Header } from './components/Header';
import { LiveEventFeed } from './components/LiveEventFeed';
import { PlotsView } from './components/PlotsView';
import { SubscribersTable } from './components/SubscribersTable';
import { TalkgroupDirectory } from './components/TalkgroupDirectory';
import { TopologyView } from './components/TopologyView';
import { VoiceGrid } from './components/VoiceGrid';
import { useLiveTelemetry } from './hooks/useLiveTelemetry';

type ActiveTab = 'monitor' | 'plots' | 'subscribers' | 'talkgroups' | 'topology' | 'anomalies';

export function App() {
  const {
    telemetry,
    events,
    talkgroups,
    affiliations,
    anomalies,
    wsConnected,
    refreshData,
  } = useLiveTelemetry();

  const [activeTab, setActiveTab] = useState<ActiveTab>('monitor');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshData();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '16px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Telemetry Header */}
      <Header telemetry={telemetry} wsConnected={wsConnected} />

      {/* Navigation Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '10px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('monitor')}
            className={`btn ${activeTab === 'monitor' ? 'btn-active' : ''}`}
          >
            <Activity size={15} />
            <span>Live Monitor</span>
          </button>

          <button
            onClick={() => setActiveTab('plots')}
            className={`btn ${activeTab === 'plots' ? 'btn-active' : ''}`}
          >
            <BarChart2 size={15} />
            <span>RF Scopes</span>
            <span className="tab-badge">{telemetry.plot_files?.length || 0}</span>
          </button>

          <button
            onClick={() => setActiveTab('subscribers')}
            className={`btn ${activeTab === 'subscribers' ? 'btn-active' : ''}`}
          >
            <Users size={15} />
            <span>Subscribers</span>
            <span className="tab-badge">{affiliations.length}</span>
          </button>

          <button
            onClick={() => setActiveTab('talkgroups')}
            className={`btn ${activeTab === 'talkgroups' ? 'btn-active' : ''}`}
          >
            <Radio size={15} />
            <span>Talkgroups</span>
            <span className="tab-badge">{talkgroups.length}</span>
          </button>

          <button
            onClick={() => setActiveTab('topology')}
            className={`btn ${activeTab === 'topology' ? 'btn-active' : ''}`}
          >
            <Network size={15} />
            <span>Topology</span>
            <span className="tab-badge">{telemetry.adjacent_sites?.length || 0}</span>
          </button>

          <button
            onClick={() => setActiveTab('anomalies')}
            className={`btn ${activeTab === 'anomalies' ? 'btn-active' : ''}`}
          >
            <AlertTriangle size={15} />
            <span>Alerts</span>
            <span className={`tab-badge ${anomalies.length > 0 ? 'tab-badge-rose' : ''}`}>
              {anomalies.length}
            </span>
          </button>
        </div>

        <div>
          <button
            onClick={handleManualRefresh}
            className="btn"
            title="Refresh database records"
          >
            <RefreshCw size={14} className={isRefreshing ? 'pulse-dot' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'monitor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Monitored Voice Frequencies Grid */}
            <VoiceGrid frequencies={telemetry.frequencies} />

            {/* Split View: Live Event Feed & Active Subscribers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '16px' }}>
              <div style={{ minHeight: '420px' }}>
                <LiveEventFeed events={events} />
              </div>
              <div style={{ minHeight: '420px' }}>
                <SubscribersTable affiliations={affiliations} />
              </div>
            </div>

            {/* Dedicated Full-Width Audio Intercepts & Transcriptions Feed */}
            <div>
              <CallTranscriptsFeed events={events} />
            </div>
          </div>
        )}

        {activeTab === 'plots' && (
          <div style={{ flex: 1 }}>
            <PlotsView telemetry={telemetry} />
          </div>
        )}

        {activeTab === 'subscribers' && (
          <div style={{ flex: 1 }}>
            <SubscribersTable affiliations={affiliations} />
          </div>
        )}

        {activeTab === 'talkgroups' && (
          <div style={{ flex: 1 }}>
            <TalkgroupDirectory talkgroups={talkgroups} />
          </div>
        )}

        {activeTab === 'topology' && (
          <div style={{ flex: 1 }}>
            <TopologyView telemetry={telemetry} />
          </div>
        )}

        {activeTab === 'anomalies' && (
          <div style={{ flex: 1 }}>
            <AnomaliesPanel anomalies={anomalies} />
          </div>
        )}
      </main>

      {/* Footer Status Bar */}
      <footer style={{
        marginTop: '20px',
        paddingTop: '12px',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.74rem',
        color: 'var(--text-dim)',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Protocol: <strong style={{ color: 'var(--text-muted)' }}>APCO-25 Phase 1 / 2</strong></span>
          <span>Target: <strong className="mono" style={{ color: 'var(--text-muted)' }}>{telemetry.target_url ? telemetry.target_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Connected'}</strong></span>
          <span style={{ color: 'var(--border-subtle)' }}>|</span>
          <span>Inspired by <a href="https://github.com/colonelpanichacks/trunk-tap" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>trunk-tap</a></span>
          <span style={{ color: 'var(--border-subtle)' }}>|</span>
          <span>Engine: <a href="https://github.com/boatbod/op25" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>boatbod/op25</a></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>WebSocket Stream: <strong style={{ color: wsConnected ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>{wsConnected ? 'Connected' : 'Reconnecting...'}</strong></span>
          <span>op25-tap v0.2.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
