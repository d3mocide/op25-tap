import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import '../styles/toasts.css';

export const SHORTCUTS: Array<[string, string]> = [
  ['1 – 7', 'Switch tabs'],
  ['L / H', 'Live / History'],
  ['/', 'Focus the search box'],
  ['Space', 'Audio on / off'],
  ['F', 'Follow pinned talkgroups'],
  ['A', 'Cycle the Airwaves backdrop'],
  ['Esc', 'Close the drawer or this help'],
  ['?', 'Show this help'],
];

export const ShortcutHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="glass-panel help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title"><h2>Keyboard shortcuts</h2></div>
          <button type="button" className="btn drawer-close" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <dl className="help-list">
          {SHORTCUTS.map(([k, d]) => (
            <React.Fragment key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{d}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
};
