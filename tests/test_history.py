"""Migrations, daily rollups, retention and the time-range API."""
import os
import sqlite3
import sys
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["OP25TAP_DATA_DIR"] = str(ROOT / "tests" / "test_data")

import pytest
from fastapi.testclient import TestClient

import db as dbmod
from db import DATA_DIR, DB_PATH, SCHEMA_VERSION, db, init_db, upsert_system, upsert_talkgroup, wipe
from ingest import maintenance as mt

TODAY = date.today()


def at(day: date, hour: float) -> float:
    return mt.day_bounds(day)[0] + hour * 3600


def add_event(sys_id, ts, tgid, rid=None, dur=1000, enc=0, freq=851_000_000, audio_file=None):
    return db().execute(
        """INSERT INTO events(ts, system_id, event_type, from_rid, to_tgid, frequency, duration_ms,
                              encrypted, audio_file) VALUES (?,?,?,?,?,?,?,?,?)""",
        (ts, sys_id, "Group Call", rid, tgid, freq, dur, enc, audio_file)).lastrowid


@pytest.fixture
def fresh():
    wipe()
    init_db()
    sys_id = upsert_system("Test P25", now=at(TODAY, 0))
    upsert_talkgroup(sys_id, 100, alias="Fire Dispatch", now=at(TODAY, 0))
    yield sys_id
    wipe()


def test_migrates_legacy_database():
    wipe()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    legacy = sqlite3.connect(DB_PATH)
    legacy.executescript("""
        CREATE TABLE events (id INTEGER PRIMARY KEY, ts REAL NOT NULL, system_id INTEGER, site_id INTEGER,
            protocol TEXT, event_type TEXT, from_rid INTEGER, to_tgid INTEGER, to_rid INTEGER, channel TEXT,
            frequency INTEGER, timeslot INTEGER, duration_ms INTEGER, details TEXT, event_id TEXT,
            encrypted INTEGER DEFAULT 0);
        CREATE TABLE calls (id INTEGER PRIMARY KEY, ts REAL);
        CREATE TABLE patches (id INTEGER PRIMARY KEY, ts REAL);
        CREATE TABLE denies (id INTEGER PRIMARY KEY, ts REAL);
        CREATE TABLE ingest_state (path TEXT PRIMARY KEY);
        INSERT INTO events(ts, to_tgid) VALUES (1.0, 100);
    """)
    legacy.close()

    init_db()
    c = db()
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not {"calls", "patches", "denies", "ingest_state"} & tables
    assert {"daily_system_stats", "daily_tg_stats", "daily_rid_stats"} <= tables
    cols = {r[1] for r in c.execute("PRAGMA table_info(events)")}
    assert {"transcript", "audio_file"} <= cols
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    assert c.execute("PRAGMA auto_vacuum").fetchone()[0] == 2
    assert c.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1  # data kept
    wipe()


def test_rollup_counts_and_skips_duplicate_call_log_rows(fresh):
    d = TODAY - timedelta(days=1)
    add_event(fresh, at(d, 10), 100, rid=1, dur=2000, enc=1)
    add_event(fresh, at(d, 10) + 2, 100, rid=None, dur=0)  # call_log echo of the same call
    add_event(fresh, at(d, 11), 100, rid=2, dur=3000)
    add_event(fresh, at(d, 12), 200, rid=1, dur=1000, freq=852_000_000)
    add_event(fresh, at(d, 23.99), 200, rid=1, dur=1000, freq=852_000_000)
    add_event(fresh, at(TODAY, 0.01), 200, rid=1, dur=1000)  # next day

    c = db()
    mt.rollup_day(c, d)
    s = c.execute("SELECT * FROM daily_system_stats WHERE day=?", (d.isoformat(),)).fetchone()
    assert (s["calls"], s["airtime_ms"], s["encrypted_calls"], s["unique_rids"], s["unique_tgs"]) == (4, 7000, 1, 2, 2)
    tg = c.execute("SELECT calls, airtime_ms, unique_rids FROM daily_tg_stats WHERE day=? AND tgid=100",
                   (d.isoformat(),)).fetchone()
    assert tuple(tg) == (2, 5000, 2)
    rid1 = c.execute("SELECT calls FROM daily_rid_stats WHERE day=? AND rid=1", (d.isoformat(),)).fetchone()
    assert rid1[0] == 3

    mt.rollup_day(c, d)  # idempotent
    assert c.execute("SELECT calls FROM daily_system_stats WHERE day=?", (d.isoformat(),)).fetchone()[0] == 4


def test_retention_purges_whole_days_and_keeps_rollups(fresh, monkeypatch):
    monkeypatch.setenv("RETENTION_DAYS", "7")
    old = TODAY - timedelta(days=8)
    edge = TODAY - timedelta(days=7)
    add_event(fresh, at(old, 23.5), 100, rid=1)
    add_event(fresh, at(edge, 0.5), 100, rid=1)
    add_event(fresh, at(TODAY, 0.1), 100, rid=1)
    c = db()
    c.execute("INSERT INTO anomalies(ts, kind, system_id) VALUES (?,?,?)", (at(old, 1), "new_rid", fresh))
    c.execute("INSERT INTO affiliations(ts, system_id, rid, tgid) VALUES (?,?,?,?)", (at(old, 1), fresh, 1, 100))
    c.execute("INSERT INTO roaming(ts, system_id, rid) VALUES (?,?,?)", (at(old, 1), fresh, 1))

    result = mt.MaintenanceWorker().run_once(now=at(TODAY, 0.2))

    assert result["deleted"] == {"events": 1, "affiliations": 1, "roaming": 1, "anomalies": 1}
    remaining = [r[0] for r in c.execute("SELECT ts FROM events ORDER BY ts")]
    assert remaining == [at(edge, 0.5), at(TODAY, 0.1)]
    # The purged day was rolled up first and survives.
    s = c.execute("SELECT calls, anomalies FROM daily_system_stats WHERE day=?", (old.isoformat(),)).fetchone()
    assert tuple(s) == (1, 1)


def test_retention_disabled_keeps_everything(fresh, monkeypatch):
    monkeypatch.setenv("RETENTION_DAYS", "0")
    add_event(fresh, at(TODAY - timedelta(days=400), 1), 100)
    mt.MaintenanceWorker().run_once(now=at(TODAY, 1))
    assert db().execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1


def test_prune_audio_expired_and_orphans(fresh):
    audio_dir = DATA_DIR / "audio_calls"
    audio_dir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    old_id = add_event(fresh, now - 10 * 3600, 100)
    new_id = add_event(fresh, now - 3600, 100)
    for eid in (old_id, new_id):
        (audio_dir / f"{eid}.wav").write_bytes(b"RIFF")
        db().execute("UPDATE events SET audio_file=? WHERE id=?", (f"audio_calls/{eid}.wav", eid))
    orphan = audio_dir / "999999.wav"
    orphan.write_bytes(b"RIFF")
    os.utime(orphan, (now - 3600, now - 3600))

    removed = mt.prune_audio(db(), now, hours=5)

    assert removed == 2
    assert not (audio_dir / f"{old_id}.wav").exists() and not orphan.exists()
    assert (audio_dir / f"{new_id}.wav").exists()
    assert db().execute("SELECT audio_file FROM events WHERE id=?", (old_id,)).fetchone()[0] is None
    (audio_dir / f"{new_id}.wav").unlink()


@pytest.fixture
def client(fresh, monkeypatch):
    import api.main as api
    monkeypatch.setattr(api, "maintenance_instance", mt.MaintenanceWorker())
    return TestClient(api.app)  # no context manager: skip lifespan (no poller/audio threads)


def test_range_endpoints(client, fresh):
    d = TODAY - timedelta(days=2)
    add_event(fresh, at(d, 9), 100, rid=1, dur=2000)
    add_event(fresh, at(d, 9.5), 100, rid=2, dur=1000)
    add_event(fresh, at(d, 15), 300, rid=1, dur=500, freq=852_000_000)
    add_event(fresh, at(TODAY, 0.1), 100, rid=1)
    lo, hi = mt.day_bounds(d)

    evs = client.get("/api/events", params={"from": lo, "to": hi, "limit": 2}).json()
    assert [e["ts"] for e in evs] == [at(d, 15), at(d, 9.5)]
    more = client.get("/api/events", params={"from": lo, "to": hi, "before": evs[-1]["ts"]}).json()
    assert [e["ts"] for e in more] == [at(d, 9)]

    tgs = client.get("/api/talkgroups", params={"from": lo, "to": hi}).json()
    assert [(t["tgid"], t["call_count"], t["total_ms"]) for t in tgs] == [(100, 2, 3000), (300, 1, 500)]
    assert tgs[0]["alias"] == "Fire Dispatch"
    assert client.get("/api/talkgroups", params={"from": lo, "to": hi, "search": "300"}).json()[0]["tgid"] == 300

    radios = client.get("/api/radios", params={"from": lo, "to": hi}).json()
    assert {r["rid"]: r["call_count"] for r in radios} == {1: 2, 2: 1}

    tl = client.get("/api/timeline", params={"from": lo, "to": hi, "buckets": 24}).json()
    assert tl["bucket_sec"] == 3600 and len(tl["buckets"]) == 24
    assert tl["buckets"][9]["calls"] == 2 and tl["buckets"][15]["calls"] == 1
    assert client.get("/api/timeline", params={"from": hi, "to": lo}).status_code == 400


def test_trends_and_storage(client, fresh):
    for back, n in ((3, 2), (1, 4)):
        for i in range(n):
            add_event(fresh, at(TODAY - timedelta(days=back), 8 + i), 100, rid=1)
    mt.MaintenanceWorker().run_once(now=at(TODAY, 1))

    tr = client.get("/api/trends", params={"days": 7}).json()
    assert len(tr["days"]) == 7 and tr["days"][-1] == TODAY.isoformat()
    assert tr["totals"]["calls"][3] == 2 and tr["totals"]["calls"][5] == 4
    top = tr["top_talkgroups"][0]
    assert top["tgid"] == 100 and top["alias"] == "Fire Dispatch" and top["calls"] == 6
    assert top["series"]["calls"] == [0, 0, 0, 2, 0, 4, 0]
    assert tr["top_radios"][0]["rid"] == 1

    st = client.get("/api/storage").json()
    assert st["db_bytes"] > 0 and st["row_counts"]["events"] == 6
    assert st["retention_days"] == 30.0
