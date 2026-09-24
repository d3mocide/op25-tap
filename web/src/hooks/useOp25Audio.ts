import { useEffect, useRef, useState } from 'react';

const WS_AUDIO_SAMPLE_RATE = 8000;

export function useOp25Audio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [audioConnected, setAudioConnected] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Int16Array[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const playQueue = () => {
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !gain || !isPlayingRef.current || queueRef.current.length === 0) return;

    if (nextPlayTimeRef.current < ctx.currentTime) {
      nextPlayTimeRef.current = ctx.currentTime + 0.02;
    } else if (nextPlayTimeRef.current > ctx.currentTime + 0.35) {
      nextPlayTimeRef.current = ctx.currentTime + 0.02;
    }

    while (queueRef.current.length > 0) {
      const samples = queueRef.current.shift()!;
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
  };

  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use our FastAPI /ws/audio proxy which forwards to ws://<op25-host>:9000
    const wsUrl = `${protocol}//${window.location.host}/ws/audio`;
    console.log('[OP25 Audio] Connecting to raw PCM WebSocket audio:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[OP25 Audio] Connected to port 9000 PCM audio stream');
        setAudioConnected(true);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.cmd === 'audio_drain' || msg.cmd === 'audio_drop') {
              queueRef.current = [];
              nextPlayTimeRef.current = 0;
            }
          } catch (e) {
            // Ignore non-json control text
          }
        } else if (event.data instanceof ArrayBuffer) {
          if (isPlayingRef.current) {
            queueRef.current.push(new Int16Array(event.data));
            playQueue();
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

    queueRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsPlaying(true);
    isPlayingRef.current = true;

    // 2. Connect to WebSocket
    connectWebSocket();
  };

  const stopAudio = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    queueRef.current = [];
    nextPlayTimeRef.current = 0;
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
