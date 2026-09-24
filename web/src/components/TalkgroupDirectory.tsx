import React, { useState } from 'react';
import { Lock, Radio, Search, Shield } from 'lucide-react';
import type { Talkgroup } from '../types';

interface TalkgroupDirectoryProps {
  talkgroups: Talkgroup[];
}

export const TalkgroupDirectory: React.FC<TalkgroupDirectoryProps> = ({ talkgroups }) => {
  const [filter, setFilter] = useState('');

  const filtered = talkgroups.filter((tg) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      String(tg.tgid).includes(q) ||
      (tg.alias && tg.alias.toLowerCase().includes(q)) ||
      (tg.tg_group && tg.tg_group.toLowerCase().includes(q))
    );
  });

  const formatAirtime = (ms: number) => {
    if (!ms) return '0s';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  };

  const formatLastSeen = (ts: number) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header & Filter */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Radio size={16} color="var(--accent-purple)" />
          <h2 style={{ fontSize: '0.86rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, color: 'var(--text-dim)' }}>
            Talkgroups Directory
          </h2>
          <span className="badge badge-muted mono" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>{filtered.length}</span>
        </div>

        <div style={{ position: 'relative', minWidth: '180px', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            className="input-search"
            placeholder="Search talkgroups..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', paddingLeft: '30px' }}
          />
        </div>
      </div>

      {/* Table Container */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '550px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
            No talkgroups found.
          </div>
        ) : (
          <table className="tactical-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>TGID</th>
                <th>Talkgroup Name / Alias</th>
                <th>Group / Tag</th>
                <th style={{ width: '75px' }}>Calls</th>
                <th style={{ width: '85px' }}>Airtime</th>
                <th style={{ width: '85px' }}>Security</th>
                <th style={{ width: '80px' }}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tg) => (
                <tr key={tg.id}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    {tg.tgid}
                  </td>

                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                      {tg.alias || `TG ${tg.tgid}`}
                    </div>
                  </td>

                  <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {tg.tg_group || tg.tg_tag || '—'}
                  </td>

                  <td className="mono" style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                    {tg.call_count.toLocaleString()}
                  </td>

                  <td className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                    {formatAirtime(tg.total_ms)}
                  </td>

                  <td>
                    {tg.encrypted ? (
                      <span className="badge badge-rose" title="Encrypted Voice">
                        <Lock size={10} /> ENC
                      </span>
                    ) : (
                      <span className="badge badge-emerald" title="Clear Voice">
                        <Shield size={10} /> CLEAR
                      </span>
                    )}
                  </td>

                  <td className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                    {formatLastSeen(tg.last_seen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
