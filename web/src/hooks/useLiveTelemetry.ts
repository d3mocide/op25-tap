import { useEffect, useRef, useState } from 'react';
import type {
  Affiliation,
  Anomaly,
  EventItem,
  Radio,
  Talkgroup,
  TelemetryStatus,
} from '../types';

export function useLiveTelemetry() {
  const [telemetry, setTelemetry] = useState<TelemetryStatus>({
    connected: false,
    last_poll: null,
    system: null,
    site: null,
    channels: [],
    frequencies: {},
    adjacent_sites: [],
    wuid_count: 0,
    stream_url: null,
    error_hz: null,
  });

  const [events, setEvents] = useState<EventItem[]>([]);
  const [talkgroups, setTalkgroups] = useState<Talkgroup[]>([]);
  const [radios, setRadios] = useState<Radio[]>([]);
  const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Load initial data from REST API
  const refreshData = async () => {
    try {
      const [resStatus, resEvents, resTgs, resRadios, resAff, resAnom] = await Promise.all([
        fetch('/api/status').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/events?limit=50').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/talkgroups?limit=200').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/radios?limit=200').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/affiliations?limit=100').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/anomalies?limit=50').then((r) => (r.ok ? r.json() : [])),
      ]);

      if (resStatus) setTelemetry(resStatus);
      if (resEvents) setEvents(resEvents);
      if (resTgs) setTalkgroups(resTgs);
      if (resRadios) setRadios(resRadios);
      if (resAff) setAffiliations(resAff);
      if (resAnom) setAnomalies(resAnom);
    } catch (err) {
      console.warn('Initial REST load error:', err);
    }
  };

  useEffect(() => {
    refreshData();

    // Establish WebSocket connection
    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/live`;
      console.log('Connecting to WebSocket:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket stream connected');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'telemetry') {
            setTelemetry((prev) => ({
              ...prev,
              ...msg.data,
              connected: true,
            }));
          } else if (msg.event === 'event') {
            const newEvent: EventItem = msg.data;
            setEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === newEvent.id);
              let next: EventItem[];
              if (idx >= 0) {
                next = [...prev];
                next[idx] = { ...next[idx], ...newEvent };
              } else {
                next = [newEvent, ...prev];
              }
              return next.sort((a, b) => b.ts - a.ts).slice(0, 150);
            });
          } else if (msg.event === 'transcript') {
            const update = msg.data;
            setEvents((prev) =>
              prev.map((ev) =>
                ev.id === update.id
                  ? { ...ev, transcript: update.transcript, has_audio: update.has_audio ?? ev.has_audio }
                  : ev
              )
            );
          } else if (msg.event === 'anomaly') {
            const newAnomaly: Anomaly = msg.data;
            setAnomalies((prev) => [newAnomaly, ...prev.slice(0, 50)]);
          }
        } catch (err) {
          console.error('WebSocket parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket stream closed. Retrying in 2s...');
        setWsConnected(false);
        reconnectTimeoutRef.current = window.setTimeout(connectWs, 2000);
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
        ws.close();
      };
    };

    connectWs();

    // Refresh directory tables periodically
    const interval = setInterval(refreshData, 10000);

    return () => {
      clearInterval(interval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return {
    telemetry,
    events,
    talkgroups,
    radios,
    affiliations,
    anomalies,
    wsConnected,
    refreshData,
  };
}
