import { useEffect, useRef, useState } from 'react';
import { Upsampler } from './upsample';

const WS_AUDIO_SAMPLE_RATE = 8000;
const CALL_GAP_MS = 2500;    // no frames this long ends a call (backup to audio_drain)
const MAX_HOLD_MS = 90_000;  // a held call older than this is stale: drop it
// Upsample and schedule only this far ahead of playback: a held call can carry
// a minute of backlog, and converting it in one go stalls the page.
const AHEAD_S = 1.0;
const LEAD_S = 0.05;         // start a call this far ahead of now

type Receiver = {
  frames: Int16Array[];   // received, not yet scheduled
  onAir: boolean;         // a call is in progress on this receiver
  callStartedAt: number;
  lastFrameAt: number;
};

export function useOp25Audio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [audioConnected, setAudioConnected] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Where the next audio goes, in whole context sample frames. Audio is
  // upsampled to the context rate here (upsample.ts): browsers resample 8 kHz
  // buffers by linear interpolation, which sounds gritty and "digital".
  const nextFrameRef = useRef<number>(0);
  const upRef = useRef<Upsampler | null>(null);
  const tailDoneRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // With two receivers OP25 follows two calls at once. Play one call at a
  // time: the receiver on air plays live, the other one's call is buffered
  // and played right after, so calls never talk over each other.
  const receiversRef = useRef<Map<number, Receiver>>(new Map());
  const activeRef = useRef<number | null>(null);
  const waitingRef = useRef<number[]>([]);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetPlayback = () => {
    receiversRef.current = new Map();
    activeRef.current = null;
    waitingRef.current = [];
    nextFrameRef.current = 0;
    upRef.current = null;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };

  const receiver = (ch: number): Receiver => {
    let rx = receiversRef.current.get(ch);
    if (!rx) {
      rx = { frames: [], onAir: false, callStartedAt: 0, lastFrameAt: 0 };
      receiversRef.current.set(ch, rx);
    }
    return rx;
  };

  // Queue already-upsampled audio right after what is scheduled.
  const play = (ctx: AudioContext, gain: GainNode, samples: Float32Array<ArrayBuffer>) => {
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const now = Math.ceil(ctx.currentTime * ctx.sampleRate);
    if (nextFrameRef.current < now) nextFrameRef.current = now + Math.round(LEAD_S * ctx.sampleRate);  // underrun
    source.start(nextFrameRef.current / ctx.sampleRate);
    nextFrameRef.current += samples.length;
  };

  // Schedule the active receiver's buffered frames, up to AHEAD_S ahead.
  const flush = () => {
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    const ch = activeRef.current;
    if (!ctx || !gain || ch === null) return;
    const rx = receiver(ch);
    if (!upRef.current) upRef.current = new Upsampler(WS_AUDIO_SAMPLE_RATE, ctx.sampleRate);
    const horizon = (ctx.currentTime + AHEAD_S) * ctx.sampleRate;
    while (rx.frames.length > 0 && nextFrameRef.current < horizon) {
      const samples = rx.frames.shift()!;
      const f = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32768.0;
      play(ctx, gain, upRef.current.push(f));
    }
    if (!rx.onAir && rx.frames.length === 0) {
      if (!tailDoneRef.current) {
        tailDoneRef.current = true;
        play(ctx, gain, upRef.current.flush());
      }
      scheduleAdvance();
    }
  };

  // Once the active call has ended and finished playing, move to the next held one.
  const scheduleAdvance = () => {
    const ctx = audioCtxRef.current;
    if (!ctx || advanceTimerRef.current) return;
    const waitMs = Math.max(0, (nextFrameRef.current / ctx.sampleRate - ctx.currentTime) * 1000);
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      const ch = activeRef.current;
      if (ch !== null && (receiver(ch).onAir || receiver(ch).frames.length > 0)) return;
      activeRef.current = null;
      const now = Date.now();
      while (waitingRef.current.length > 0) {
        const next = waitingRef.current.shift()!;
        const rx = receiver(next);
        if (now - rx.callStartedAt > MAX_HOLD_MS) {
          rx.frames = [];
          continue;
        }
        activeRef.current = next;
        upRef.current = null;          // a fresh upsampler per call
        tailDoneRef.current = false;
        flush();
        return;
      }
    }, waitMs);
  };

  const onFrame = (ch: number, samples: Int16Array) => {
    const rx = receiver(ch);
    if (!rx.onAir) {
      rx.onAir = true;
      rx.callStartedAt = Date.now();
      if (ch === activeRef.current) tailDoneRef.current = false;   // same receiver, next call
    }
    rx.lastFrameAt = Date.now();
    rx.frames.push(samples);
    if (activeRef.current === null) {
      activeRef.current = ch;
      upRef.current = null;
      tailDoneRef.current = false;
    }
    if (ch === activeRef.current) {
      flush();
    } else if (!waitingRef.current.includes(ch)) {
      waitingRef.current.push(ch);
    }
  };

  const onCallEnd = (ch: number) => {
    const rx = receiver(ch);
    rx.onAir = false;
    if (ch === activeRef.current) flush();
  };

  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Our FastAPI /ws/audio relay: every OP25 receiver, each frame prefixed
    // with its receiver number.
    const wsUrl = `${protocol}//${window.location.host}/ws/audio`;
    console.log('[OP25 Audio] Connecting to raw PCM WebSocket audio:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[OP25 Audio] Connected to OP25 PCM audio relay');
        setAudioConnected(true);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.cmd === 'audio_drain' || msg.cmd === 'audio_drop') {
              onCallEnd(msg.ch ?? 0);
            }
          } catch (e) {
            // Ignore non-json control text
          }
        } else if (event.data instanceof ArrayBuffer && event.data.byteLength > 1) {
          if (isPlayingRef.current) {
            const ch = new Uint8Array(event.data, 0, 1)[0];
            onFrame(ch, new Int16Array(event.data.slice(1)));
          }
        }
      };

      ws.onclose = () => {
        setAudioConnected(false);
        wsRef.current = null;
        if (isPlayingRef.current) {
          // Reconnect if user wanted audio playing
          setTimeout(connectWebSocket, 2000);
        }
      };

      ws.onerror = (err) => {
        console.warn('[OP25 Audio] WebSocket error:', err);
      };
    } catch (e) {
      console.warn('[OP25 Audio] WebSocket init error:', e);
    }
  };

  // Keep scheduling a held backlog as playback advances, and end calls whose
  // audio_drain got lost (a receiver silent this long has ended its call).
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      receiversRef.current.forEach((rx, ch) => {
        if (rx.onAir && now - rx.lastFrameAt > CALL_GAP_MS) onCallEnd(ch);
      });
      if (isPlayingRef.current) flush();
    }, 100);
    return () => clearInterval(id);
  }, []);

  const startAudio = async () => {
    // 1. Initialize AudioContext on user interaction
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      // Native rate: audio is upsampled to it here (see flush).
      const ctx: AudioContext = new AudioCtxClass();
      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : volume;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
    }

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    resetPlayback();
    setIsPlaying(true);
    isPlayingRef.current = true;

    // 2. Connect to WebSocket
    connectWebSocket();
  };

  const stopAudio = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    resetPlayback();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      startAudio();
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : newVol;
    }
    if (newVol === 0) setIsMuted(true);
    else if (isMuted) setIsMuted(false);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = nextMuted ? 0 : volume;
    }
  };

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return {
    isPlaying,
    isMuted,
    volume,
    audioConnected,
    togglePlay,
    toggleMute,
    setVolume: handleVolumeChange,
  };
}
