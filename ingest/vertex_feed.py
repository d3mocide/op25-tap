"""
Vertex call feed — show Vertex's P25 call log as op25-tap's voice intercepts.

Vertex records every call OP25 follows straight from the port-9000 audio
websocket and transcribes it. When VERTEX_URL and VERTEX_API_KEY are set,
op25-tap reads that log instead of recording and transcribing the same calls
a second time: each Vertex recording becomes one "Voice Intercept" event with
its transcript and audio, so nothing has to be matched against op25-tap's own
trunking events.
"""
import logging
import os
import threading
import time
from datetime import datetime
from typing import Any, Callable, Optional

import requests

from db import DATA_DIR, db, upsert_system

logger = logging.getLogger("op25-vertex")

EVENT_TYPE = "Voice Intercept"


def vertex_configured() -> bool:
    return bool(os.environ.get("VERTEX_URL") and os.environ.get("VERTEX_API_KEY"))


class VertexFeed:
    def __init__(self, event_callback: Optional[Callable[[str, Any], None]] = None):
        self.base = os.environ.get("VERTEX_URL", "").rstrip("/")
        self.headers = {"X-API-Key": os.environ.get("VERTEX_API_KEY", "")}
        self.interval = float(os.environ.get("VERTEX_POLL_SECONDS", "5"))
        self.backfill_hours = int(os.environ.get("VERTEX_BACKFILL_HOURS", "2"))
        self.system_name = os.environ.get("OP25_SYSTEM_NAME", "P25")
        self.event_callback = event_callback
        self.audio_dir = DATA_DIR / "audio_calls"
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self):
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._run, name="vertex-feed", daemon=True)
        self._thread.start()
        logger.info(f"Voice intercepts from Vertex at {self.base} (every {self.interval:.0f}s)")

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            try:
                self.sync()
            except Exception as e:
                logger.warning(f"Vertex feed poll failed: {e}")
            self._stop.wait(self.interval)

    def sync(self):
        resp = requests.get(f"{self.base}/api/v1/radio/recordings",
                            params={"hours": self.backfill_hours, "limit": 200},
                            headers=self.headers, timeout=15)
        resp.raise_for_status()
        recs = sorted(resp.json(), key=lambda r: r.get("started_at") or "")
        sys_id = upsert_system(self.system_name)
        c = db()
        for rec in recs:
            key = f"vertex:{rec['id']}"
            row = c.execute("SELECT id, transcript FROM events WHERE event_id=?", (key,)).fetchone()
            text = rec.get("transcription")
            if row is None:
                self._add(c, sys_id, key, rec, text)
            elif row["transcript"] is None and text is not None:
                c.execute("UPDATE events SET transcript=? WHERE id=?", (text, row["id"]))
                self._emit("transcript", {"id": row["id"], "transcript": text, "has_audio": True})

    def _add(self, c, sys_id: int, key: str, rec: dict, text: Optional[str]):
        try:
            ts = datetime.fromisoformat(rec["started_at"]).timestamp()
        except (KeyError, TypeError, ValueError):
            return
        audio = requests.get(f"{self.base}/api/v1/radio/recordings/{rec['id']}/file",
                             headers=self.headers, timeout=30)
        if audio.status_code != 200:
            return                                   # file gone (retention); skip rather than show a dead row
        dur_ms = int(round((rec.get("duration_s") or 0) * 1000))
        cur = c.execute(
            """INSERT OR IGNORE INTO events(ts, system_id, protocol, event_type, to_tgid,
                   duration_ms, event_id, encrypted, transcript)
               VALUES (?,?,?,?,?,?,?,0,?)""",
            (ts, sys_id, "P25", EVENT_TYPE, rec.get("tgid") or None, dur_ms, key, text))
        if cur.rowcount == 0:
            return
        row_id = cur.lastrowid
        rel = f"audio_calls/{row_id}.wav"
        (DATA_DIR / rel).write_bytes(audio.content)
        c.execute("UPDATE events SET audio_file=? WHERE id=?", (rel, row_id))
        self._emit("event", {
            "id": row_id, "ts": ts, "system": self.system_name, "type": EVENT_TYPE,
            "from": None, "to_tg": rec.get("tgid"), "tg_tag": rec.get("tag") or "",
            "freq": None, "duration_ms": dur_ms, "encrypted": False, "details": "",
        })
        # The live feed shows a row once it has audio or a transcript.
        self._emit("transcript", {"id": row_id, "transcript": text, "has_audio": True})

    def _emit(self, name: str, payload: Any):
        if self.event_callback:
            try:
                self.event_callback(name, payload)
            except Exception as e:
                logger.error(f"Vertex feed broadcast error: {e}")
