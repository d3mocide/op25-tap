import { useCallback, useEffect, useState } from 'react';
import type { Affiliation, Anomaly, EventItem, Talkgroup, TimeRange, TimelineResponse } from '../types';

const PAGE = 500;

const getJson = <T,>(url: string, fallback: T): Promise<T> =>
  fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

export interface HistoryData {
  events: EventItem[];
  talkgroups: Talkgroup[];
  affiliations: Affiliation[];
  anomalies: Anomaly[];
  timeline: TimelineResponse | null;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

/** Everything the panels need for one historical range. Keeps the previous data while refetching. */
export function useHistoryData(range: TimeRange | null): HistoryData {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [talkgroups, setTalkgroups] = useState<Talkgroup[]>([]);
  const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    const q = `from=${range.from}&to=${range.to}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an external fetch
    setLoading(true);
    Promise.all([
      getJson<EventItem[]>(`/api/events?${q}&limit=${PAGE}`, []),
      getJson<Talkgroup[]>(`/api/talkgroups?${q}&limit=1000`, []),
      getJson<Affiliation[]>(`/api/affiliations?${q}&limit=1000`, []),
      getJson<Anomaly[]>(`/api/anomalies?${q}&limit=1000`, []),
      getJson<TimelineResponse | null>(`/api/timeline?${q}&buckets=120`, null),
    ]).then(([ev, tg, aff, anom, tl]) => {
      if (cancelled) return;
      setEvents(ev);
      setHasMore(ev.length === PAGE);
      setTalkgroups(tg);
      setAffiliations(aff);
      setAnomalies(anom);
      setTimeline(tl);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const loadMore = useCallback(() => {
    if (!range || !events.length) return;
    const before = events[events.length - 1].ts;
    setLoading(true);
    getJson<EventItem[]>(
      `/api/events?from=${range.from}&to=${range.to}&before=${before}&limit=${PAGE}`,
      [],
    ).then((more) => {
      setEvents((prev) => [...prev, ...more]);
      setHasMore(more.length === PAGE);
      setLoading(false);
    });
  }, [range, events]);

  return { events, talkgroups, affiliations, anomalies, timeline, loading, hasMore, loadMore };
}
