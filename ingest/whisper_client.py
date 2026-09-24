import logging
import os
import queue
import threading
import time
from typing import Callable, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv
import requests

from db import update_event_transcript

load_dotenv()
logger = logging.getLogger("op25-whisper")


class WhisperDispatcher:
    """
    Asynchronous transcription dispatcher that submits call audio to a remote Whisper service.
    Target: Standard OpenAI-compatible `/v1/audio/transcriptions` API or standard Whisper HTTP endpoint.
    """

    def __init__(
        self,
        endpoint_url: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        language: Optional[str] = None,
        timeout: float = 25.0,
        on_transcript: Optional[Callable[[int, str, Optional[str]], None]] = None,
    ):
        self.endpoint_url = endpoint_url or os.environ.get("WHISPER_URL", "")
        self.model = model or os.environ.get("WHISPER_MODEL", "base.en")
        self.api_key = api_key or os.environ.get("WHISPER_API_KEY", "")
        self.language = language or os.environ.get("WHISPER_LANGUAGE", "en")
        try:
            self.timeout = float(os.environ.get("WHISPER_TIMEOUT", timeout))
        except ValueError:
            self.timeout = timeout

        self.on_transcript = on_transcript
        self._queue: queue.Queue = queue.Queue(maxsize=100)
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None

        if self.is_configured():
            logger.info(f"Whisper dispatcher configured for {self.endpoint_url} (model={self.model})")
        else:
            logger.info("Whisper dispatcher idle (WHISPER_URL not configured).")

    def is_configured(self) -> bool:
        return bool(self.endpoint_url and self.endpoint_url.strip())

    def start(self):
        if self._worker_thread is not None and self._worker_thread.is_alive():
            return
        self._stop_event.clear()
        self._worker_thread = threading.Thread(
            target=self._worker_loop,
            name="whisper-transcribe-worker",
            daemon=True,
        )
        self._worker_thread.start()

    def stop(self):
        self._stop_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._queue.put(None)  # Wake up worker
            self._worker_thread.join(timeout=2.0)
            self._worker_thread = None

    def enqueue_call(self, event_id: int, wav_bytes: bytes, audio_file: Optional[str] = None):
        """Enqueue call WAV audio for asynchronous transcription."""
        if not self.is_configured():
            # If not configured, we still record audio_file in database if available
            if audio_file:
                try:
                    update_event_transcript(event_id, "", audio_file=audio_file)
                except Exception as e:
                    logger.debug(f"Could not record audio file in db: {e}")
            return

        try:
            self._queue.put_nowait((event_id, wav_bytes, audio_file))
        except queue.Full:
            logger.warning(f"Whisper queue full, dropping transcription for event {event_id}")

    def _worker_loop(self):
        logger.info("Whisper background worker running.")
        while not self._stop_event.is_set():
            try:
                item = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue

            if item is None:
                break

            event_id, wav_bytes, audio_file = item
            try:
                self._transcribe_sync(event_id, wav_bytes, audio_file)
            except Exception as e:
                logger.error(f"Error during transcription for event {event_id}: {e}")
            finally:
                self._queue.task_done()

    def _transcribe_sync(self, event_id: int, wav_bytes: bytes, audio_file: Optional[str]):
        if not wav_bytes or len(wav_bytes) < 100:
            return

        t0 = time.time()
        files = {
            "file": ("call.wav", wav_bytes, "audio/wav"),
        }
        data = {
            "model": self.model,
        }
        if self.language:
            data["language"] = self.language

        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        logger.debug(f"Submitting {len(wav_bytes)} bytes WAV to Whisper ({self.endpoint_url}) for event {event_id}...")
        try:
            resp = requests.post(
                self.endpoint_url,
                files=files,
                data=data,
                headers=headers,
                timeout=self.timeout,
            )
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            logger.warning(f"Whisper request failed for event {event_id}: {e}")
            return

        elapsed = time.time() - t0
        text = ""
        try:
            res_json = resp.json()
            if isinstance(res_json, dict):
                text = res_json.get("text") or res_json.get("transcription") or ""
            elif isinstance(res_json, str):
                text = res_json
        except Exception:
            text = resp.text or ""

        text = text.strip()
        if not text:
            logger.debug(f"Whisper returned empty transcript for event {event_id} ({elapsed:.2f}s)")
            return

        logger.info(f"[Whisper] Event {event_id} ({elapsed:.2f}s): \"{text}\"")

        # Update database
        try:
            update_event_transcript(event_id, text, audio_file=audio_file)
        except Exception as e:
            logger.error(f"Failed to update transcript in db for event {event_id}: {e}")

        # Notify callback / WebSocket broadcast
        if self.on_transcript:
            try:
                self.on_transcript(event_id, text, audio_file)
            except Exception as e:
                logger.error(f"Error in on_transcript callback: {e}")
