import React, { useEffect, useState } from 'react';
import { Activity, Maximize2, X, BarChart2, Moon, Sun } from 'lucide-react';
import type { TelemetryStatus } from '../types';
import '../styles/plots.css';

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

  return <img src={displayedSrc} alt={alt} className={`scope-img ${isDark ? 'phosphor' : ''}`} />;
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
      <div className="glass-panel panel-pad scope-bar">
        <div className="scope-bar-row">
          <div className="row scope-bar-id">
            <div className="icon-tile"><Activity size={18} /></div>
            <div>
              <div className="row-wrap">
                <span className="scope-bar-title">RF SIGNAL ANALYSIS & SCOPES</span>
                <span className="badge badge-cyan badge-sm">
                  CH {selectedChannel}: {channelLabel} {ccMHz ? `(${ccMHz} MHz)` : ''}
                </span>
              </div>
              <div className="scope-bar-sub">
                Live GNU Radio signal oscilloscopes & baseband analyzers · {activeCount} of 6 active
              </div>
            </div>
          </div>

          <div className="row-wrap">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`btn scope-btn ${isDarkMode ? 'btn-primary' : ''}`}
              title="Toggle Dark Oscilloscope / Light Mode"
            >
              {isDarkMode ? <Moon size={13} color="var(--accent-cyan)" /> : <Sun size={13} />}
              <span>{isDarkMode ? 'DARK PHOSPHOR' : 'LIGHT SCOPE'}</span>
            </button>

            <div className="scope-divider" />

            {PLOT_DEFINITIONS.map((p) => {
              const isActive = Boolean(activePlotsMap[p.kind]);
              return (
                <button
                  key={p.id}
                  onClick={() => handleTogglePlot(p.id)}
                  disabled={togglingPlotId === p.id}
                  className={`btn scope-btn ${isActive ? 'btn-primary' : ''}`}
                  title={`Click to toggle ${p.name}`}
                >
                  <span className={`scope-led ${isActive ? 'on' : ''}`} />
                  <span>{p.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2x3 Grid of Scopes */}
      <div className="scope-grid">
        {PLOT_DEFINITIONS.map((def) => {
          const plotItem = activePlotsMap[def.kind];
          const isActive = Boolean(plotItem);
          const zoom = () => plotItem && setZoomedPlot({ name: def.name, url: plotItem.url, description: def.description });

          return (
            <div key={def.id} className="glass-panel scope-card panel-clip">
              <div className="panel-header scope-card-head">
                <div className="row">
                  <BarChart2 size={15} color={isActive ? 'var(--accent-cyan)' : 'var(--text-dim)'} />
                  <span className="scope-card-name">{def.name}</span>
                  <span className={`scope-tag ${isActive ? 'on' : ''}`}>{def.badge}</span>
                </div>

                <div className="row">
                  {plotItem && <span className="mono-dim scope-seq">#{plotItem.seq}</span>}
                  {plotItem && (
                    <button onClick={zoom} className="btn scope-zoom" title="Inspect full resolution">
                      <Maximize2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className={`scope-screen ${isActive ? 'live' : ''}`} onClick={zoom}>
                {isActive ? (
                  <ScopeImage url={plotItem.url} alt={def.name} isDark={isDarkMode} />
                ) : (
                  <div className="scope-offline">
                    <div className="scope-offline-title">SCOPE OFFLINE</div>
                    <div className="scope-offline-sub">
                      Click <strong>{def.name.split(' ')[0]}</strong> in the top bar to activate this feed.
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePlot(def.id);
                      }}
                      className="btn scope-activate"
                    >
                      Activate Scope
                    </button>
                  </div>
                )}
              </div>

              <div className="scope-card-note">{def.description}</div>
            </div>
          );
        })}
      </div>

      {/* Lightbox / Zoom Modal */}
      {zoomedPlot && (
        <div className="scope-lightbox" onClick={() => setZoomedPlot(null)}>
          <div className="glass-panel scope-modal panel-clip" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <div className="row">
                <Activity size={18} color="var(--accent-cyan)" />
                <span className="scope-modal-title">{zoomedPlot.name}</span>
              </div>
              <button onClick={() => setZoomedPlot(null)} className="btn scope-zoom" title="Close">
                <X size={15} />
              </button>
            </div>

            <div className="scope-modal-body">
              <img src={zoomedPlot.url} alt={zoomedPlot.name} className={`scope-modal-img ${isDarkMode ? 'phosphor' : ''}`} />
            </div>

            <div className="scope-modal-foot">
              <div className="text-muted">{zoomedPlot.description}</div>
              <button onClick={() => setZoomedPlot(null)} className="btn btn-primary">
                Close Scope
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
