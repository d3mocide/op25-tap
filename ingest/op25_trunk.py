"""
Poll OP25's HTTP status endpoint and synthesize trunking events, affiliations,
and telemetry.

Accurately handles boatbod/op25 HTTP status responses:
  - trunk_update   -> system info (NAC, WACN, SYSID, site, CC), frequency_data,
                       wuid_data (subscriber affiliations/roaming), adjacent_data
  - channel_update -> per-receiver state (freq, tgid, tag, srcaddr, error, stream_url)
  - call_log       -> completed call grants/transmissions emitted by OP25
"""
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

from dotenv import load_dotenv
import requests

from db import (
    canonical_system,
    db,
    record_affiliation,
    upsert_adjacent_site,
    upsert_radio,
    upsert_site,
    upsert_system,
    upsert_talkgroup,
)
from ingest.anomalies import detect_novelty, spike_check

load_dotenv()
logger = logging.getLogger("op25-poller")
CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "op25.json"
PROTOCOL = "APCO-25"
STATUS_CMD = [{"command": "update", "arg1": 0, "arg2": 0}]


def load_config() -> dict:
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text())
        except Exception as e:
            logger.debug(f"Could not read config file {CONFIG_PATH}: {e}")

    # Environment variables override / supply config values
    target_url = os.environ.get("OP25_URL") or os.environ.get("OP25TAP_URL")
    if target_url:
        if not target_url.endswith("/"):
            target_url += "/"
        cfg["url"] = target_url
        if "endpoints" not in cfg or not cfg["endpoints"]:
            cfg["endpoints"] = [{"url": target_url, "poll_interval": float(os.environ.get("OP25_POLL_INTERVAL", 1.0))}]
        else:
            cfg["endpoints"][0]["url"] = target_url
    elif "url" not in cfg:
        if cfg.get("endpoints") and "url" in cfg["endpoints"][0]:
            cfg["url"] = cfg["endpoints"][0]["url"]
        else:
            cfg["url"] = "http://127.0.0.1:8080/"

    if os.environ.get("OP25_POLL_INTERVAL"):
        try:
            cfg["poll_interval"] = float(os.environ["OP25_POLL_INTERVAL"])
            if cfg.get("endpoints"):
                cfg["endpoints"][0]["poll_interval"] = cfg["poll_interval"]
        except ValueError:
            pass

    if os.environ.get("OP25_HOLD_SECONDS"):
        try:
            cfg["hold_seconds"] = float(os.environ["OP25_HOLD_SECONDS"])
        except ValueError:
            pass

    audio_ws = os.environ.get("OP25_AUDIO_WS") or os.environ.get("OP25TAP_AUDIO_WS")
    if audio_ws:
        cfg["audio_ws_url"] = audio_ws
    elif "audio_ws_url" not in cfg:
        p = urlparse(cfg["url"])
        host = p.hostname or "127.0.0.1"
        cfg["audio_ws_url"] = f"ws://{host}:9000"

    if os.environ.get("OP25_SYSTEM_NAME"):
        cfg.setdefault("systems", {})["default"] = os.environ["OP25_SYSTEM_NAME"]

    return cfg


def _int(x) -> Optional[int]:
    try:
        return int(x) if x not in (None, "", " ") else None
    except (TypeError, ValueError):
        return None


def _hz(x) -> Optional[int]:
    """OP25 freq may be Hz int, Hz string, or MHz float; normalize to Hz."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return int(v * 1_000_000) if v < 100_000 else int(v)


def _first(seq):
    return seq[0] if isinstance(seq, (list, tuple)) and seq else None


class Op25Poller:
    def __init__(
        self,
        url: str,
        cfg: Optional[dict] = None,
        event_callback: Optional[Callable[[str, Any], None]] = None,
        audio_recorder: Optional[Any] = None,
    ):
        self.url = url
        self.cfg = cfg or load_config()
        self.hold = float(self.cfg.get("hold_seconds", 3.0))
        self.event_callback = event_callback  # Callback for WebSocket broadcast: fn(event_name, data)
        self.audio_recorder = audio_recorder  # Audio recorder worker
        self.active: Dict[tuple, dict] = {}   # (system_name, freq) -> active call state dict
        self.sys_info: Dict[str, dict] = {}   # system_name -> {"nac","wacn","sysid","rfid","stid",...}
        self.latest_status: Dict[str, Any] = {
            "connected": False,
            "target_url": self.url,
            "last_poll": None,
            "system": None,
            "site": None,
            "channels": [],
            "frequencies": {},
            "adjacent_sites": [],
            "wuid_count": 0,
            "stream_url": None,
            "error_hz": None,
            "plot_files": [],
            "plots": {},
            "fine_tune": None,
        }
        self._processed_call_keys: "OrderedDict[tuple, None]" = OrderedDict()  # call_log dedup (bounded LRU)
        self._last_roam: Dict[tuple, int] = {}  # (sys_id, rid) -> last site_id written to roaming
        self._stop = threading.Event()

    # ---- Fetch ---------------------------------------------------------------
    def fetch(self) -> List[dict]:
        try:
            r = requests.post(self.url, json=STATUS_CMD, timeout=5)
        except requests.RequestException:
            r = requests.get(self.url, timeout=5)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else [data]

    # ---- System resolution ---------------------------------------------------
    def _system_name(self, raw_name: Optional[str], nac: Any, sysid: Any) -> str:
        # Check explicit config mapping first
        m = self.cfg.get("systems", {})
        for key in (sysid, nac, hex(sysid) if isinstance(sysid, int) else None,
                    hex(nac) if isinstance(nac, int) else None, raw_name):
            if key is not None and str(key) in m:
                return canonical_system(m[str(key)])
            if key is not None and str(key).lower() in m:
                return canonical_system(m[str(key).lower()])
        if raw_name:
            return canonical_system(raw_name)
        if "default" in m and m["default"]:
            return canonical_system(m["default"])
        id_str = hex(sysid) if isinstance(sysid, int) else (hex(nac) if isinstance(nac, int) else "unknown")
        return canonical_system(f"OP25 {id_str}")

    # ---- Observations extraction --------------------------------------------
    def _extract_observations_and_metadata(self, items: List[dict], now: float):
        observations = []
        c = db()

        for item in items:
            if not isinstance(item, dict):
                continue
            jt = item.get("json_type")

            # 1. TRUNK_UPDATE
            if jt == "trunk_update":
                # Keys can be "0", "1", etc. for monitored trunking systems
                for key, sysd in item.items():
                    if key in ("json_type", "nac") or not isinstance(sysd, dict):
                        continue

                    raw_sysname = sysd.get("system")
                    nac_val = sysd.get("nac")
                    sysid_val = sysd.get("sysid")
                    wacn_val = sysd.get("wacn")
                    rfid_val = sysd.get("rfid")
                    stid_val = sysd.get("stid")
                    rxchan = _hz(sysd.get("rxchan"))

                    sysname = self._system_name(raw_sysname, nac_val, sysid_val)
                    sys_id = upsert_system(sysname, protocol=PROTOCOL, label=raw_sysname or sysname, now=now)

                    site_str = f"{rfid_val}.{stid_val}" if rfid_val is not None and stid_val is not None else None
                    site_id = upsert_site(sys_id, site_str, name=site_str, rfss=rfid_val,
                                          wacn=wacn_val, now=now) if site_str else None

                    self.sys_info[sysname] = {
                        "sys_id": sys_id,
                        "site_id": site_id,
                        "system_name": sysname,
                        "raw_name": raw_sysname,
                        "callsign": sysd.get("callsign"),
                        "top_line": sysd.get("top_line"),
                        "nac": nac_val,
                        "sysid": sysid_val,
                        "wacn": wacn_val,
                        "rfid": rfid_val,
                        "stid": stid_val,
                        "rxchan": rxchan,
                        "last_tsbk": sysd.get("last_tsbk"),
                    }

                    # Frequencies & active transmissions from frequency_data
                    freq_data = sysd.get("frequency_data") or {}
                    freq_status_map = {}
                    for f_str, fd in freq_data.items():
                        f_hz = _hz(f_str)
                        if not f_hz or not isinstance(fd, dict):
                            continue

                        f_type = fd.get("type", "voice")
                        counter = fd.get("counter", 0)
                        last_act = fd.get("last_activity", "")
                        tgids = fd.get("tgids") or []
                        tags = fd.get("tags") or []
                        srcaddrs = fd.get("srcaddrs") or []
                        srctags = fd.get("srctags") or []

                        active_tgid = _int(_first(tgids))
                        active_src = _int(_first(srcaddrs))
                        active_tag = _first(tags)
                        active_srctag = _first(srctags)

                        freq_status_map[str(f_hz)] = {
                            "freq": f_hz,
                            "type": f_type,
                            "counter": counter,
                            "last_activity": last_act,
                            "active_tgid": active_tgid,
                            "active_tag": active_tag,
                            "active_src": active_src,
                        }

                        if active_tgid and f_type == "voice":
                            observations.append({
                                "system": sysname,
                                "sys_id": sys_id,
                                "site_id": site_id,
                                "site_str": site_str,
                                "freq": f_hz,
                                "tgid": active_tgid,
                                "srcaddr": active_src,
                                "tag": active_tag,
                                "srctag": active_srctag,
                                "encrypted": False,
                                "source": "frequency_data",
                            })

                    # WUID Data: Subscriber Registrations / Affiliations
                    wuid_data = sysd.get("wuid_data") or {}
                    for suid_hex, sinfo in wuid_data.items():
                        if not isinstance(sinfo, dict):
                            continue
                        s_rid = _int(sinfo.get("srcaddr"))
                        s_tgid = _int(sinfo.get("aff_ga"))
                        s_tgtag = sinfo.get("aff_ga_tag")
                        s_time = sinfo.get("time") or now
                        s_rfss = sinfo.get("rfss")
                        s_site_num = sinfo.get("site")
                        s_sitestr = f"{s_rfss}.{s_site_num}" if s_rfss is not None and s_site_num is not None else site_str

                        if s_rid:
                            upsert_radio(sys_id, s_rid, alias=sinfo.get("tag") or None, now=s_time)
                        if s_tgid:
                            upsert_talkgroup(sys_id, s_tgid, alias=s_tgtag, now=s_time)
                        if s_rid and s_tgid:
                            record_affiliation(sys_id, site_id, s_rid, s_tgid, s_time)
                        if s_rid and site_id:
                            self._record_roaming(sys_id, site_id, s_rid, s_time)

                    # Adjacent Data: Neighbor Sites
                    adj_data = sysd.get("adjacent_data") or {}
                    adj_list = []
                    for adj_freq_str, ainfo in adj_data.items():
                        if not isinstance(ainfo, dict):
                            continue
                        a_freq = _hz(adj_freq_str)
                        a_rfid = ainfo.get("rfid")
                        a_stid = ainfo.get("stid")
                        neighbor_site = f"{a_rfid}.{a_stid}" if a_rfid is not None and a_stid is not None else None
                        if neighbor_site:
                            upsert_adjacent_site(sys_id, site_id, neighbor_site, a_freq, now=now)
                            adj_list.append({
                                "neighbor_site": neighbor_site,
                                "rfid": a_rfid,
                                "stid": a_stid,
                                "frequency": a_freq,
                                "uplink": _hz(ainfo.get("uplink")),
                            })

                    # Update status
                    self.latest_status.update({
                        "system": self.sys_info.get(sysname),
                        "site": site_str,
                        "frequencies": freq_status_map,
                        "adjacent_sites": adj_list,
                        "wuid_count": len(wuid_data),
                    })

            # 2. CHANNEL_UPDATE
            elif jt == "channel_update":
                chan_list = item.get("channels") or item.get("channel_ids") or []
                active_chans = []
                for cid in chan_list:
                    ch = item.get(str(cid)) or {}
                    freq = _hz(ch.get("freq"))
                    tgid = _int(ch.get("tgid"))
                    src = _int(ch.get("srcaddr"))
                    raw_sys = ch.get("system")
                    tag = ch.get("tag")
                    srctag = ch.get("srctag")
                    stream_url = ch.get("stream_url")
                    if stream_url and stream_url.endswith(".m3u"):
                        stream_url = stream_url[:-4]
                    enc = bool(ch.get("encrypted"))
                    error = ch.get("error")

                    if stream_url:
                        self.latest_status["stream_url"] = stream_url
                    if error is not None:
                        self.latest_status["error_hz"] = error

                    active_chans.append({
                        "channel_id": str(cid),
                        "freq": freq,
                        "tgid": tgid,
                        "tag": tag,
                        "srcaddr": src,
                        "system": raw_sys,
                        "encrypted": enc,
                        "error": error,
                        "stream_url": stream_url,
                        "name": ch.get("name"),
                    })

                    sysname = self._system_name(raw_sys, None, None)
                    info = self.sys_info.get(sysname, {})
                    is_control_chan = (freq == info.get("rxchan")) or (tag == "Control Channel")

                    if freq and tgid and not is_control_chan:
                        sys_id = info.get("sys_id") or upsert_system(sysname, protocol=PROTOCOL, label=raw_sys, now=now)
                        site_id = info.get("site_id")
                        site_str = f"{info.get('rfid')}.{info.get('stid')}" if info.get("rfid") is not None else None

                        observations.append({
                            "system": sysname,
                            "sys_id": sys_id,
                            "site_id": site_id,
                            "site_str": site_str,
                            "freq": freq,
                            "tgid": tgid,
                            "srcaddr": src,
                            "tag": tag,
                            "srctag": srctag,
                            "encrypted": enc,
                            "source": "channel_update",
                        })

                self.latest_status["channels"] = active_chans

            # 3. CALL_LOG
            elif jt == "call_log":
                logs = item.get("log") or []
                for entry in logs:
                    if not isinstance(entry, dict):
                        continue
                    log_time = float(entry.get("time") or now)
                    log_freq = _hz(entry.get("freq"))
                    log_tgid = _int(entry.get("tgid"))
                    log_rid = _int(entry.get("rid"))
                    log_tgtag = entry.get("tgtag")
                    log_rtag = entry.get("rtag")
                    log_sysid = entry.get("sysid")
                    prio = _int(entry.get("prio"))

                    if not log_tgid:
                        continue

                    # In-memory deduplication across polls
                    dedup_key = (int(log_time), log_freq, log_tgid)
                    if dedup_key in self._processed_call_keys:
                        continue
                    self._processed_call_keys[dedup_key] = None
                    while len(self._processed_call_keys) > 2000:
                        self._processed_call_keys.popitem(last=False)

                    sysname = self._system_name(None, None, log_sysid)
                    info = self.sys_info.get(sysname, {})
                    sys_id = info.get("sys_id") or upsert_system(sysname, protocol=PROTOCOL, label=sysname, now=now)
                    site_id = info.get("site_id")

                    # Refresh aliases only; call counts are added once, either when a
                    # live-tracked call closes or when a new event row is inserted below.
                    upsert_talkgroup(sys_id, log_tgid, alias=log_tgtag, now=log_time)
                    if log_rid:
                        upsert_radio(sys_id, log_rid, alias=log_rtag, now=log_time)

                    # 1. Check if this transmission is currently active and being tracked/recorded live
                    is_active = False
                    for (active_sysname, active_freq), st in self.active.items():
                        if active_freq == log_freq and st.get("tgid") == log_tgid:
                            if log_rid and (not st.get("srcaddr") or st.get("srcaddr") == 0):
                                self._learn_source(st, {"srcaddr": log_rid, "srctag": log_rtag}, log_time)
                            is_active = True
                            break
                    if is_active:
                        continue

                    # 2. Check if this call was already recorded in DB within the last 6 seconds
                    existing = c.execute(
                        """SELECT id, from_rid, duration_ms FROM events
                           WHERE system_id=? AND frequency=? AND to_tgid=?
                             AND ABS(ts - ?) <= 6.0
                           ORDER BY ts DESC LIMIT 1""",
                        (sys_id, log_freq, log_tgid, log_time)
                    ).fetchone()
                    if existing:
                        # Existing synthesized call found - update RID if it was missing/0
                        if log_rid and (not existing["from_rid"] or existing["from_rid"] == 0):
                            c.execute("UPDATE events SET from_rid=? WHERE id=?", (log_rid, existing["id"]))
                            upsert_radio(sys_id, log_rid, alias=log_rtag, now=log_time, add_call=0)
                        continue

                    # 3. Completely new/historical call not captured live
                    ev_id = f"call-{log_freq}-{log_tgid}-{log_rid or 0}-{int(log_time)}"
                    cur = c.execute(
                        """INSERT OR IGNORE INTO events(ts, system_id, site_id, protocol, event_type,
                               from_rid, to_tgid, frequency, duration_ms, event_id, encrypted, details)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (log_time, sys_id, site_id, PROTOCOL, "Group Call", log_rid,
                         log_tgid, log_freq, 0, ev_id, 0, f"priority: {prio}" if prio else "")
                    )
                    if cur.rowcount > 0:
                        upsert_talkgroup(sys_id, log_tgid, now=log_time, add_call=1)
                        if log_rid:
                            upsert_radio(sys_id, log_rid, now=log_time, add_call=1)
                    # Only emit live WebSocket events if this call just happened (< 5s old)
                    if cur.rowcount > 0 and (now - log_time) < 5.0:
                        self._emit("event", {
                            "id": cur.lastrowid,
                            "ts": log_time,
                            "system": sysname,
                            "type": "Group Call",
                            "from": log_rid,
                            "to_tg": log_tgid,
                            "tg_tag": log_tgtag,
                            "site": f"{info.get('rfid')}.{info.get('stid')}" if info.get("rfid") is not None else None,
                            "freq": log_freq,
                            "duration_ms": 0,
                            "encrypted": False,
                            "details": f"priority: {prio}" if prio else "",
                        })
                        try:
                            detect_novelty(sys_id, site_id, log_rid or None, log_tgid, log_time, self._emit)
                            spike_check(sys_id, log_rid or None, log_time, self._emit)
                        except Exception as e:
                            logger.error(f"Anomaly check failed: {e}")

            # 4. RX_UPDATE (RF Scopes & Plots)
            elif jt == "rx_update":
                files = item.get("files") or []
                error_val = item.get("error")
                fine_tune = item.get("fine_tune")
                if error_val is not None:
                    self.latest_status["error_hz"] = error_val
                if fine_tune is not None:
                    self.latest_status["fine_tune"] = fine_tune

                parsed_plots = {}
                for f in files:
                    clean = f.replace(".png", "")
                    parts = clean.split("-")
                    if len(parts) >= 4 and parts[0] == "plot":
                        chan = parts[1]
                        kind = parts[2]
                        seq = parts[3]
                        if chan not in parsed_plots:
                            parsed_plots[chan] = {}
                        parsed_plots[chan][kind] = {
                            "channel": chan,
                            "kind": kind,
                            "seq": seq,
                            "filename": f,
                            "url": f"/api/plots/{f}",
                        }
                self.latest_status["plot_files"] = files
                self.latest_status["plots"] = parsed_plots

        return observations

    # ---- Diff & Debounce Process ---------------------------------------------
    def process(self, items: List[dict], now: Optional[float] = None):
        now = now or time.time()
        self.latest_status["connected"] = True
        self.latest_status["last_poll"] = now

        # One transaction per poll: wuid_data alone can mean hundreds of upserts,
        # which would otherwise each be committed individually.
        c = db()
        c.execute("BEGIN")
        try:
            self._process_in_txn(items, now)
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            self._last_roam.clear()  # may reference rows that were just rolled back
            raise
        # Broadcast telemetry update to connected clients
        self._emit("telemetry", self.latest_status)

    def _process_in_txn(self, items: List[dict], now: float):
        observations = self._extract_observations_and_metadata(items, now)

        for ob in observations:
            key = (ob["system"], ob["freq"])
            st = self.active.get(key)

            # Sighting on existing call?
            if st and st["tgid"] == ob["tgid"] and (
                    ob["srcaddr"] in (None, 0) or st["srcaddr"] in (None, 0, ob["srcaddr"])):
                st["last"] = now
                if ob["srcaddr"] and not st["srcaddr"]:
                    self._learn_source(st, ob, now)
                st["encrypted"] = st["encrypted"] or ob["encrypted"]
                continue

            # Different call or new call on this frequency
            if st:
                self._close(key, now)
            self._open(key, ob, now)

        self.sweep(now)

    def sweep(self, now: Optional[float] = None):
        now = now or time.time()
        for key in [k for k, s in self.active.items() if now - s["last"] > self.hold]:
            self._close(key, now)

    # ---- Event writes --------------------------------------------------------
    def _open(self, key, ob, now):
        c = db()
        sysname, freq = key
        sys_id = ob["sys_id"]
        site_id = ob["site_id"]
        site_str = ob["site_str"]
        enc = 1 if ob["encrypted"] else 0

        upsert_talkgroup(sys_id, ob["tgid"], alias=ob["tag"], encrypted=bool(enc), now=now)
        if ob["srcaddr"]:
            upsert_radio(sys_id, ob["srcaddr"], alias=ob["srctag"], now=now)

        # Check if call_log or prior sighting already inserted an event for this call
        existing = c.execute(
            """SELECT id, from_rid FROM events
               WHERE system_id=? AND frequency=? AND to_tgid=?
                 AND ABS(ts - ?) <= 6.0
               ORDER BY ts DESC LIMIT 1""",
            (sys_id, freq, ob["tgid"], now)
        ).fetchone()

        if existing:
            row_id = existing["id"]
            if ob["srcaddr"] and (not existing["from_rid"] or existing["from_rid"] == 0):
                c.execute("UPDATE events SET from_rid=? WHERE id=?", (ob["srcaddr"], row_id))
        else:
            ev_id = f"synth-{freq}-{ob['tgid']}-{ob['srcaddr'] or 0}-{int(now)}"
            cur = c.execute(
                """INSERT OR IGNORE INTO events(ts, system_id, site_id, protocol, event_type, from_rid,
                       to_tgid, frequency, duration_ms, event_id, encrypted)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (now, sys_id, site_id, PROTOCOL, "Group Call", ob["srcaddr"] or None,
                 ob["tgid"], freq, 0, ev_id, enc)
            )
            if cur.rowcount == 0:
                return

            if site_id is not None and ob["srcaddr"]:
                self._record_roaming(sys_id, site_id, ob["srcaddr"], now)

            row_id = cur.lastrowid
            self._emit("event", {
                "id": row_id,
                "ts": now,
                "system": sysname,
                "type": "Group Call",
                "from": ob["srcaddr"] or None,
                "to_tg": ob["tgid"],
                "tg_tag": ob["tag"],
                "site": site_str,
                "freq": freq,
                "duration_ms": 0,
                "encrypted": bool(enc),
                "details": "",
            })

        self.active[key] = {
            "row": row_id,
            "sys_id": sys_id,
            "site_id": site_id,
            "tgid": ob["tgid"],
            "srcaddr": ob["srcaddr"],
            "tag": ob["tag"],
            "start": now,
            "last": now,
            "encrypted": bool(enc),
        }

        try:
            detect_novelty(sys_id, site_id, ob["srcaddr"] or None, ob["tgid"], now, self._emit)
            spike_check(sys_id, ob["srcaddr"] or None, now, self._emit)
        except Exception as e:
            logger.error(f"[anomaly] error: {e}")

        if self.audio_recorder:
            try:
                self.audio_recorder.start_call(row_id)
            except Exception as e:
                logger.debug(f"Audio recorder start_call error: {e}")

    def _record_roaming(self, sys_id, site_id, rid, ts):
        """Write a roaming row only when a RID is first seen or changes site."""
        key = (sys_id, rid)
        if self._last_roam.get(key) == site_id:
            return
        self._last_roam[key] = site_id
        db().execute("INSERT INTO roaming(ts, system_id, site_id, rid) VALUES (?,?,?,?)",
                     (ts, sys_id, site_id, rid))

    def _learn_source(self, st, ob, now):
        st["srcaddr"] = ob["srcaddr"]
        db().execute("UPDATE events SET from_rid=? WHERE id=? AND from_rid IS NULL",
                     (ob["srcaddr"], st["row"]))
        upsert_radio(st["sys_id"], ob["srcaddr"], alias=ob["srctag"], now=now)

    def _close(self, key, now):
        st = self.active.pop(key, None)
        if not st:
            return
        dur = int((st["last"] - st["start"]) * 1000)
        c = db()
        c.execute("UPDATE events SET duration_ms=?, encrypted=MAX(encrypted,?) WHERE id=?",
                  (dur, 1 if st["encrypted"] else 0, st["row"]))
        if st["srcaddr"]:
            upsert_radio(st["sys_id"], st["srcaddr"], now=now, add_call=1, add_ms=dur)
        upsert_talkgroup(st["sys_id"], st["tgid"], now=now, add_call=1, add_ms=dur,
                         encrypted=st["encrypted"])
        # Let live clients patch the zero-duration row they got on open.
        self._emit("event_update", {
            "id": st["row"],
            "duration_ms": dur,
            "encrypted": st["encrypted"],
            "from": st["srcaddr"] or None,
        })

        if self.audio_recorder:
            try:
                self.audio_recorder.end_call(st["row"])
            except Exception as e:
                logger.debug(f"Audio recorder end_call error: {e}")

    def _emit(self, event_name: str, payload: Any):
        if self.event_callback is not None:
            try:
                self.event_callback(event_name, payload)
            except Exception as e:
                logger.error(f"Error in event callback: {e}")

    # ---- Continuous loop -----------------------------------------------------
    def run_forever(self, interval: float = 1.0):
        logger.info(f"Starting OP25 poller against {self.url} (interval={interval}s)")
        while not self._stop.is_set():
            try:
                data = self.fetch()
                self.process(data)
            except Exception as e:
                logger.warning(f"OP25 poll error: {e}")
                self.latest_status["connected"] = False
                self.sweep()
            self._stop.wait(interval)

    def stop(self):
        self._stop.set()


def start_poll_thread(url: str, callback: Optional[Callable[[str, Any], None]] = None, interval: float = 1.0) -> Op25Poller:
    cfg = load_config()
    poller = Op25Poller(url, cfg=cfg, event_callback=callback)
    t = threading.Thread(target=poller.run_forever, args=(interval,), name=f"op25-poll-{url}", daemon=True)
    t.start()
    return poller
