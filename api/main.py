import asyncio
import json
import logging
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
import requests
import websockets

from db import CALL_EVENT_FILTER, DATA_DIR, db, init_db
from ingest.audio_recorder import AudioRecorder
from ingest.maintenance import MaintenanceWorker
from ingest.op25_trunk import Op25Poller, load_config
from ingest.whisper_client import WhisperDispatcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("op25-api")

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "web" / "dist"

# ---- WebSocket Connection Manager -------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total clients: {len(self.active_connections)}")

    def broadcast_sync(self, event_name: str, payload: Any):
        """Thread-safe dispatch into asyncio loop."""
        if not self.loop or not self.active_connections:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(event_name, payload), self.loop)

    async def broadcast(self, event_name: str, payload: Any):
        if not self.active_connections:
            return
        message = json.dumps({"event": event_name, "data": payload})
        dead_connections = set()
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                dead_connections.add(connection)
        for dead in dead_connections:
            self.active_connections.discard(dead)


manager = ConnectionManager()
poller_instance: Optional[Op25Poller] = None
poller_thread: Optional[threading.Thread] = None
audio_recorder_instance: Optional[AudioRecorder] = None
whisper_dispatcher_instance: Optional[WhisperDispatcher] = None
maintenance_instance: Optional[MaintenanceWorker] = None


# ---- Lifespan Background Poller & Audio Pipeline ----------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global poller_instance, poller_thread, audio_recorder_instance, whisper_dispatcher_instance, maintenance_instance
    init_db()

    # Rollups, retention purge and audio pruning
    maintenance_instance = MaintenanceWorker()
    maintenance_instance.start()
    manager.loop = asyncio.get_running_loop()

    cfg = load_config()
    url = cfg.get("url", "http://127.0.0.1:8080/")
    poll_interval = float(cfg.get("poll_interval", 1.0))

    # Initialize Whisper Dispatcher
    whisper_dispatcher_instance = WhisperDispatcher(
        on_transcript=lambda eid, text, audio_file: manager.broadcast_sync(
            "transcript",
            {"id": eid, "transcript": text, "has_audio": bool(audio_file)},
        )
    )
    whisper_dispatcher_instance.start()

    # Initialize Audio Recorder
    audio_recorder_instance = AudioRecorder(
        audio_ws_url=cfg.get("audio_ws_url"),
        whisper_dispatcher=whisper_dispatcher_instance,
    )
    audio_recorder_instance.start()

    # Initialize OP25 Trunk Poller
    poller_instance = Op25Poller(
        url,
        cfg=cfg,
        event_callback=manager.broadcast_sync,
        audio_recorder=audio_recorder_instance,
    )

    poller_thread = threading.Thread(
        target=poller_instance.run_forever,
        args=(poll_interval,),
        name="op25-poller-worker",
        daemon=True,
    )
    poller_thread.start()
    logger.info(f"Launched OP25 poller thread against {url}")

    yield

    logger.info("Shutting down API server...")
    if poller_instance:
        poller_instance.stop()
    if maintenance_instance:
        maintenance_instance.stop()
    if audio_recorder_instance:
        audio_recorder_instance.stop()
    if whisper_dispatcher_instance:
        whisper_dispatcher_instance.stop()


app = FastAPI(title="op25-tap API", lifespan=lifespan)

# Allow CORS for development (Vite dev server). No cookies/auth are used, so
# credentials stay off (a wildcard origin with credentials is rejected by browsers).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- REST API Endpoints -----------------------------------------------------

@app.get("/api/status")
def get_status():
    """Current live receiver telemetry, control channel status, and frequencies."""
    if not poller_instance:
        return {"connected": False, "system": None}
    return poller_instance.latest_status


# Time-range query params. `from`/`to` are epoch seconds; `to` is exclusive.
FromTs = Query(None, alias="from", description="Range start (epoch seconds, inclusive)")
ToTs = Query(None, alias="to", description="Range end (epoch seconds, exclusive)")


def _add_range(query: str, params: List[Any], col: str, from_ts: Optional[float], to_ts: Optional[float]) -> str:
    if from_ts is not None:
        query += f" AND {col} >= ?"
        params.append(from_ts)
    if to_ts is not None:
        query += f" AND {col} < ?"
        params.append(to_ts)
    return query


@app.get("/api/events")
def get_events(
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    tgid: Optional[int] = None,
    rid: Optional[int] = None,
    since: Optional[float] = None,
    from_ts: Optional[float] = FromTs,
    to_ts: Optional[float] = ToTs,
    before: Optional[float] = Query(None, description="Keyset cursor: only events with ts < before"),
):
    """Call events, newest first, with filters, time range and keyset pagination."""
    c = db()
    query = f"""
        SELECT e.id, e.ts, e.system_id, s.name as system_name, COALESCE(s.label, s.name) as system, e.site_id,
               COALESCE(st.name, st.site_id) as site_str, e.protocol, e.event_type as type,
               e.from_rid as "from", e.from_rid, r.alias as from_alias,
               e.to_tgid as to_tg, e.to_tgid, COALESCE(tg.alias, 'TG ' || e.to_tgid) as tg_tag, tg.alias as tg_alias,
               tg.tg_group, tg.tg_tag as category,
               e.frequency as freq, e.frequency, e.duration_ms, e.encrypted, e.details,
               e.transcript, (e.audio_file IS NOT NULL) as has_audio
        FROM events e
        LEFT JOIN systems s ON e.system_id = s.id
        LEFT JOIN sites st ON e.site_id = st.id
        LEFT JOIN talkgroups tg ON e.system_id = tg.system_id AND e.to_tgid = tg.tgid
        LEFT JOIN radios r ON e.system_id = r.system_id AND e.from_rid = r.rid
        WHERE {CALL_EVENT_FILTER}
    """
    params: List[Any] = []
    if tgid is not None:
        query += " AND e.to_tgid = ?"
        params.append(tgid)
    if rid is not None:
        query += " AND e.from_rid = ?"
        params.append(rid)
    if since is not None:
        query += " AND e.ts > ?"
        params.append(since)
    if before is not None:
        query += " AND e.ts < ?"
        params.append(before)
    query = _add_range(query, params, "e.ts", from_ts, to_ts)

    query += " ORDER BY e.ts DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/talkgroups")
def get_talkgroups(
    limit: int = Query(200, ge=1, le=1000),
    search: Optional[str] = None,
    from_ts: Optional[float] = FromTs,
    to_ts: Optional[float] = ToTs,
):
    """Talkgroups with call stats. Lifetime directory by default; with a range,
    call_count/total_ms/first_seen/last_seen are computed from that range's events."""
    c = db()
    params: List[Any] = []
    if from_ts is None and to_ts is None:
        query = """
            SELECT tg.id, tg.system_id, s.name as system_name, tg.tgid, tg.alias,
                   tg.tg_group, tg.tg_tag, tg.priority, tg.encrypted,
                   tg.call_count, tg.total_ms, tg.first_seen, tg.last_seen
            FROM talkgroups tg
            LEFT JOIN systems s ON tg.system_id = s.id
            WHERE 1=1
        """
        order = "tg.last_seen DESC"
        id_col = "tg.tgid"
    else:
        query = f"""
            SELECT tg.id, e.system_id, s.name as system_name, e.to_tgid as tgid, tg.alias,
                   tg.tg_group, tg.tg_tag, tg.priority, MAX(e.encrypted > 0) as encrypted,
                   COUNT(*) as call_count, COALESCE(SUM(e.duration_ms), 0) as total_ms,
                   MIN(e.ts) as first_seen, MAX(e.ts) as last_seen
            FROM events e
            LEFT JOIN talkgroups tg ON e.system_id = tg.system_id AND e.to_tgid = tg.tgid
            LEFT JOIN systems s ON e.system_id = s.id
            WHERE {CALL_EVENT_FILTER}
        """
        query = _add_range(query, params, "e.ts", from_ts, to_ts)
        order = "call_count DESC"
        id_col = "e.to_tgid"
    if search:
        query += f" AND (tg.alias LIKE ? OR CAST({id_col} AS TEXT) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term])
    if from_ts is not None or to_ts is not None:
        query += " GROUP BY e.system_id, e.to_tgid"
    query += f" ORDER BY {order} LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/radios")
def get_radios(
    limit: int = Query(200, ge=1, le=1000),
    search: Optional[str] = None,
    from_ts: Optional[float] = FromTs,
    to_ts: Optional[float] = ToTs,
):
    """Radios/subscribers with call stats (lifetime, or computed for a range)."""
    c = db()
    params: List[Any] = []
    if from_ts is None and to_ts is None:
        query = """
            SELECT r.id, r.system_id, s.name as system_name, r.rid, r.alias,
                   r.call_count, r.total_ms, r.first_seen, r.last_seen
            FROM radios r
            LEFT JOIN systems s ON r.system_id = s.id
            WHERE 1=1
        """
        order = "r.last_seen DESC"
        id_col = "r.rid"
    else:
        query = f"""
            SELECT r.id, e.system_id, s.name as system_name, e.from_rid as rid, r.alias,
                   COUNT(*) as call_count, COALESCE(SUM(e.duration_ms), 0) as total_ms,
                   MIN(e.ts) as first_seen, MAX(e.ts) as last_seen
            FROM events e
            LEFT JOIN radios r ON e.system_id = r.system_id AND e.from_rid = r.rid
            LEFT JOIN systems s ON e.system_id = s.id
            WHERE {CALL_EVENT_FILTER} AND e.from_rid IS NOT NULL AND e.from_rid != 0
        """
        query = _add_range(query, params, "e.ts", from_ts, to_ts)
        order = "call_count DESC"
        id_col = "e.from_rid"
    if search:
        query += f" AND (r.alias LIKE ? OR CAST({id_col} AS TEXT) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term])
    if from_ts is not None or to_ts is not None:
        query += " GROUP BY e.system_id, e.from_rid"
    query += f" ORDER BY {order} LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/affiliations")
def get_affiliations(
    limit: int = Query(100, ge=1, le=1000),
    from_ts: Optional[float] = FromTs,
    to_ts: Optional[float] = ToTs,
):
    """Subscriber registrations and affiliations, newest first."""
    c = db()
    params: List[Any] = []
    query = """SELECT a.id, a.ts, a.system_id, s.name as system_name, a.site_id,
                  COALESCE(st.name, st.site_id) as site_str, a.rid, r.alias as radio_alias,
                  a.tgid, tg.alias as tg_alias
           FROM affiliations a
           LEFT JOIN systems s ON a.system_id = s.id
           LEFT JOIN sites st ON a.site_id = st.id
           LEFT JOIN radios r ON a.system_id = r.system_id AND a.rid = r.rid
           LEFT JOIN talkgroups tg ON a.system_id = tg.system_id AND a.tgid = tg.tgid
           WHERE 1=1"""
    query = _add_range(query, params, "a.ts", from_ts, to_ts)
    query += " ORDER BY a.ts DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in c.execute(query, params).fetchall()]


@app.get("/api/anomalies")
def get_anomalies(
    limit: int = Query(50, ge=1, le=1000),
    from_ts: Optional[float] = FromTs,
    to_ts: Optional[float] = ToTs,
):
    """Novelty and traffic spike alerts, newest first."""
    c = db()
    params: List[Any] = []
    query = """SELECT an.id, an.ts, an.kind, an.system_id, s.name as system_name,
                  an.site_id, an.rid, r.alias as radio_alias, an.tgid,
                  tg.alias as tg_alias, an.details, an.ack
           FROM anomalies an
           LEFT JOIN systems s ON an.system_id = s.id
           LEFT JOIN radios r ON an.system_id = r.system_id AND an.rid = r.rid
           LEFT JOIN talkgroups tg ON an.system_id = tg.system_id AND an.tgid = tg.tgid
           WHERE 1=1"""
    query = _add_range(query, params, "an.ts", from_ts, to_ts)
    query += " ORDER BY an.ts DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in c.execute(query, params).fetchall()]


@app.get("/api/timeline")
def get_timeline(
    from_ts: float = Query(..., alias="from"),
    to_ts: float = Query(..., alias="to"),
    buckets: int = Query(96, ge=1, le=1000),
):
    """Call and alert counts in evenly sized time buckets across [from, to)."""
    if to_ts <= from_ts:
        raise HTTPException(status_code=400, detail="'to' must be after 'from'")
    bucket_sec = max(60, math.ceil((to_ts - from_ts) / buckets))
    n = math.ceil((to_ts - from_ts) / bucket_sec)
    series = [{"t": from_ts + i * bucket_sec, "calls": 0, "airtime_ms": 0, "encrypted": 0, "anomalies": 0}
              for i in range(n)]
    c = db()
    for r in c.execute(
            f"""SELECT CAST((e.ts - ?) / ? AS INTEGER) as b, COUNT(*) as calls,
                       COALESCE(SUM(e.duration_ms), 0) as airtime_ms, SUM(e.encrypted > 0) as encrypted
                FROM events e
                WHERE e.ts >= ? AND e.ts < ? AND {CALL_EVENT_FILTER}
                GROUP BY b""",
            (from_ts, bucket_sec, from_ts, to_ts)):
        if 0 <= r["b"] < n:
            series[r["b"]].update(calls=r["calls"], airtime_ms=r["airtime_ms"], encrypted=r["encrypted"] or 0)
    for r in c.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) as b, COUNT(*) as n FROM anomalies "
            "WHERE ts >= ? AND ts < ? GROUP BY b",
            (from_ts, bucket_sec, from_ts, to_ts)):
        if 0 <= r["b"] < n:
            series[r["b"]]["anomalies"] = r["n"]
    return {"from": from_ts, "to": to_ts, "bucket_sec": bucket_sec, "buckets": series}


def _top_series(c, table: str, key: str, days: List[str], top: int, alias_sql: str) -> List[Dict[str, Any]]:
    """Top `top` keys by calls over `days`, each with a per-day calls/airtime series."""
    first, last = days[0], days[-1]
    leaders = c.execute(
        f"""SELECT d.system_id, d.{key} as id, SUM(d.calls) as calls, SUM(d.airtime_ms) as airtime_ms,
                   ({alias_sql}) as alias
            FROM {table} d
            WHERE d.day BETWEEN ? AND ?
            GROUP BY d.system_id, d.{key}
            ORDER BY calls DESC LIMIT ?""",
        (first, last, top)).fetchall()
    out = []
    index = {d: i for i, d in enumerate(days)}
    for row in leaders:
        calls = [0] * len(days)
        airtime = [0] * len(days)
        for r in c.execute(
                f"SELECT day, calls, airtime_ms FROM {table} WHERE system_id=? AND {key}=? AND day BETWEEN ? AND ?",
                (row["system_id"], row["id"], first, last)):
            i = index[r["day"]]
            calls[i] = r["calls"]
            airtime[i] = r["airtime_ms"]
        out.append({
            "system_id": row["system_id"], key: row["id"], "alias": row["alias"],
            "calls": row["calls"], "airtime_ms": row["airtime_ms"],
            "series": {"calls": calls, "airtime_ms": airtime},
        })
    return out


@app.get("/api/trends")
def get_trends(days: int = Query(30, ge=2, le=366), top: int = Query(10, ge=1, le=50)):
    """Daily rollups for the trends dashboard: system totals, top talkgroups and radios.

    Built from the daily_* tables, so it reaches back beyond raw event retention.
    """
    if maintenance_instance:
        maintenance_instance.refresh_today()
    today = datetime.now().date()
    day_list = [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    prev_first = (today - timedelta(days=2 * days - 1)).isoformat()
    c = db()

    metrics = ("calls", "airtime_ms", "encrypted_calls", "unique_rids", "unique_tgs", "anomalies")
    totals = {m: [0] * days for m in metrics}
    index = {d: i for i, d in enumerate(day_list)}
    for r in c.execute(
            f"""SELECT day, {', '.join(f'SUM({m}) as {m}' for m in metrics)}
                FROM daily_system_stats WHERE day BETWEEN ? AND ? GROUP BY day""",
            (day_list[0], day_list[-1])):
        for m in metrics:
            totals[m][index[r["day"]]] = r[m] or 0
    prev = c.execute(
        "SELECT COALESCE(SUM(calls), 0) as calls, COALESCE(SUM(airtime_ms), 0) as airtime_ms, "
        "COALESCE(SUM(anomalies), 0) as anomalies FROM daily_system_stats WHERE day BETWEEN ? AND ?",
        (prev_first, (today - timedelta(days=days)).isoformat())).fetchone()

    return {
        "days": day_list,
        "totals": totals,
        "previous_period": dict(prev),
        "top_talkgroups": _top_series(
            c, "daily_tg_stats", "tgid", day_list, top,
            "SELECT alias FROM talkgroups t WHERE t.system_id = d.system_id AND t.tgid = d.tgid"),
        "top_radios": _top_series(
            c, "daily_rid_stats", "rid", day_list, top,
            "SELECT alias FROM radios t WHERE t.system_id = d.system_id AND t.rid = d.rid"),
    }


@app.get("/api/storage")
def get_storage():
    """Database/audio disk usage, row counts and retention settings."""
    if not maintenance_instance:
        raise HTTPException(status_code=503, detail="Maintenance worker not running")
    return maintenance_instance.storage_stats()


@app.get("/api/topology")
def get_topology():
    """Site and adjacent neighbor site information."""
    c = db()
    sites = [dict(r) for r in c.execute("SELECT * FROM sites ORDER BY id").fetchall()]
    adj = [dict(r) for r in c.execute("SELECT * FROM adjacent_sites ORDER BY ts DESC").fetchall()]
    return {
        "sites": sites,
        "adjacent_sites": adj,
    }


@app.get("/api/audio/stream")
def proxy_audio_stream():
    """Proxy live Icecast audio stream directly to the browser with audio/mpeg media type."""
    cfg = load_config()
    raw_url = poller_instance.latest_status.get("stream_url") if poller_instance else None
    if not raw_url:
        from urllib.parse import urlparse
        p = urlparse(cfg.get("url", "http://127.0.0.1:8080/"))
        host = p.hostname or "127.0.0.1"
        raw_url = f"http://{host}:8675/op25"
    if raw_url.endswith(".m3u"):
        raw_url = raw_url[:-4]

    def stream_generator():
        try:
            with requests.get(raw_url, stream=True, timeout=10) as r:
                for chunk in r.iter_content(chunk_size=4096):
                    if chunk:
                        yield chunk
        except Exception as e:
            logger.warning(f"Audio stream proxy error: {e}")

    return StreamingResponse(
        stream_generator(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/api/audio/call/{event_id}")
def get_call_audio(event_id: int):
    """Stream recorded WAV audio for a specific completed call."""
    wav_path = DATA_DIR / "audio_calls" / f"{event_id}.wav"
    if not wav_path.exists():
        raise HTTPException(status_code=404, detail="Call audio recording not found or retention expired")
    return FileResponse(wav_path, media_type="audio/wav", filename=f"call_{event_id}.wav")



# ---- RF Plots Endpoints -----------------------------------------------------

class PlotToggleRequest(BaseModel):
    plot_id: int
    channel: int = 0


_plot_frame_cache: Dict[str, bytes] = {}


@app.get("/api/plots/{filename}")
def proxy_plot_image(filename: str):
    """Proxy OP25 plot images directly to the client browser with fallback frame cache."""
    safe_name = os.path.basename(filename)
    cfg = load_config()
    base_url = cfg.get("url", "http://127.0.0.1:8080/")
    if not base_url.endswith("/"):
        base_url += "/"
    target_url = f"{base_url}{safe_name}"

    # Extract plot kind key (e.g. plot-0-fft-1138.png -> "0_fft") for fallback caching
    cache_key = "default"
    parts = safe_name.replace(".png", "").split("-")
    if len(parts) >= 3 and parts[0] == "plot":
        cache_key = f"{parts[1]}_{parts[2]}"

    try:
        r = requests.get(target_url, timeout=4)
        if r.status_code == 200 and len(r.content) > 100:
            _plot_frame_cache[cache_key] = r.content
            return Response(
                content=r.content,
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=1",
                },
            )
    except Exception as e:
        logger.debug(f"Transient error fetching plot image {filename}: {e}")

    # Fallback to last known good frame if frame was just rotated or pruned
    if cache_key in _plot_frame_cache:
        return Response(
            content=_plot_frame_cache[cache_key],
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=1",
            },
        )

    return Response(status_code=404, content=b"Plot frame not available", media_type="text/plain")


@app.post("/api/plots/toggle")
def toggle_plot(req: PlotToggleRequest):
    """Toggle a specific RF plot feed on/off on OP25 (plot_id: 1..6)."""
    cfg = load_config()
    base_url = cfg.get("url", "http://127.0.0.1:8080/")
    cmd = [{"command": "toggle_plot", "arg1": req.plot_id, "arg2": req.channel}]
    try:
        r = requests.post(base_url, json=cmd, timeout=5)
        return {"status": "ok", "op25_status": r.status_code}
    except Exception as e:
        logger.error(f"Failed to send toggle_plot command: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# ---- WebSocket Endpoint -----------------------------------------------------

@app.websocket("/ws/live")
async def websocket_live_stream(websocket: WebSocket):
    """Real-time streaming channel for events, telemetry, and alerts."""
    await manager.connect(websocket)
    # Send immediate initial status upon connection
    if poller_instance:
        await websocket.send_text(json.dumps({
            "event": "telemetry",
            "data": poller_instance.latest_status,
        }))
    try:
        while True:
            # Keep connection open; receive client pings/messages if any
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.debug(f"WebSocket client error: {e}")
        manager.disconnect(websocket)


@app.websocket("/ws/audio")
async def websocket_audio_proxy(client_ws: WebSocket):
    """Proxy OP25 port 9000 raw 8kHz PCM audio WebSocket directly to the client browser."""
    await client_ws.accept()
    cfg = load_config()
    op25_audio_url = cfg.get("audio_ws_url") or "ws://127.0.0.1:9000"
    logger.info(f"Client connected to audio WebSocket proxy. Connecting upstream to {op25_audio_url}")

    try:
        async with websockets.connect(op25_audio_url, open_timeout=5) as op25_ws:
            async def forward_to_client():
                try:
                    async for message in op25_ws:
                        if isinstance(message, bytes):
                            await client_ws.send_bytes(message)
                        else:
                            await client_ws.send_text(message)
                except Exception:
                    pass

            async def forward_to_op25():
                try:
                    while True:
                        msg = await client_ws.receive()
                        if msg.get("type") == "websocket.disconnect":
                            return
                        if "bytes" in msg and msg["bytes"]:
                            await op25_ws.send(msg["bytes"])
                        elif "text" in msg and msg["text"]:
                            await op25_ws.send(msg["text"])
                except Exception:
                    pass

            # When either side goes away, tear down the other instead of leaving
            # the upstream socket open until its next failed send.
            tasks = [asyncio.create_task(forward_to_client()), asyncio.create_task(forward_to_op25())]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception as e:
        logger.warning(f"Audio WS proxy disconnected: {e}")
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass
        logger.info("Audio WebSocket proxy closed.")


# ---- SPA Static Files -------------------------------------------------------

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api.main:app", host=host, port=port, reload=False)

