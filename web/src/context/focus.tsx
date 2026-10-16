import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** Something the detail drawer can show: a talkgroup or a radio. */
export interface Entity {
  kind: 'tg' | 'rid';
  id: number;
}

interface FocusValue {
  pins: ReadonlySet<number>;
  togglePin: (tgid: number) => void;
  /** When on (and something is pinned) every panel narrows to pinned talkgroups. */
  follow: boolean;
  setFollow: (on: boolean) => void;
  /** True if activity on this talkgroup should be shown under the current focus. */
  matches: (tgid?: number | null) => boolean;
  entity: Entity | null;
  open: (e: Entity) => void;
  close: () => void;
}

const PIN_KEY = 'op25tap.pins';
const FOLLOW_KEY = 'op25tap.follow';

function loadPins(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

function loadFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === 'on';
  } catch {
    return false;
  }
}

const Ctx = createContext<FocusValue | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const [pins, setPins] = useState<Set<number>>(loadPins);
  const [follow, setFollowState] = useState(loadFollow);
  const [entity, setEntity] = useState<Entity | null>(null);

  const togglePin = useCallback((tgid: number) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(tgid)) next.delete(tgid);
      else next.add(tgid);
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
      } catch {
        /* preference just won't persist */
      }
      return next;
    });
  }, []);

  const setFollow = useCallback((on: boolean) => {
    setFollowState(on);
    try {
      localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off');
    } catch {
      /* preference just won't persist */
    }
  }, []);

  const value = useMemo<FocusValue>(
    () => ({
      pins,
      togglePin,
      follow,
      setFollow,
      matches: (tgid) => !follow || pins.size === 0 || (tgid != null && pins.has(tgid)),
      entity,
      open: setEntity,
      close: () => setEntity(null),
    }),
    [pins, togglePin, follow, setFollow, entity],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFocus(): FocusValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFocus must be used inside <FocusProvider>');
  return v;
}
