import React, { useState } from 'react';
import { Lock, Radio, Search, Shield } from 'lucide-react';
import type { Talkgroup } from '../types';
import { getTalkgroupCategory } from '../utils/colors';
import { formatTs } from '../utils/time';
import { useFocus } from '../context/focus';
import { EntityLink, PinButton } from './EntityLink';

interface TalkgroupDirectoryProps {
  talkgroups: Talkgroup[];
}

export const TalkgroupDirectory: React.FC<TalkgroupDirectoryProps> = ({ talkgroups }) => {
  const { pins } = useFocus();
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

  // Pinned talkgroups float to the top, otherwise the server's order stands.
  const ordered = [...filtered].sort((a, b) => Number(pins.has(b.tgid)) - Number(pins.has(a.tgid)));

  const formatAirtime = (ms: number) => {
    if (!ms) return '0s';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  };

  const formatLastSeen = (ts: number) => formatTs(ts, false);

  return (
    <div className="glass-panel panel-col">
      <div className="panel-header">
        <div className="panel-title">
          <Radio size={16} color="var(--accent-purple)" />
          <h2>Talkgroups Directory</h2>
          <span className="badge badge-muted mono badge-sm">{filtered.length}</span>
        </div>

        <div className="panel-search">
          <Search size={14} />
          <input
            type="text"
            className="input-search"
            placeholder="Search talkgroups..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="panel-scroll tall">
        {filtered.length === 0 ? (
          <div className="empty-note">No talkgroups found.</div>
        ) : (
          <table className="tactical-table">
            <thead>
              <tr>
                <th className="pin-col" aria-label="Pinned" />
                <th className="w80">TGID</th>
                <th>Talkgroup Name / Alias</th>
                <th className="hide-sm">Group / Tag</th>
                <th className="w75">Calls</th>
                <th className="hide-sm w85">Airtime</th>
                <th className="w85"><span className="hide-sm">Security</span></th>
                <th className="hide-sm w80">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((tg) => (
                <tr key={tg.id}>
                  <td className="pin-col"><PinButton tgid={tg.tgid} /></td>
                  <td className="mono-cyan"><EntityLink kind="tg" id={tg.tgid}>{tg.tgid}</EntityLink></td>

                  <td>
                    <div className="tg-name-cell"><EntityLink kind="tg" id={tg.tgid}>{tg.alias || `TG ${tg.tgid}`}</EntityLink></div>
                    {(tg.tg_group || tg.tg_tag) && (
                      <div className="show-sm tg-sub">
                        {tg.tg_group || tg.tg_tag} · {formatLastSeen(tg.last_seen)}
                      </div>
                    )}
                  </td>

                  <td className="hide-sm cell-sm text-muted">
                    {(() => {
                      const cat = getTalkgroupCategory(tg.alias, tg.tg_group, tg.tg_tag);
                      return (
                        <span className="cat-tag" style={{ '--cat': cat.color } as React.CSSProperties} title={cat.fullLabel}>
                          {cat.label}
                        </span>
                      );
                    })()}
                    {(tg.tg_group || tg.tg_tag) && <span className="tg-group">{tg.tg_group || tg.tg_tag}</span>}
                  </td>

                  <td className="cell-mono tg-calls">{tg.call_count.toLocaleString()}</td>

                  <td className="cell-mono hide-sm cell-sm text-dim nowrap">{formatAirtime(tg.total_ms)}</td>

                  <td>
                    {tg.encrypted ? (
                      <span className="badge badge-rose" title="Encrypted Voice">
                        <Lock size={10} /> <span className="hide-sm">ENC</span>
                      </span>
                    ) : (
                      <span className="badge badge-emerald" title="Clear Voice">
                        <Shield size={10} /> <span className="hide-sm">CLEAR</span>
                      </span>
                    )}
                  </td>

                  <td className="cell-mono hide-sm cell-sm text-dim">{formatLastSeen(tg.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
