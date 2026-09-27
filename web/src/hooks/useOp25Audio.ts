import { useEffect, useRef, useState } from 'react';

const WS_AUDIO_SAMPLE_RATE = 8000;
const CALL_GAP_MS = 2500;    // no frames this long ends a call (backup to audio_drain)
const MAX_HOLD_MS = 90_000;  // a held call older than this is stale: drop it

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
  const nextPlayTimeRef = useRef<number>(0);
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
    nextPlayTimeRef.current = 0;
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

  // Schedule the active receiver's buffered frames back to back.
  const flush = () => {
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    const ch = activeRef.current;
    if (!ctx || !gain || ch === null) return;
    const rx = receiver(ch);
    if (nextPlayTimeRef.current < ctx.currentTime) {
      nextPlayTimeRef.current = ctx.currentTime + 0.05;
    }
    while (rx.frames.length > 0) {
      const samples = rx.frames.shift()!;
      const buffer = ctx.createBuffer(1, samples.length, WS_AUDIO_SAMPLE_RATE);
      const channelData = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        channelData[i] = samples[i] / 32768.0;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
    }
    if (!rx.onAir) scheduleAdvance();
  };

  // Once the active call has ended and finished playing, move to the next held one.
  const scheduleAdvance = () => {
    const ctx = audioCtxRef.current;
    if (!ctx || advanceTimerRef.current) return;
    const waitMs = Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000);
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
        nextPlayTimeRef.current = 0;
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
    }
    rx.lastFrameAt = Date.now();
    rx.frames.push(samples);
    if (activeRef.current === null) {
      activeRef.current = ch;
      nextPlayTimeRef.current = 0;
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
    if (ch === activeRef.current) scheduleAdvance();
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

  // Backup for a lost audio_drain: a receiver silent this long has ended its call.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      receiversRef.current.forEach((rx, ch) => {
        if (rx.onAir && now - rx.lastFrameAt > CALL_GAP_MS) onCallEnd(ch);
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const startAudio = async () => {
    // 1. Initialize AudioContext on user interaction
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      let ctx: AudioContext;
      try {
        ctx = new AudioCtxClass({ sampleRate: WS_AUDIO_SAMPLE_RATE });
      } catch (e) {
        ctx = new AudioCtxClass();
      }
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
