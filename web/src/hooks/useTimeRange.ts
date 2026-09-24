import { useCallback, useEffect, useState } from 'react';
import type { TimeRange } from '../types';

/** Reads ?from=&to= (epoch seconds). Present -> history mode; absent -> live. */
function readUrl(): TimeRange | null {
  const p = new URLSearchParams(window.location.search);
  const from = Number(p.get('from'));
  const to = Number(p.get('to'));
  return from > 0 && to > from ? { from, to } : null;
}

/**
 * History range synced to the URL, so a view can be bookmarked/shared and the
 * browser back button steps out of a timeline zoom.
 */
export function useTimeRange() {
  const [range, setRangeState] = useState<TimeRange | null>(readUrl);

  useEffect(() => {
    const onPop = () => setRangeState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setRange = useCallback((next: TimeRange | null) => {
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set('from', String(Math.floor(next.from)));
      url.searchParams.set('to', String(Math.ceil(next.to)));
    } else {
      url.searchParams.delete('from');
      url.searchParams.delete('to');
    }
    window.history.pushState(null, '', url);
    setRangeState(next ? { from: Math.floor(next.from), to: Math.ceil(next.to) } : null);
  }, []);

  return { range, setRange };
}
