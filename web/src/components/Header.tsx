import React, { useEffect } from 'react';
import { Headphones, Volume2, VolumeX } from 'lucide-react';
import type { TelemetryStatus } from '../types';
import { useOp25Audio } from '../hooks/useOp25Audio';
import '../styles/header.css';

interface HeaderProps {
  telemetry: TelemetryStatus;
  wsConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({ telemetry, wsConnected }) => {
  const { isPlaying, isMuted, volume, togglePlay, toggleMute, setVolume } = useOp25Audio();

  useEffect(() => {
    window.addEventListener('op25:toggle-audio', togglePlay);
    return () => window.removeEventListener('op25:toggle-audio', togglePlay);
  }, [togglePlay]);

  const sys = telemetry.system;
  const wacnHex = sys?.wacn ? `0x${sys.wacn.toString(16).toUpperCase()}` : '—';
  const sysidHex = sys?.sysid ? `0x${sys.sysid.toString(16).toUpperCase()}` : '—';
  const nacHex = sys?.nac ? `0x${sys.nac.toString(16).toUpperCase()}` : '—';
  const ccMHz = sys?.rxchan ? (sys.rxchan / 1_000_000).toFixed(6) : '—';
  const volPercent = isMuted ? 0 : Math.round(volume * 100);

  const online = telemetry.connected && wsConnected;
  const err = telemetry.error_hz;
  const errClass = err !== null && Math.abs(err) < 100 ? 'ok' : 'bad';

  return (
    <header className="glass-panel app-header">
      <div className="hdr-row">

        {/* Brand & Connection State */}
        <div className="hdr-brand">
          <img className="hdr-logo" src="/favicon.svg" width={38} height={38} alt="" />
          <div className="grow">
            <div className="row">
              <h1 className="hdr-name">
                OP25<span>-TAP</span>
              </h1>
              <span className={`badge ${online ? 'badge-emerald' : 'badge-rose'}`}>
                <span className={`pulse-dot ${online ? '' : 'inactive'}`} />
                <span className="hdr-status-text">{online ? 'RECEIVER LIVE' : 'OFFLINE'}</span>
              </span>
            </div>
            <div className="hdr-subtitle">
              {sys?.system_name || 'Connecting to receiver...'}
              {telemetry.site && <span className="hdr-subtitle-site"> · <span className="hl">Site {telemetry.site}</span></span>}
              {' '}{sys?.callsign && <span className="hl strong">// {sys.callsign}</span>}
            </div>
          </div>
        </div>

        {/* Telemetry Metrics Bar (fixed min widths so nothing shifts as values change) */}
        <div className="hdr-metrics">
          <div className="hdr-metric hdr-metric-system w135">
            <div className="hdr-label">System / Site</div>
            <div className="hdr-value white">
              {sys?.system_name || '—'} <span className="sep">|</span> <span className="hl">Site {telemetry.site || '—'}</span>
            </div>
          </div>

          <div className="hdr-metric w110">
            <div className="hdr-label">WACN / SYSID</div>
            <div className="hdr-value cyan">
              {wacnHex} <span className="sep">:</span> {sysidHex}
            </div>
          </div>

          <div className="hdr-metric w150">
            <div className="hdr-label">Control Frequency</div>
            <div className="hdr-value cyan bold">
              {ccMHz} <span className="hdr-aside">NAC {nacHex}</span>
            </div>
          </div>

          <div className="hdr-metric w85">
            <div className="hdr-label">Tuning Error</div>
            <div className={`hdr-value ${errClass}`}>{err !== null ? `${err} Hz` : '0 Hz'}</div>
            <div className="err-meter" role="img" aria-label="Tuning error magnitude">
              <span style={{ width: `${Math.min(Math.abs(err ?? 0) / 600, 1) * 100}%` }} />
            </div>
          </div>

          <div className="hdr-metric w95">
            <div className="hdr-label">Subscribers</div>
            <div className="hdr-value bold">
              {telemetry.wuid_count} <span className="hdr-aside">affiliated</span>
            </div>
          </div>
        </div>

        {/* Tactical Audio Station */}
        <div className={`audio-station hdr-audio ${isPlaying ? 'active' : ''}`}>
          <button
            type="button"
            onClick={togglePlay}
            className={`btn hdr-audio-btn ${isPlaying ? 'btn-primary' : ''}`}
            title="OP25 Port 9000 Zero-Latency PCM WebSocket Audio"
          >
            <Headphones size={14} color={isPlaying ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
            <span className="hdr-audio-label">AUDIO</span>
          </button>

          <div className="hdr-audio-divider" />

          <button
            type="button"
            onClick={toggleMute}
            className={`btn hdr-mute ${isMuted ? 'muted' : isPlaying ? 'playing' : ''}`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          <div className="hdr-volume">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="audio-slider"
              title={`Volume: ${volPercent}%`}
            />
            <span className={`mono hdr-vol-read ${isMuted ? 'muted' : ''}`}>{isMuted ? '0%' : `${volPercent}%`}</span>
          </div>
        </div>

      </div>
    </header>
  );
};
