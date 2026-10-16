import React from 'react';
import { Star } from 'lucide-react';
import { useFocus } from '../context/focus';

interface EntityLinkProps {
  kind: 'tg' | 'rid';
  id: number | null | undefined;
  className?: string;
  children?: React.ReactNode;
}

/** A talkgroup or radio ID that opens the detail drawer when clicked. */
export const EntityLink: React.FC<EntityLinkProps> = ({ kind, id, className = '', children }) => {
  const { open } = useFocus();
  if (id == null) return <>{children}</>;
  return (
    <button
      type="button"
      className={`ent-link ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        open({ kind, id });
      }}
      title={kind === 'tg' ? `Talkgroup ${id}: open details` : `Radio ${id}: open details`}
    >
      {children ?? id}
    </button>
  );
};

/** Star toggle for pinning a talkgroup. Hidden until row hover unless pinned. */
export const PinButton: React.FC<{ tgid: number | null | undefined; always?: boolean }> = ({ tgid, always = false }) => {
  const { pins, togglePin } = useFocus();
  if (tgid == null) return null;
  const pinned = pins.has(tgid);
  return (
    <button
      type="button"
      className={`pin-btn ${pinned ? 'pinned' : ''} ${always ? 'always' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin talkgroup ${tgid}` : `Pin talkgroup ${tgid}`}
      title={pinned ? 'Unpin talkgroup' : 'Pin talkgroup'}
      onClick={(e) => {
        e.stopPropagation();
        togglePin(tgid);
      }}
    >
      <Star size={12} fill={pinned ? 'currentColor' : 'none'} />
    </button>
  );
};
