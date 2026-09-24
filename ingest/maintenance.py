"""
Background maintenance: daily rollups, data retention and storage stats.

Each cycle:
  1. Rebuild daily_* rollups for every day that still has raw events and is not
     rolled up yet, plus today and yesterday (calls can still close/merge).
  2. Purge raw history (events, affiliations, roaming, anomalies) older than
     RETENTION_DAYS. The cutoff is aligned to local midnight so a day is either
     fully retained or fully purged -- its rollup is always built from complete
     data and is never recomputed from a partial day.
  3. Delete call audio older than AUDIO_RETENTION_HOURS plus orphaned WAVs.
  4. Return freed pages to the OS (incremental vacuum).
"""
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from db import CALL_EVENT_FILTER, DATA_DIR, DB_PATH, _connect

logger = logging.getLogger("op25-maintenance")

PURGE_TABLES = ("events", "affiliations", "roaming", "anomalies")
PURGE_CHUNK = 5000
ORPHAN_MIN_AGE_SEC = 600  # a just-written WAV may not be committed to the DB yet


def _env_float(names, default: float) -> float:
    for name in names:
        raw = os.environ.get(name)
        if raw not in (None, ""):
            try:
                return float(raw)
            except ValueError:
                logger.warning(f"Ignoring invalid {name}={raw!r}")
    return default


def retention_days() -> float:
    return _env_float(["RETENTION_DAYS"], 30.0)


def audio_retention_hours() -> float:
    # WHISPER_RETENTION_HOURS is the pre-retention-policy name, still honored.
    return _env_float(["AUDIO_RETENTION_HOURS", "WHISPER_RETENTION_HOURS"], 168.0)


def day_bounds(day: date) -> Tuple[float, float]:
    """Epoch [start, end) of a local calendar day (DST-safe)."""
    start = datetime(day.year, day.month, day.day).timestamp()
    nxt = day + timedelta(days=1)
    return start, datetime(nxt.year, nxt.month, nxt.day).timestamp()


def local_day(ts: float) -> date:
    return datetime.fromtimestamp(ts).date()


def purge_cutoff(now: float, days: float) -> Optional[float]:
    """Local midnight `days` days before today, or None when retention is off."""
    if days <= 0:
        return None
    return day_bounds(local_day(now) - timedelta(days=int(days)))[0]


def rollup_day(conn, day: date):
    """Rebuild all daily_* rows for one local day from raw events (idempotent)."""
    start, end = day_bounds(day)
    d = day.isoformat()
    where = f"e.ts >= ? AND e.ts < ? AND e.system_id IS NOT NULL AND {CALL_EVENT_FILTER}"
    conn.execute("BEGIN IMMEDIATE")
    try:
        for table in ("daily_system_stats", "daily_tg_stats", "daily_rid_stats"):
            conn.execute(f"DELETE FROM {table} WHERE day=?", (d,))
        conn.execute(
            f"""INSERT INTO daily_tg_stats(day, system_id, tgid, calls, airtime_ms, encrypted_calls, unique_rids)
                SELECT ?, e.system_id, e.to_tgid, COUNT(*), COALESCE(SUM(e.duration_ms), 0),
                       SUM(e.encrypted > 0), COUNT(DISTINCT e.from_rid)
                FROM events e WHERE {where}
                GROUP BY e.system_id, e.to_tgid""",
            (d, start, end))
        conn.execute(
            f"""INSERT INTO daily_rid_stats(day, system_id, rid, calls, airtime_ms)
                SELECT ?, e.system_id, e.from_rid, COUNT(*), COALESCE(SUM(e.duration_ms), 0)
                FROM events e WHERE {where} AND e.from_rid IS NOT NULL AND e.from_rid != 0
                GROUP BY e.system_id, e.from_rid""",
            (d, start, end))
        conn.execute(
            f"""INSERT INTO daily_system_stats(day, system_id, calls, airtime_ms, encrypted_calls,
                                               unique_rids, unique_tgs)
                SELECT ?, e.system_id, COUNT(*), COALESCE(SUM(e.duration_ms), 0), SUM(e.encrypted > 0),
                       COUNT(DISTINCT NULLIF(e.from_rid, 0)), COUNT(DISTINCT e.to_tgid)
                FROM events e WHERE {where}
                GROUP BY e.system_id""",
            (d, start, end))
        conn.execute(
            """INSERT INTO daily_system_stats(day, system_id, anomalies)
               SELECT ?, system_id, COUNT(*) FROM anomalies
               WHERE ts >= ? AND ts < ? AND system_id IS NOT NULL
               GROUP BY system_id
               ON CONFLICT(day, system_id) DO UPDATE SET anomalies=excluded.anomalies""",
            (d, start, end))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def rollup_pending(conn, now: float) -> int:
    """Roll up today, yesterday and any older retained day with no rollup yet."""
    row = conn.execute("SELECT MIN(ts) FROM events").fetchone()
    if row[0] is None:
        return 0
    today = local_day(now)
    day = min(local_day(row[0]), today)
    n = 0
    while day <= today:
        recent = (today - day).days <= 1
        if recent or not conn.execute(
                "SELECT 1 FROM daily_system_stats WHERE day=? LIMIT 1", (day.isoformat(),)).fetchone():
            rollup_day(conn, day)
            n += 1
        day += timedelta(days=1)
    return n


def purge_before(conn, cutoff: float) -> Dict[str, int]:
    """Delete raw history older than `cutoff` in small batches so the poller never waits long."""
    deleted = {}
    for table in PURGE_TABLES:
        total = 0
        while True:
            n = conn.execute(
                f"DELETE FROM {table} WHERE id IN (SELECT id FROM {table} WHERE ts < ? LIMIT ?)",
                (cutoff, PURGE_CHUNK)).rowcount
            total += n
            if n < PURGE_CHUNK:
                break
            time.sleep(0.02)
        deleted[table] = total
    return deleted


def prune_audio(conn, now: float, hours: float, sweep_orphans: bool = True) -> int:
    """Delete call WAVs past audio retention (and orphans), clearing events.audio_file."""
    audio_dir = DATA_DIR / "audio_calls"
    removed = 0
    if hours > 0:
        cutoff = now - hours * 3600
        rows = conn.execute(
            "SELECT id, audio_file FROM events WHERE audio_file IS NOT NULL AND ts < ?", (cutoff,)).fetchall()
        for r in rows:
            (DATA_DIR / r["audio_file"]).unlink(missing_ok=True)
            removed += 1
        if rows:
            conn.execute("UPDATE events SET audio_file=NULL WHERE audio_file IS NOT NULL AND ts < ?", (cutoff,))

    if sweep_orphans and audio_dir.exists():
        # WAVs whose event was purged, or that were never linked to an event.
        for p in audio_dir.glob("*.wav"):
            try:
                if now - p.stat().st_mtime < ORPHAN_MIN_AGE_SEC:
                    continue
                linked = p.stem.isdigit() and conn.execute(
                    "SELECT 1 FROM events WHERE id=? AND audio_file IS NOT NULL", (int(p.stem),)).fetchone()
                if not linked:
                    p.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                pass
    return removed


def _dir_usage(path) -> Tuple[int, int]:
    count = size = 0
    if path.exists():
        for p in path.glob("*.wav"):
            try:
                size += p.stat().st_size
                count += 1
            except OSError:
                pass
    return count, size


class MaintenanceWorker:
    def __init__(self, interval_sec: Optional[float] = None):
        self.interval = interval_sec or _env_float(["MAINTENANCE_INTERVAL_MINUTES"], 15.0) * 60
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()  # one cycle / on-demand rollup at a time
        self._last_today_rollup = 0.0
        self.last_run: Dict[str, Any] = {}
        self._audio_usage: Tuple[float, Tuple[int, int]] = (0.0, (0, 0))

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="op25-maintenance", daemon=True)
        self._thread.start()
        logger.info(f"Maintenance worker started (retention={retention_days():g}d, "
                    f"audio={audio_retention_hours():g}h, every {self.interval / 60:g}m)")

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def _loop(self):
        # Short delay so startup (and a first-run VACUUM) settles before the first cycle.
        if self._stop.wait(5):
            return
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception as e:
                logger.error(f"Maintenance cycle failed: {e}")
            self._stop.wait(self.interval)

    def run_once(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = now or time.time()
        t0 = time.time()
        with self._lock:
            conn = _connect()
            try:
                rolled = rollup_pending(conn, now)
                cutoff = purge_cutoff(now, retention_days())
                deleted = purge_before(conn, cutoff) if cutoff else {}
                audio_removed = prune_audio(conn, now, audio_retention_hours())
                if any(deleted.values()) or audio_removed:
                    conn.execute("PRAGMA incremental_vacuum")
                conn.execute("PRAGMA optimize")
            finally:
                conn.close()
            self._last_today_rollup = now
        self.last_run = {
            "ts": now,
            "duration_ms": int((time.time() - t0) * 1000),
            "days_rolled_up": rolled,
            "purge_cutoff": cutoff,
            "deleted": deleted,
            "audio_removed": audio_removed,
        }
        if any(deleted.values()) or audio_removed:
            logger.info(f"Retention: deleted {deleted}, audio files removed: {audio_removed}")
        return self.last_run

    def refresh_today(self, min_age_sec: float = 60.0):
        """Re-roll today on demand (throttled) so dashboards aren't a cycle behind."""
        now = time.time()
        if now - self._last_today_rollup < min_age_sec:
            return
        with self._lock:
            conn = _connect()
            try:
                rollup_day(conn, local_day(now))
            finally:
                conn.close()
            self._last_today_rollup = now

    def storage_stats(self) -> Dict[str, Any]:
        conn = _connect()
        try:
            page_size = conn.execute("PRAGMA page_size").fetchone()[0]
            free_pages = conn.execute("PRAGMA freelist_count").fetchone()[0]
            counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                      for t in PURGE_TABLES + ("talkgroups", "radios")}
            oldest, newest = conn.execute("SELECT MIN(ts), MAX(ts) FROM events").fetchone()
            first_day = conn.execute("SELECT MIN(day) FROM daily_system_stats").fetchone()[0]
        finally:
            conn.close()

        db_bytes = 0
        for suffix in ("", "-wal", "-shm"):
            try:
                db_bytes += os.path.getsize(str(DB_PATH) + suffix)
            except OSError:
                pass

        # Scanning thousands of WAVs isn't free; cache for a minute.
        cached_at, usage = self._audio_usage
        if time.time() - cached_at > 60:
            usage = _dir_usage(DATA_DIR / "audio_calls")
            self._audio_usage = (time.time(), usage)

        days = retention_days()
        return {
            "db_bytes": db_bytes,
            "db_free_bytes": free_pages * page_size,
            "audio_files": usage[0],
            "audio_bytes": usage[1],
            "row_counts": counts,
            "oldest_event_ts": oldest,
            "newest_event_ts": newest,
            "first_rollup_day": first_day,
            "retention_days": days,
            "audio_retention_hours": audio_retention_hours(),
            "history_start_ts": purge_cutoff(time.time(), days),
            "last_maintenance": self.last_run or None,
        }
