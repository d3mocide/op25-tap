import React from 'react';
import { Headphones, Radio, Volume2, VolumeX } from 'lucide-react';
import type { TelemetryStatus } from '../types';
import { useOp25Audio } from '../hooks/useOp25Audio';

interface HeaderProps {
  telemetry: TelemetryStatus;
  wsConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({ telemetry, wsConnected }) => {
  const { isPlaying, isMuted, volume, togglePlay, toggleMute, setVolume } = useOp25Audio();

  const sys = telemetry.system;
  const wacnHex = sys?.wacn ? `0x${sys.wacn.toString(16).toUpperCase()}` : '—';
  const sysidHex = sys?.sysid ? `0x${sys.sysid.toString(16).toUpperCase()}` : '—';
  const nacHex = sys?.nac ? `0x${sys.nac.toString(16).toUpperCase()}` : '—';
  const ccMHz = sys?.rxchan ? (sys.rxchan / 1_000_000).toFixed(6) : '—';
  const volPercent = isMuted ? 0 : Math.round(volume * 100);

  return (
    <header className="glass-panel" style={{ padding: '10px 18px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        
        {/* Brand & Connection State */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '220px', flexShrink: 0 }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '4px',
            background: 'linear-gradient(180deg, #282a32 0%, #17181f 100%)',
            border: '1px solid #3c3e4a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-cyan)'
          }}>
            <Radio size={19} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                OP25<span style={{ color: 'var(--accent-cyan)' }}>-TAP</span>
              </h1>
              <span className={`badge ${telemetry.connected && wsConnected ? 'badge-emerald' : 'badge-rose'}`}>
                <span className={`pulse-dot ${telemetry.connected && wsConnected ? '' : 'inactive'}`} />
                {telemetry.connected && wsConnected ? 'RECEIVER LIVE' : 'OFFLINE'}
              </span>
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {sys?.system_name || 'Connecting to receiver...'} {sys?.callsign && (
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>// {sys.callsign}</span>
              )}
            </div>
          </div>
        </div>

        {/* Telemetry Metrics Bar (Fixed stable widths to prevent horizontal shifting) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flex: 1, justifyContent: 'center' }}>
          
          <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px', minWidth: '135px' }}>
            <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700 }}>
              System / Site
            </div>
            <div className="mono" style={{ fontSize: '0.86rem', color: '#ffffff', fontWeight: 700 }}>
              {sys?.system_name || 'County P25'} <span style={{ color: 'var(--text-dim)' }}>|</span> <span style={{ color: 'var(--accent-cyan)' }}>Site {telemetry.site || '1.26'}</span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px', minWidth: '110px' }}>
            <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700 }}>
              WACN / SYSID
            </div>
            <div className="mono" style={{ fontSize: '0.86rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
              {wacnHex} <span style={{ color: 'var(--text-dim)' }}>:</span> {sysidHex}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px', minWidth: '150px' }}>
            <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700 }}>
              Control Frequency
            </div>
            <div className="mono" style={{ fontSize: '0.86rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
              {ccMHz} <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>NAC {nacHex}</span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px', minWidth: '85px' }}>
            <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700 }}>
              Tuning Error
            </div>
            <div className="mono" style={{ fontSize: '0.86rem', color: telemetry.error_hz !== null && Math.abs(telemetry.error_hz) < 100 ? 'var(--accent-emerald)' : 'var(--accent-fire)', fontWeight: 600 }}>
              {telemetry.error_hz !== null ? `${telemetry.error_hz} Hz` : '0 Hz'}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '12px', minWidth: '95px' }}>
            <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 700 }}>
              Subscribers
            </div>
            <div className="mono" style={{ fontSize: '0.86rem', color: 'var(--text-main)', fontWeight: 700 }}>
              {telemetry.wuid_count} <span style={{ fontSize: '0.70rem', color: 'var(--text-dim)', fontWeight: 400 }}>affiliated</span>
            </div>
          </div>

        </div>

        {/* Tactical Audio Station */}
        <div className={`audio-station ${isPlaying ? 'active' : ''}`} style={{ width: '260px', minWidth: '260px', boxSizing: 'border-box' }}>
          
          {/* Button lights up when active */}
          <button
            type="button"
            onClick={togglePlay}
            className={`btn ${isPlaying ? 'btn-primary' : ''}`}
            style={{
              padding: '4px 10px',
              fontSize: '0.74rem',
              letterSpacing: '0.04em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              flexShrink: 0,
            }}
            title="OP25 Port 9000 Zero-Latency PCM WebSocket Audio"
          >
            <Headphones size={14} color={isPlaying ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
            <span style={{ fontWeight: 700 }}>AUDIO</span>
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', flexShrink: 0 }} />

          {/* Volume Mute Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            className="btn"
            style={{
              padding: '4px 6px',
              width: '28px',
              color: isMuted ? 'var(--accent-fire)' : (isPlaying ? 'var(--accent-cyan)' : 'var(--text-dim)'),
              flexShrink: 0,
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          {/* Tactile Volume Slider & Coupled Readout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="audio-slider"
              style={{ width: '64px', flexShrink: 0 }}
              title={`Volume: ${volPercent}%`}
            />

            {/* Centered Volume Readout */}
            <span
              className="mono"
              style={{
                width: '28px',
                textAlign: 'center',
                fontSize: '0.70rem',
                fontWeight: 600,
                color: isMuted ? 'var(--accent-fire)' : 'var(--text-muted)',
                flexShrink: 0,
              }}
            >
              {isMuted ? '0%' : `${volPercent}%`}
            </span>
          </div>

        </div>

      </div>
    </header>
  );
};
