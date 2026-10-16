import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a list from shifting under the cursor. While a mouse is over the list
 * the set and order of visible rows is frozen: rows that arrive later are only
 * counted (`pending`), and `flush` (or moving the pointer away) releases them.
 * Rows already on screen still update in place, and a row that stops matching a
 * filter still disappears, so holding never shows stale or filtered-out data.
 * Touch input is never held. Leaving releases after a short grace period, so the pointer can
 * travel to the "N new" pill (spread `hoverProps` onto it too) without the hold dropping.
 */
const LEAVE_GRACE_MS = 350;

export function useHoldWhileHovered<T>(items: T[], idOf: (item: T) => string | number) {
  const [heldIds, setHeldIds] = useState<Array<string | number> | null>(null);
  const heldRef = useRef(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const itemsRef = useRef(items);
  const idOfRef = useRef(idOf);
  useEffect(() => {
    itemsRef.current = items;
    idOfRef.current = idOf;
  });

  const hold = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    if (heldRef.current) return;
    heldRef.current = true;
    setHeldIds(itemsRef.current.map(idOfRef.current));
  }, []);
  const flush = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    heldRef.current = false;
    setHeldIds(null);
  }, []);

  const byId = new Map(items.map((i) => [idOf(i), i]));
  const shown = heldIds ? heldIds.map((id) => byId.get(id)).filter((i): i is T => i !== undefined) : items;
  const heldSet = heldIds ? new Set(heldIds) : null;
  const pending = heldSet ? items.filter((i) => !heldSet.has(idOf(i))).length : 0;

  // If the list changes so completely that nothing held is left (range or filter change), let go.
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const nothingLeft = heldIds !== null && shown.length === 0;
  useEffect(() => {
    if (nothingLeft) flush();
  }, [nothingLeft, flush]);

  const hoverProps = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') hold();
    },
    onPointerLeave: () => {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(flush, LEAVE_GRACE_MS);
    },
  };

  return { shown, pending, hoverProps, flush, holding: heldIds !== null };
}
