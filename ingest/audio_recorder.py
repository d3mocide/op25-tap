import asyncio
from collections import deque
import io
import logging
import os
from pathlib import Path
import threading
import time
from typing import Deque, Dict, Optional, Tuple
from urllib.parse import urlparse
import wave

from dotenv import load_dotenv
import websockets

from db import DATA_DIR
from ingest.whisper_client import WhisperDispatcher

load_dotenv()
logger = logging.getLogger("op25-audio")

SAMPLE_RATE = 8000
SAMPLE_WIDTH = 2  # 16-bit
CHANNELS = 1      # mono
BYTES_PER_SECOND = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS  # 16,000 bytes/sec
PRE_ROLL_SECONDS = 0.5  # include 0.5s before call officially opened
PRE_ROLL_BYTES = int(BYTES_PER_SECOND * PRE_ROLL_SECONDS)
MIN_CALL_AUDIO_BYTES = int(BYTES_PER_SECOND * 0.4)  # Ignore blips under 0.4s


def pcm_to_wav_bytes(pcm_data: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Convert raw 16-bit PCM bytes to standard WAV bytes with RIFF header."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)
    return buf.getvalue()


class AudioRecorder:
    """
    Background worker that connects to OP25's port 9000 raw PCM WebSocket,
    maintains a rolling retention window, extracts per-call audio snippets,
    saves retained WAV files, and enqueues audio for Whisper transcription.
    """

    def __init__(
        self,
        audio_ws_url: Optional[str] = None,
        whisper_dispatcher: Optional[WhisperDispatcher] = None,
        retention_hours: Optional[float] = None,
    ):
        self.audio_ws_url = audio_ws_url or os.environ.get("OP25_AUDIO_WS")
        if not self.audio_ws_url:
            target_url = os.environ.get("OP25_URL", "http://127.0.0.1:8080/")
            p = urlparse(target_url)
            host = p.hostname or "127.0.0.1"
            self.audio_ws_url = f"ws://{host}:9000"

        self.whisper_dispatcher = whisper_dispatcher
        try:
            self.retention_hours = float(os.environ.get("WHISPER_RETENTION_HOURS", retention_hours or 24.0))
        except ValueError:
            self.retention_hours = 24.0

        self.audio_dir = DATA_DIR / "audio_calls"
        self.audio_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        # Rolling ring buffer for pre-roll (stores (timestamp, bytes))
        self._ring_buffer: Deque[bytes] = deque()
        self._ring_buffer_bytes = 0
        self._max_ring_bytes = BYTES_PER_SECOND * 30  # 30 seconds rolling buffer

        # Active call buffers: event_id -> list of PCM bytes chunks
        self._active_calls: Dict[int, list] = {}
        # Track latest active event_id for unassociated audio
        self._current_event_id: Optional[int] = None
        self._last_audio_ts: float = 0.0

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="op25-audio-recorder",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"Started OP25 audio recorder against {self.audio_ws_url}")

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
            self._thread = None

    def start_call(self, event_id: int):
        """Called when Op25Poller opens an active call."""
        with self._lock:
            self._current_event_id = event_id
            # Pull pre-roll audio from ring buffer
            pre_roll_chunks = []
            needed = PRE_ROLL_BYTES
            for chunk in reversed(self._ring_buffer):
                pre_roll_chunks.append(chunk)
                needed -= len(chunk)
                if needed <= 0:
                    break
            pre_roll_chunks.reverse()

            self._active_calls[event_id] = pre_roll_chunks

    def end_call(self, event_id: int):
        """Called when Op25Poller closes an active call."""
        with self._lock:
            chunks = self._active_calls.pop(event_id, None)
            if self._current_event_id == event_id:
                self._current_event_id = None

        if not chunks:
            return

        pcm_data = b"".join(chunks)
        if len(pcm_data) < MIN_CALL_AUDIO_BYTES:
            logger.debug(f"Call {event_id} audio too short ({len(pcm_data)} bytes), skipping transcription.")
            return

        wav_bytes = pcm_to_wav_bytes(pcm_data)
        audio_filename = f"{event_id}.wav"
        audio_path = self.audio_dir / audio_filename

        # Save to disk if retention is positive
        saved_rel_path = None
        if self.retention_hours > 0:
            try:
                audio_path.write_bytes(wav_bytes)
                saved_rel_path = f"audio_calls/{audio_filename}"
            except Exception as e:
                logger.warning(f"Could not write call audio file {audio_path}: {e}")

        # Enqueue for Whisper transcription
        if self.whisper_dispatcher:
            self.whisper_dispatcher.enqueue_call(event_id, wav_bytes, audio_file=saved_rel_path)

        # Trigger background prune of old files
        self._prune_old_audio()

    def _prune_old_audio(self):
        """Prune WAV files exceeding retention_hours."""
        if self.retention_hours <= 0:
            return
        now = time.time()
        max_age_sec = self.retention_hours * 3600
        try:
            for p in self.audio_dir.glob("*.wav"):
                try:
                    if now - p.stat().st_mtime > max_age_sec:
                        p.unlink(missing_ok=True)
                except OSError:
                    pass
        except Exception as e:
            logger.debug(f"Audio pruning error: {e}")

    def _handle_pcm_frame(self, data: bytes):
        now = time.time()
        self._last_audio_ts = now
        with self._lock:
            # Append to rolling ring buffer
            self._ring_buffer.append(data)
            self._ring_buffer_bytes += len(data)
            while self._ring_buffer_bytes > self._max_ring_bytes and self._ring_buffer:
                discarded = self._ring_buffer.popleft()
                self._ring_buffer_bytes -= len(discarded)

            # Append to currently active call(s)
            for eid, chunks in self._active_calls.items():
                chunks.append(data)

    def _handle_control_message(self, text: str):
        # OP25 emits e.g. {"cmd": "audio_drain"} or {"cmd": "audio_drop"}
        if "audio_drain" in text or "audio_drop" in text:
            # Silence/drain marker
            pass

    def _run_loop(self):
        """Asyncio runner inside background thread."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._websocket_worker())
        finally:
            loop.close()

    async def _websocket_worker(self):
        while not self._stop_event.is_set():
            try:
                logger.info(f"Connecting to OP25 audio stream at {self.audio_ws_url}...")
                async with websockets.connect(self.audio_ws_url, open_timeout=8) as ws:
                    logger.info("Connected to OP25 port 9000 raw PCM audio stream.")
                    while not self._stop_event.is_set():
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        except asyncio.TimeoutError:
                            continue

                        if isinstance(msg, bytes):
                            self._handle_pcm_frame(msg)
                        elif isinstance(msg, str):
                            self._handle_control_message(msg)
            except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                logger.debug(f"Audio WebSocket connection notice: {e}. Reconnecting in 3s...")
                await asyncio.sleep(3.0)
            except Exception as e:
                logger.warning(f"Audio WebSocket unexpected error: {e}. Reconnecting in 3s...")
                await asyncio.sleep(3.0)
