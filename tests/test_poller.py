"""Synthetic-payload tests for Op25Poller (no captured samples required)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["OP25TAP_DATA_DIR"] = str(ROOT / "tests" / "test_data")

import pytest

from db import db, init_db, wipe
from ingest.op25_trunk import Op25Poller

FREQ = "851.0125"
FREQ_HZ = 851_012_500


def trunk_update(tgid=None, src=None, wuid=None):
    fd = {"type": "voice", "counter": 1}
    if tgid:
        fd.update({"tgids": [tgid], "tags": ["Fire Dispatch"], "srcaddrs": [src or 0], "srctags": [""]})
    return {
        "json_type": "trunk_update",
        "0": {
            "system": "Test P25", "nac": 0x293, "sysid": 0x3CC, "wacn": 0xBEE00,
            "rfid": 1, "stid": 2, "rxchan": 851_500_000,
            "frequency_data": {FREQ: fd},
            "wuid_data": wuid or {},
            "adjacent_data": {},
        },
    }


@pytest.fixture
def poller():
    wipe()
    init_db()
    emitted = []
    p = Op25Poller("http://mock", cfg={"hold_seconds": 2.0},
                   event_callback=lambda name, data: emitted.append((name, data)))
    p.emitted = emitted
    yield p
    wipe()


def test_live_call_counted_once_with_call_log(poller):
    t0 = 1_000_000.0
    poller.process([trunk_update(tgid=100, src=5001)], now=t0)
    poller.process([trunk_update(tgid=100, src=5001)], now=t0 + 1)
    # OP25 reports the same transmission in its call_log while it's live-tracked.
    poller.process([trunk_update(tgid=100, src=5001),
                    {"json_type": "call_log",
                     "log": [{"time": t0, "freq": FREQ_HZ, "tgid": 100, "rid": 5001}]}], now=t0 + 1.5)
    poller.process([trunk_update()], now=t0 + 10)  # idle -> call closes

    c = db()
    assert c.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    tg = c.execute("SELECT call_count, total_ms FROM talkgroups WHERE tgid=100").fetchone()
    assert tg["call_count"] == 1
    assert tg["total_ms"] == 1500
    assert c.execute("SELECT call_count FROM radios WHERE rid=5001").fetchone()[0] == 1

    updates = [d for name, d in poller.emitted if name == "event_update"]
    assert updates and updates[-1]["duration_ms"] == 1500


def test_historical_call_log_entry_counted_once(poller):
    entry = {"time": 500.0, "freq": FREQ_HZ, "tgid": 200, "rid": 6001}
    for i in range(3):
        poller.process([trunk_update(), {"json_type": "call_log", "log": [entry]}], now=1000.0 + i)
    c = db()
    assert c.execute("SELECT COUNT(*) FROM events WHERE to_tgid=200").fetchone()[0] == 1
    assert c.execute("SELECT call_count FROM talkgroups WHERE tgid=200").fetchone()[0] == 1


def test_wuid_roaming_not_duplicated_each_poll(poller):
    wuid = {"0x1771": {"srcaddr": 6001, "aff_ga": 300}}
    for i in range(5):
        poller.process([trunk_update(wuid=wuid)], now=2000.0 + i)
    assert db().execute("SELECT COUNT(*) FROM roaming WHERE rid=6001").fetchone()[0] == 1


def test_anomalies_broadcast_live(poller):
    poller.process([trunk_update(tgid=400, src=7001)], now=3000.0)
    kinds = {d["kind"] for name, d in poller.emitted if name == "anomaly"}
    assert {"new_rid", "new_tg"} <= kinds
