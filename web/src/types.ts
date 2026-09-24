export interface SystemInfo {
  sys_id?: number;
  site_id?: number;
  system_name: string;
  raw_name?: string;
  callsign?: string;
  top_line?: string;
  nac?: number;
  sysid?: number;
  wacn?: number;
  rfid?: number;
  stid?: number;
  rxchan?: number;
  last_tsbk?: number;
}

export interface FrequencyInfo {
  freq: number;
  type: string;
  counter: number;
  last_activity: string;
  active_tgid?: number;
  active_tag?: string;
  active_src?: number;
}

export interface ChannelInfo {
  channel_id: string;
  freq: number | null;
  tgid: number | null;
  tag?: string;
  srcaddr?: number;
  system?: string;
  encrypted: boolean;
  error?: number;
  stream_url?: string;
  name?: string;
}

export interface AdjacentSite {
  neighbor_site: string;
  rfid?: number;
  stid?: number;
  frequency?: number;
  uplink?: number;
}

export interface PlotItem {
  channel: string;
  kind: 'fft' | 'constellation' | 'symbol' | 'eye' | 'mixer' | 'fll' | string;
  seq: string;
  filename: string;
  url: string;
}

export interface TelemetryStatus {
  connected: boolean;
  target_url?: string;
  last_poll: number | null;
  system: SystemInfo | null;
  site: string | null;
  channels: ChannelInfo[];
  frequencies: Record<string, FrequencyInfo>;
  adjacent_sites: AdjacentSite[];
  wuid_count: number;
  stream_url: string | null;
  error_hz: number | null;
  plot_files?: string[];
  plots?: Record<string, Record<string, PlotItem>>;
  fine_tune?: number | null;
}

export interface EventItem {
  id: number;
  ts: number;
  system: string;
  type: string;
  from?: number | null;
  from_rid?: number | null;
  from_alias?: string | null;
  to_tg?: number | null;
  to_tgid?: number | null;
  tg_tag?: string | null;
  tg_alias?: string | null;
  site?: string | null;
  site_str?: string | null;
  freq?: number | null;
  frequency?: number | null;
  duration_ms: number;
  encrypted: boolean;
  details?: string;
  transcript?: string | null;
  has_audio?: boolean;
  category?: string | null;
  tg_group?: string | null;
}

export interface Talkgroup {
  id: number;
  system_id: number;
  system_name: string;
  tgid: number;
  alias: string | null;
  tg_group: string | null;
  tg_tag: string | null;
  priority: number | null;
  encrypted: number;
  call_count: number;
  total_ms: number;
  first_seen: number;
  last_seen: number;
}

export interface Radio {
  id: number;
  system_id: number;
  system_name: string;
  rid: number;
  alias: string | null;
  call_count: number;
  total_ms: number;
  first_seen: number;
  last_seen: number;
}

export interface Affiliation {
  id: number;
  ts: number;
  system_id: number;
  system_name: string;
  site_id: number | null;
  site_str: string | null;
  rid: number;
  radio_alias: string | null;
  tgid: number;
  tg_alias: string | null;
}

export interface Anomaly {
  id: number;
  ts: number;
  kind: string;
  system_id: number;
  system_name: string;
  site_id: number | null;
  rid: number | null;
  radio_alias: string | null;
  tgid: number | null;
  tg_alias: string | null;
  details: string;
  ack: number;
}
