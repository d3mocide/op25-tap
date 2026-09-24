const pad = (n: number) => String(n).padStart(2, '0');

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** HH:MM[:SS], prefixed with the date when it isn't today (history spans days). */
export function formatTs(ts: number, seconds = true): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
  if (isSameDay(d, new Date())) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** Epoch seconds -> value for <input type="datetime-local"> (local time). */
export function toInputValue(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t / 1000;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

/** Local midnight `n` days after the day containing `ts` (DST-safe). */
export function addDays(ts: number, n: number): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime() / 1000;
}

/** "YYYY-MM-DD" (server rollup day) -> local midnight epoch seconds. */
export function dayToTs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime() / 1000;
}

export function formatRange(from: number, to: number): string {
  const a = new Date(from * 1000);
  const b = new Date(to * 1000);
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour12: false, hour: '2-digit', minute: '2-digit' };
  // A whole single day reads as just the date.
  if (from === startOfDay(from) && to === addDays(from, 1)) {
    return a.toLocaleDateString([], { weekday: 'short', ...dateOpts });
  }
  const left = `${a.toLocaleDateString([], dateOpts)} ${a.toLocaleTimeString([], timeOpts)}`;
  const right = isSameDay(a, new Date((to - 1) * 1000))
    ? b.toLocaleTimeString([], timeOpts)
    : `${b.toLocaleDateString([], dateOpts)} ${b.toLocaleTimeString([], timeOpts)}`;
  return `${left} → ${right}`;
}

export function formatDuration(ms: number): string {
  if (!ms) return '0s';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
