import React from 'react';
import { Network } from 'lucide-react';
import type { TelemetryStatus } from '../types';

interface TopologyViewProps {
  telemetry: TelemetryStatus;
}

export const TopologyView: React.FC<TopologyViewProps> = ({ telemetry }) => {
  const adjList = telemetry.adjacent_sites || [];
  const currentSite = telemetry.site || '1.26';
  const sys = telemetry.system;

  return (
    <div className="glass-panel" style={{ padding: '18px', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Network size={18} color="var(--accent-cyan)" />
        <h2 style={{ fontSize: '0.92rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, color: 'var(--text-dim)' }}>
          Network Topology & Adjacent Towers
        </h2>
        <span className="badge badge-muted mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>{adjList.length}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: '16px', marginBottom: '20px' }}>
        {/* Current Site Card */}
        <div style={{
          background: 'rgba(34, 211, 238, 0.08)',
          border: '1px solid rgba(34, 211, 238, 0.4)',
          borderRadius: 'var(--radius-md)',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--accent-cyan)', fontWeight: 700 }}>
              MONITORED TOWER
            </span>
            <span className="badge badge-emerald">ACTIVE CC</span>
          </div>

          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
            Site {currentSite}
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {sys?.system_name || 'County P25'} {sys?.callsign && `(${sys.callsign})`}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-dim)' }}>Downlink: </span>
              <span className="mono" style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>
                {sys?.rxchan ? (sys.rxchan / 1_000_000).toFixed(4) : '—'} MHz
              </span>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-dim)' }}>NAC: </span>
              <span className="mono" style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                {sys?.nac ? `0x${sys.nac.toString(16).toUpperCase()}` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Adjacent Site Count Summary */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '4px' }}>
            Adjacent Site Broadcasts
          </div>
          <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
            {adjList.length} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 400 }}>neighbor towers</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            Discovered from OP25 control channel broadcast frames
          </div>
        </div>
      </div>

      {/* Neighbor Towers Table */}
      <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '8px' }}>
        Adjacent Towers Directory
      </h3>

      {adjList.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          No neighbor towers broadcast yet.
        </div>
      ) : (
        <div className="table-scroll">
        <table className="tactical-table">
          <thead>
            <tr>
              <th>Neighbor Tower</th>
              <th>Downlink Frequency</th>
              <th className="hide-sm">Uplink Frequency</th>
              <th className="hide-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {adjList.map((adj, idx) => {
              const freqMhz = adj.frequency ? (adj.frequency / 1_000_000).toFixed(4) : '—';
              const uplinkMhz = adj.uplink ? (adj.uplink / 1_000_000).toFixed(4) : '—';

              return (
                <tr key={`${adj.neighbor_site}-${idx}`}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      Site {adj.neighbor_site}
                    </div>
                    <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      RFSS {adj.rfid || '1'} : STID {adj.stid || '—'}
                    </div>
                  </td>

                  <td className="mono" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    {freqMhz} MHz
                  </td>

                  <td className="mono hide-sm" style={{ color: 'var(--text-dim)' }}>
                    {uplinkMhz} MHz
                  </td>

                  <td className="hide-sm">
                    <span className="badge badge-cyan">BROADCASTING</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
};
