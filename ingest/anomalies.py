"""Novelty/spike anomaly detection, carried over from trunk-tap's tail.py."""
from db import db


def record_anomaly(ts, kind, system_id=None, site_id=None, rid=None, tgid=None,
                   details=None, socketio=None):
    cur = db().execute(
        "INSERT INTO anomalies(ts, kind, system_id, site_id, rid, tgid, details) VALUES (?,?,?,?,?,?,?)",
        (ts, kind, system_id, site_id, rid, tgid, details))
    if socketio is not None:
        socketio.emit("anomaly", {"id": cur.lastrowid, "ts": ts, "kind": kind,
                                  "system_id": system_id, "site_id": site_id,
                                  "rid": rid, "tgid": tgid, "details": details})


def detect_novelty(system_id, site_id, from_rid, to_tgid, ts, socketio=None):
    """Call after upserts; first_seen == ts means first sighting."""
    c = db()
    if from_rid is not None:
        r = c.execute("SELECT first_seen FROM radios WHERE system_id=? AND rid=?",
                      (system_id, from_rid)).fetchone()
        if r and r["first_seen"] == ts:
            record_anomaly(ts, "new_rid", system_id=system_id, rid=from_rid,
                           details=f"first sighting of RID {from_rid}", socketio=socketio)
    if to_tgid is not None:
        r = c.execute("SELECT first_seen FROM talkgroups WHERE system_id=? AND tgid=?",
                      (system_id, to_tgid)).fetchone()
        if r and r["first_seen"] == ts:
            record_anomaly(ts, "new_tg", system_id=system_id, tgid=to_tgid,
                           details=f"first sighting of TG {to_tgid}", socketio=socketio)
    if site_id is not None:
        r = c.execute("SELECT first_seen FROM sites WHERE id=?", (site_id,)).fetchone()
        if r and r["first_seen"] == ts:
            record_anomaly(ts, "new_site", system_id=system_id, site_id=site_id,
                           details="first sighting of site", socketio=socketio)
    if from_rid is not None and to_tgid is not None:
        if not c.execute("SELECT 1 FROM events WHERE from_rid=? AND to_tgid=? AND ts < ? LIMIT 1",
                         (from_rid, to_tgid, ts)).fetchone():
            record_anomaly(ts, "new_rid_on_tg", system_id=system_id, rid=from_rid, tgid=to_tgid,
                           details=f"RID {from_rid} first heard on TG {to_tgid}", socketio=socketio)
    if from_rid is not None and site_id is not None:
        if not c.execute("SELECT 1 FROM roaming WHERE rid=? AND site_id=? AND ts < ? LIMIT 1",
                         (from_rid, site_id, ts)).fetchone():
            record_anomaly(ts, "new_rid_at_site", system_id=system_id, site_id=site_id, rid=from_rid,
                           details=f"RID {from_rid} first observed at this site", socketio=socketio)


def spike_check(system_id, from_rid, ts, socketio=None, window_sec=60, threshold=8):
    if from_rid is None or system_id is None:
        return
    c = db()
    n = c.execute("SELECT COUNT(*) FROM events WHERE system_id=? AND from_rid=? AND ts BETWEEN ? AND ?",
                  (system_id, from_rid, ts - window_sec, ts)).fetchone()[0]
    if n >= threshold:
        last = c.execute("SELECT ts FROM anomalies WHERE kind='spike' AND rid=? AND system_id=? "
                         "ORDER BY ts DESC LIMIT 1", (from_rid, system_id)).fetchone()
        if last and ts - last["ts"] < window_sec:
            return
        record_anomaly(ts, "spike", system_id=system_id, rid=from_rid,
                       details=f"RID {from_rid} sent {n} events in {window_sec}s", socketio=socketio)
