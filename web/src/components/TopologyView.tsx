import React from 'react';
import { Network } from 'lucide-react';
import type { AdjacentSite, TelemetryStatus } from '../types';

interface TopologyViewProps {
  telemetry: TelemetryStatus;
}

/** Radial map: the monitored tower in the middle, each neighbour on a ring around it. */
const TowerMap: React.FC<{ site: string; sys: TelemetryStatus['system']; adj: AdjacentSite[] }> = ({ site, sys, adj }) => {
  const W = 640;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 245;
  const ry = 125;
  // Stable order (by site id) so nodes don't shuffle between polls.
  const nodes = [...adj].sort((a, b) =>
    a.neighbor_site.localeCompare(b.neighbor_site, undefined, { numeric: true })
  );
  const total = Math.max(nodes.length, 1);

  return (
    <svg className="tower-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Site ${site} with ${adj.length} adjacent towers`}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="tm-orbit" />
      <ellipse cx={cx} cy={cy} rx={rx * 0.55} ry={ry * 0.55} className="tm-orbit tm-orbit-inner" />

      {/* Broadcast pulses from the control channel */}
      {[0, 1, 2].map((i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={30} ry={30 * (ry / rx)} className="tm-pulse" style={{ animationDelay: `${i * 1.3}s` }} />
      ))}

      {nodes.map((n, i) => {
        const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * rx;
        const y = cy + Math.sin(ang) * ry;
        const below = Math.sin(ang) > 0.35;
        const mhz = n.frequency ? (n.frequency / 1_000_000).toFixed(4) : '—';
        return (
          <g key={`${n.neighbor_site}-${i}`} className="tm-node">
            <line x1={cx} y1={cy} x2={x} y2={y} className="tm-link" />
            <circle cx={x} cy={y} r={7} className="tm-dot" />
            <circle cx={x} cy={y} r={11} className="tm-halo" />
            <text x={x} y={y + (below ? 27 : -27)} textAnchor="middle" className="tm-site">{n.neighbor_site}</text>
            <text x={x} y={y + (below ? 40 : -15)} textAnchor="middle" className="tm-freq">{mhz}</text>
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={20} className="tm-home-ring" />
      <circle cx={cx} cy={cy} r={11} className="tm-home" />
      <text x={cx} y={cy + 40} textAnchor="middle" className="tm-home-label">SITE {site}</text>
      <text x={cx} y={cy + 54} textAnchor="middle" className="tm-freq">
        {sys?.rxchan ? (sys.rxchan / 1_000_000).toFixed(4) : '—'}
      </text>
    </svg>
  );
};

export const TopologyView: React.FC<TopologyViewProps> = ({ telemetry }) => {
  const adjList = telemetry.adjacent_sites || [];
  const currentSite = telemetry.site || '—';
  const sys = telemetry.system;

  return (
    <div className="glass-panel panel-pad-lg panel-col">
      <div className="panel-title dim topo-title">
        <Network size={18} color="var(--accent-cyan)" />
        <h2>Network Topology & Adjacent Towers</h2>
        <span className="badge badge-muted mono badge-sm">{adjList.length}</span>
      </div>

      <div className="topo-grid">
        <div className="topo-home">
          <div className="topo-home-top">
            <span className="topo-home-kicker">MONITORED TOWER</span>
            <span className="badge badge-emerald">ACTIVE CC</span>
          </div>

          <div className="topo-home-site">Site {currentSite}</div>
          <div className="topo-home-sys">
            {sys?.system_name || '—'} {sys?.callsign && `(${sys.callsign})`}
          </div>

          <div className="topo-home-stats">
            <div>
              <span>Downlink: </span>
              <span className="mono amber">{sys?.rxchan ? (sys.rxchan / 1_000_000).toFixed(4) : '—'} MHz</span>
            </div>
            <div>
              <span>NAC: </span>
              <span className="mono white">{sys?.nac ? `0x${sys.nac.toString(16).toUpperCase()}` : '—'}</span>
            </div>
          </div>
        </div>

        <div className="tower-map-card">
          <div className="tower-map-head">
            <span>Adjacent site broadcasts</span>
            <span className="mono"><strong>{adjList.length}</strong> neighbor towers</span>
          </div>
          <TowerMap site={currentSite} sys={sys} adj={adjList} />
        </div>
      </div>

      <h3 className="topo-dir-title">Adjacent Towers Directory</h3>

      {adjList.length === 0 ? (
        <div className="empty-note">No neighbor towers broadcast yet.</div>
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
              {adjList.map((adj, idx) => (
                <tr key={`${adj.neighbor_site}-${idx}`}>
                  <td>
                    <div className="topo-site">Site {adj.neighbor_site}</div>
                    <div className="mono-dim topo-rfss">RFSS {adj.rfid || '1'} : STID {adj.stid || '—'}</div>
                  </td>
                  <td className="mono-cyan">{adj.frequency ? (adj.frequency / 1_000_000).toFixed(4) : '—'} MHz</td>
                  <td className="cell-mono hide-sm text-dim">{adj.uplink ? (adj.uplink / 1_000_000).toFixed(4) : '—'} MHz</td>
                  <td className="hide-sm"><span className="badge badge-cyan">BROADCASTING</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
