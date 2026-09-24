import glob
import json
import os
import sys
from pathlib import Path

# Ensure root is in path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Use an in-memory or temp db for tests
os.environ["OP25TAP_DATA_DIR"] = str(ROOT / "tests" / "test_data")

from db import db, init_db, wipe
from ingest.op25_trunk import Op25Poller


def test_samples_ingest():
    wipe()
    init_db()

    events_emitted = []
    def on_event(ev_name, data):
        events_emitted.append((ev_name, data))

    poller = Op25Poller("http://mock", cfg={"hold_seconds": 2.0}, event_callback=on_event)

    sample_files = sorted(glob.glob(str(ROOT / "samples" / "*.json")))
    assert len(sample_files) > 0, "No sample files found in samples/"
    print(f"Testing ingest on {len(sample_files)} sample files...")

    for fpath in sample_files:
        with open(fpath, "r") as f:
            data = json.load(f)
        poller.process(data)

    c = db()
    systems = c.execute("SELECT * FROM systems").fetchall()
    sites = c.execute("SELECT * FROM sites").fetchall()
    talkgroups = c.execute("SELECT * FROM talkgroups").fetchall()
    radios = c.execute("SELECT * FROM radios").fetchall()
    events = c.execute("SELECT * FROM events").fetchall()
    affiliations = c.execute("SELECT * FROM affiliations").fetchall()
    adjacent = c.execute("SELECT * FROM adjacent_sites").fetchall()

    print(f"Results:")
    print(f"  Systems: {len(systems)}")
    print(f"  Sites: {len(sites)}")
    print(f"  Talkgroups: {len(talkgroups)}")
    print(f"  Radios: {len(radios)}")
    print(f"  Events: {len(events)}")
    print(f"  Affiliations: {len(affiliations)}")
    print(f"  Adjacent Sites: {len(adjacent)}")
    print(f"  Emitted callbacks: {len(events_emitted)}")

    assert len(systems) >= 1, "Expected at least 1 system"
    assert len(sites) >= 1, "Expected at least 1 site"
    assert len(talkgroups) >= 1, "Expected talkgroups from wuid_data / call_log"
    assert len(radios) >= 1, "Expected radios from wuid_data / call_log"
    assert len(affiliations) >= 1, "Expected subscriber affiliations from wuid_data"
    assert len(adjacent) >= 1, "Expected adjacent sites from adjacent_data"

    print("ALL INGEST TESTS PASSED SUCCESSFULLY!")

    # Clean up test database
    wipe()


if __name__ == "__main__":
    test_samples_ingest()
