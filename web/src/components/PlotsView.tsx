import React, { useEffect, useState } from 'react';
import { Activity, Maximize2, X, BarChart2, Moon, Sun } from 'lucide-react';
import type { TelemetryStatus } from '../types';

interface PlotsViewProps {
  telemetry: TelemetryStatus;
}

interface PlotConfig {
  id: number;
  kind: string;
  name: string;
  description: string;
  badge: string;
}

const PLOT_DEFINITIONS: PlotConfig[] = [
  {
    id: 1,
    kind: 'fft',
    name: 'Spectrum Analyzer',
    description: 'RF Power (dB) vs Frequency showing tuned carrier peak and channel bandwidth.',
    badge: 'FFT / POWER'
  },
  {
    id: 2,
    kind: 'constellation',
    name: 'I/Q Constellation',
    description: 'Quadrature phase constellation showing 4-level FSK / CQPSK symbol clusters.',
    badge: 'I/Q PHASOR'
  },
  {
    id: 3,
    kind: 'symbol',
    name: 'Demodulated Symbol Stream',
    description: '4-level baseband symbol levels (+3, +1, -1, -3) over time.',
    badge: '4-LEVEL SYMBOL'
  },
  {
    id: 4,
    kind: 'eye',
    name: 'Datascope / Eye Pattern',
    description: 'Multi-trace eye pattern demonstrating symbol transition timing and jitter.',
    badge: 'EYE PATTERN'
  },
  {
    id: 5,
    kind: 'mixer',
    name: 'Raw Mixer Spectrum',
    description: 'Pre-filtered baseband mixer output showing center frequency offset.',
    badge: 'BASEBAND MIXER'
  },
  {
    id: 6,
    kind: 'fll',
    name: 'Tuned Mixer (FLL)',
    description: 'Frequency-locked loop centered baseband spectrum alignment.',
    badge: 'FLL TRACKING'
  },
];

/**
 * Preloading image component that eliminates blinking, tearing, and fading.
 * Holds previous frame in view while preloading new frame in background.
 */
const ScopeImage: React.FC<{
  url: string;
  alt: string;
  isDark: boolean;
}> = ({ url, alt, isDark }) => {
  const [displayedSrc, setDisplayedSrc] = useState(url);

  useEffect(() => {
    if (!url || url === displayedSrc) return;
    const preload = new Image();
    preload.src = url;
    preload.onload = () => {
      setDisplayedSrc(url);
    };
  }, [url]);

  return (
    <img
      src={displayedSrc}
      alt={alt}
      style={{
        width: '100%',
        height: 'auto',
        maxHeight: '340px',
        objectFit: 'contain',
        display: 'block',
        filter: isDark ? 'invert(1) contrast(1.08)' : 'none',
        transition: 'filter 0.2s ease',
      }}
    />
  );
};

export const PlotsView: React.FC<PlotsViewProps> = ({ telemetry }) => {
  const [selectedChannel] = useState('0');
  const [isDarkMode, setIsDarkMode] = useState(true); // Dark mode ON by default
  const [zoomedPlot, setZoomedPlot] = useState<{ name: string; url: string; description: string } | null>(null);
  const [togglingPlotId, setTogglingPlotId] = useState<number | null>(null);

  const activePlotsMap = telemetry.plots?.[selectedChannel] || {};
  const activeCount = Object.keys(activePlotsMap).length;

  const handleTogglePlot = async (plotId: number) => {
    try {
      setTogglingPlotId(plotId);
      await fetch('/api/plots/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plot_id: plotId, channel: parseInt(selectedChannel, 10) || 0 })
      });
    } catch (err) {
      console.error('Failed to toggle plot', err);
    } finally {
      setTimeout(() => setTogglingPlotId(null), 500);
    }
  };

  const channelLabel = telemetry.system?.system_name || 'Channel 0';
  const ccMHz = telemetry.system?.rxchan ? (telemetry.system.rxchan / 1_000_000).toFixed(6) : null;

  return (
    <div>
      {/* Scope Controls Header */}
      <div className="glass-panel" style={{ padding: '12px 16px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '4px',
              background: 'linear-gradient(180deg, #282a32 0%, #17181f 100%)',
              border: '1px solid #3c3e4a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)'
            }}>
              <Activity size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '0.04em' }}>
                  RF SIGNAL ANALYSIS & SCOPES
                </span>
                <span className="badge badge-cyan" style={{ fontSize: '0.68rem' }}>
                  CH {selectedChannel}: {channelLabel} {ccMHz ? `(${ccMHz} MHz)` : ''}
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Live GNU Radio signal oscilloscopes & baseband analyzers · {activeCount} of 6 active
              </div>
            </div>
          </div>

          {/* Quick Controls: Dark Mode Toggle & Plot Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            
            {/* Dark Mode Phosphor Toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`btn ${isDarkMode ? 'btn-primary' : ''}`}
              style={{
                padding: '5px 10px',
                fontSize: '0.72rem',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: isDarkMode ? 'rgba(56, 189, 248, 0.15)' : undefined,
                border: isDarkMode ? '1px solid var(--accent-cyan)' : undefined
              }}
              title="Toggle Dark Oscilloscope / Light Mode"
            >
              {isDarkMode ? <Moon size={13} color="var(--accent-cyan)" /> : <Sun size={13} />}
              <span>{isDarkMode ? 'DARK PHOSPHOR' : 'LIGHT SCOPE'}</span>
            </button>

            <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', margin: '0 4px' }} />

            {/* Scope Toggles */}
            {PLOT_DEFINITIONS.map((p) => {
              const isActive = Boolean(activePlotsMap[p.kind]);
              const isToggling = togglingPlotId === p.id;

              return (
                <button
                  key={p.id}
                  onClick={() => handleTogglePlot(p.id)}
                  disabled={isToggling}
                  className={`btn ${isActive ? 'btn-primary' : ''}`}
                  style={{
                    padding: '5px 10px',
                    fontSize: '0.72rem',
                    opacity: isToggling ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title={`Click to toggle ${p.name}`}
                >
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isActive ? 'var(--accent-emerald)' : 'var(--text-dim)',
                    display: 'inline-block'
                  }} />
                  <span>{p.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* 2x3 Grid of Scopes */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: '14px',
        marginBottom: '16px'
      }}>
        {PLOT_DEFINITIONS.map((def) => {
          const plotItem = activePlotsMap[def.kind];
          const isActive = Boolean(plotItem);

          return (
            <div key={def.id} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              
              {/* Card Header */}
              <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart2 size={15} color={isActive ? 'var(--accent-cyan)' : 'var(--text-dim)'} />
                  <span style={{ fontWeight: 700, fontSize: '0.80rem', color: '#ffffff' }}>
                    {def.name}
                  </span>
                  <span className="badge" style={{
                    fontSize: '0.62rem',
                    padding: '1px 6px',
                    background: isActive ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    color: isActive ? 'var(--accent-cyan)' : 'var(--text-dim)',
                    border: `1px solid ${isActive ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`
                  }}>
                    {def.badge}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {plotItem && (
                    <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                      #{plotItem.seq}
                    </span>
                  )}
                  {plotItem && (
                    <button
                      onClick={() => setZoomedPlot({ name: def.name, url: plotItem.url, description: def.description })}
                      className="btn"
                      style={{ padding: '3px 6px', fontSize: '0.68rem' }}
                      title="Inspect full resolution"
                    >
                      <Maximize2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Scope Display Body */}
              <div style={{
                background: '#07080a',
                position: 'relative',
                minHeight: '270px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderTop: '1px solid #1c1d24',
                borderBottom: '1px solid #1c1d24',
                cursor: isActive ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (plotItem) {
                  setZoomedPlot({ name: def.name, url: plotItem.url, description: def.description });
                }
              }}
              >
                {isActive ? (
                  <ScopeImage
                    url={plotItem.url}
                    alt={def.name}
                    isDark={isDarkMode}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-dim)' }}>
                    <Activity size={32} style={{ opacity: 0.2, margin: '0 auto 10px auto' }} />
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                      Scope Feed Inactive
                    </div>
                    <div style={{ fontSize: '0.72rem', marginTop: '4px', maxWidth: '240px' }}>
                      Click <strong>{def.name.split(' ')[0]}</strong> toggle in top bar to activate feed.
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePlot(def.id);
                      }}
                      className="btn"
                      style={{ marginTop: '12px', fontSize: '0.72rem', padding: '4px 10px' }}
                    >
                      Activate Scope
                    </button>
                  </div>
                )}
              </div>

              {/* Card Footer Technical Annotation */}
              <div style={{ padding: '8px 14px', fontSize: '0.71rem', color: 'var(--text-dim)', background: '#0b0c10' }}>
                {def.description}
              </div>

            </div>
          );
        })}
      </div>

      {/* Lightbox / Zoom Modal */}
      {zoomedPlot && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 6, 8, 0.92)',
          backdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
        onClick={() => setZoomedPlot(null)}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '960px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Activity size={18} color="var(--accent-cyan)" />
                <span style={{ fontWeight: 800, fontSize: '0.94rem', color: '#ffffff' }}>
                  {zoomedPlot.name}
                </span>
              </div>
              <button
                onClick={() => setZoomedPlot(null)}
                className="btn"
                style={{ padding: '4px 8px' }}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ background: '#000000', padding: '12px', textAlign: 'center' }}>
              <img
                src={zoomedPlot.url}
                alt={zoomedPlot.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  objectFit: 'contain',
                  filter: isDarkMode ? 'invert(1) contrast(1.08)' : 'none',
                }}
              />
            </div>

            <div style={{ padding: '12px 18px', background: '#0b0c10', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {zoomedPlot.description}
              </div>
              <button
                onClick={() => setZoomedPlot(null)}
                className="btn btn-primary"
                style={{ padding: '6px 14px', fontSize: '0.76rem' }}
              >
                Close Scope
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
