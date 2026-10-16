import { useEffect, useRef } from 'react';
import type { ChannelInfo, FrequencyInfo } from '../types';
import { getTalkgroupColor } from '../utils/colors';

/**
 * ASCII "airwaves" backdrop. A fixed canvas behind the glass panels that
 * mirrors the trunked system: drifting static whose crackle follows tuning
 * error, a control-channel heartbeat along the bottom, and a radio-wave ring
 * whenever a voice channel keys up (coloured by talkgroup category; encrypted
 * calls scramble and lose their label).
 *
 * Purely decorative; the component reads live telemetry through a ref so the
 * animation loop never restarts on a poll.
 */

const CELL_W = 11;
const CELL_H = 18;
const FRAME_MS = 1000 / 15;
const RAMP = ' .·:-~=+*';
const RING_SPEED = 13; // cells per second
const RING_LIFE_S = 5;
const QUIET_AFTER_S = 300; // dim the field after this long with nothing on the air
const QUIET_LEVEL = 0.55;

export type BackdropMode = 'off' | 'subtle' | 'normal' | 'lively';
type Density = Exclude<BackdropMode, 'off'>;

/** How busy the field looks: ring strength, how many rings can coexist, static brightness. */
const DENSITY: Record<Density, { ring: number; maxRings: number; fieldBoost: number }> = {
  subtle: { ring: 0.6, maxRings: 4, fieldBoost: 0.6 },
  normal: { ring: 1, maxRings: 10, fieldBoost: 1 },
  lively: { ring: 1.3, maxRings: 16, fieldBoost: 1.35 },
};
const CYAN: Rgb = [0, 229, 255];
const SCRAMBLE = '▓▒░#%&';


type Rgb = [number, number, number];

interface Ring {
  x: number; // cells
  y: number;
  born: number; // seconds
  rgb: Rgb;
  label: string | null;
  scrambled: boolean;
}

export interface BackdropState {
  frequencies: Record<string, FrequencyInfo>;
  channels: ChannelInfo[];
  errorHz: number | null;
  connected: boolean;
}

interface Props {
  state: BackdropState;
  density?: Density;
  /** Follow mode: rings are only drawn for talkgroups this accepts. */
  accepts?: (tgid: number) => boolean;
  /** History mode: draw one still frame instead of animating. */
  frozen?: boolean;
}

function hash(ix: number, iy: number): number {
  let h = (ix * 374_761_393 + iy * 668_265_263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_295;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const f = (t: number) => t * t * (3 - 2 * t);
  const fx = f(x - ix);
  const fy = f(y - iy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Slow bands of static; most of the field stays empty. */
function staticField(col: number, row: number, t: number): number {
  const n = valueNoise(col * 0.055 + t * 0.06, row * 0.11 - t * 0.025) * 0.65
    + valueNoise(col * 0.13 - t * 0.09 + 40, row * 0.07 + t * 0.04 + 17) * 0.35;
  const v = (n - 0.5) / 0.32;
  return v <= 0 ? 0 : v >= 1 ? 1 : v * v;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function ringIntensity(dist: number, age: number): number {
  if (age < 0 || age > RING_LIFE_S) return 0;
  const d = dist - age * RING_SPEED;
  const life = 1 - age / RING_LIFE_S;
  return Math.exp(-(d * d) / 2.2) * life * life;
}

const STORE_KEY = 'op25tap.backdrop';

export const BACKDROP_MODES: BackdropMode[] = ['off', 'subtle', 'normal', 'lively'];

export function readBackdropMode(): BackdropMode {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'on') return 'normal'; // value written by the earlier on/off toggle
    if (saved && (BACKDROP_MODES as string[]).includes(saved)) return saved as BackdropMode;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return (navigator.hardwareConcurrency ?? 4) > 2 ? 'normal' : 'off';
}

export function saveBackdropMode(mode: BackdropMode): void {
  try {
    localStorage.setItem(STORE_KEY, mode);
  } catch {
    /* preference just won't persist */
  }
}

export function AsciiBackdrop({ state, frozen = false, density = 'normal', accepts }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const densityRef = useRef(DENSITY[density]);
  densityRef.current = DENSITY[density];
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let cols = 0;
    let rows = 0;
    let raf = 0;
    let last = 0;
    let rings: Ring[] = [];
    // Per-frequency memory so a ring spawns on key-up, not every frame.
    const keyed = new Map<string, number>();
    const ccCounters = new Map<string, number>();
    const blips: { col: number; born: number }[] = [];
    let lastActive = performance.now() / 1000;
    let dim = 1;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(window.innerWidth / CELL_W);
      rows = Math.ceil(window.innerHeight / CELL_H);
      schedule();
    };

    const put = (g: string, col: number, row: number, a: number, rgb: Rgb) => {
      if (a < 0.02) return;
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(a, 1).toFixed(3)})`;
      ctx.fillText(g, col * CELL_W, row * CELL_H);
    };

    /** Compare against the last poll: new key-ups spawn rings, cc hits spawn blips. */
    const observe = (t: number) => {
      const s = stateRef.current;
      const list = Object.values(s.frequencies);
      if (list.length === 0) return;
      const mhz = list.map((f) => f.freq);
      const lo = Math.min(...mhz);
      const span = Math.max(...mhz) - lo || 1;
      const encrypted = new Set(s.channels.filter((c) => c.encrypted && c.freq).map((c) => String(c.freq)));

      for (const f of list) {
        const key = String(f.freq);
        const lane = (f.freq - lo) / span; // 0..1 across the band
        const tg = f.active_tgid ?? 0;
        const prev = keyed.get(key) ?? 0;
        if (tg) lastActive = t;
        if (tg && tg !== prev && (acceptsRef.current?.(tg) ?? true)) {
          const enc = encrypted.has(key);
          const ring: Ring = {
            x: cols * (0.08 + lane * 0.84),
            y: rows * (0.22 + hash(f.freq, tg) * 0.5),
            born: t,
            rgb: enc ? [148, 163, 184] : hexToRgb(getTalkgroupColor(f.active_tag)),
            label: enc ? null : (f.active_tag || `TG ${tg}`),
            scrambled: enc,
          };
          rings = [...rings.slice(-(densityRef.current.maxRings - 1)), ring];
        }
        keyed.set(key, tg);

        const isCc = /control|cc/i.test(f.type);
        if (isCc) {
          const before = ccCounters.get(key);
          if (before !== undefined && f.counter > before) {
            blips.push({ col: Math.floor(cols * (0.1 + Math.random() * 0.8)), born: t });
          }
          ccCounters.set(key, f.counter);
        }
      }
    };

    const frame = (now: number, still: boolean) => {
      const s = stateRef.current;
      const t = still ? 37 : now / 1000;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = `${CELL_H - 4}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      if (!still) observe(t);

      // Ease toward a dimmer field once the system has been quiet for a while.
      const target = !still && t - lastActive > QUIET_AFTER_S ? QUIET_LEVEL : 1;
      dim += (target - dim) * 0.02;
      ctx.globalAlpha = dim;
      const d = densityRef.current;

      // Signal quality: a drifting error raises the crackle and brightness of the static.
      const err = s.errorHz === null ? 0 : Math.min(Math.abs(s.errorHz) / 600, 1);
      const tint: Rgb = s.connected ? CYAN : [248, 113, 113];
      const base = s.connected ? 0.5 : 0.35;

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const v = staticField(c, r, t);
          if (v <= 0) continue;
          const jitter = hash(c * 7 + Math.floor(t * 6), r * 13 - Math.floor(t * 4));
          const lift = jitter < 0.2 + err * 0.25 ? -1 : jitter > 0.8 - err * 0.25 ? 1 : 0;
          const i = Math.max(0, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length) + lift));
          const g = RAMP[i];
          if (g === ' ') continue;
          put(g, c, r, (0.07 + v * 0.22 + err * 0.12) * base * 2 * d.fieldBoost, tint);
        }
      }

      // Control channel heartbeat: a dotted carrier along the bottom with blips riding it.
      const hbRow = rows - 2;
      if (hbRow > 2) {
        const alive = s.connected;
        for (let c = 0; c < cols; c += 1) {
          const wave = alive ? 0.5 + 0.5 * Math.sin(c * 0.35 - t * 3) : 0;
          put(alive ? (wave > 0.85 ? '·' : '.') : '-', c, hbRow, alive ? 0.1 + wave * 0.1 : 0.12, alive ? CYAN : [248, 113, 113]);
        }
        for (let b = blips.length - 1; b >= 0; b -= 1) {
          const age = t - blips[b].born;
          if (age > 2.5) {
            blips.splice(b, 1);
            continue;
          }
          const a = (1 - age / 2.5) * 0.55;
          put('◆', blips[b].col, hbRow, a, CYAN);
          put('|', blips[b].col, hbRow - 1, a * 0.6, CYAN);
        }
      }

      // Call rings.
      rings = rings.filter((ring) => t - ring.born <= RING_LIFE_S);
      for (const ring of rings) {
        const age = t - ring.born;
        const reach = age * RING_SPEED + 4;
        const x0 = Math.max(0, Math.floor(ring.x - reach));
        const x1 = Math.min(cols - 1, Math.ceil(ring.x + reach));
        const y0 = Math.max(0, Math.floor(ring.y - reach / 1.7));
        const y1 = Math.min(rows - 1, Math.ceil(ring.y + reach / 1.7));
        for (let r = y0; r <= y1; r += 1) {
          for (let c = x0; c <= x1; c += 1) {
            const dx = c - ring.x;
            const dy = (r - ring.y) * (CELL_H / CELL_W);
            const a = ringIntensity(Math.hypot(dx, dy), age);
            if (a < 0.06) continue;
            const g = ring.scrambled
              ? SCRAMBLE[Math.floor(hash(c + Math.floor(t * 8), r) * SCRAMBLE.length)]
              : Math.abs(dy) > Math.abs(dx) * 2.2 ? '~' : dx < 0 ? '(' : ')';
            put(g, c, r, a * d.ring, ring.rgb);
          }
        }
        if (ring.label) {
          const life = 1 - age / RING_LIFE_S;
          const text = ring.label.slice(0, 22);
          const start = Math.round(ring.x - text.length / 2);
          for (let i = 0; i < text.length; i += 1) {
            put(text[i], start + i, Math.round(ring.y), Math.min(1, life * 1.6) * 0.75, ring.rgb);
          }
        }
        put('◉', Math.round(ring.x), Math.round(ring.y) + 1, (1 - age / RING_LIFE_S) * 0.8, ring.rgb);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      frame(now, false);
    };

    function schedule() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (reducedQuery.matches || frozenRef.current || document.hidden) {
        frame(performance.now(), true);
        return;
      }
      last = 0;
      raf = requestAnimationFrame(loop);
    }

    // Pick up History/Live changes without restarting the effect.
    const watch = window.setInterval(() => {
      const shouldRun = !(reducedQuery.matches || frozenRef.current || document.hidden);
      if (shouldRun !== (raf !== 0)) schedule();
    }, 500);

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', schedule);
    reducedQuery.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(watch);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', schedule);
      reducedQuery.removeEventListener('change', schedule);
    };
  }, []);

  return <canvas ref={canvasRef} className="ascii-backdrop" aria-hidden="true" />;
}
