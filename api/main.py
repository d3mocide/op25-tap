import asyncio
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
import requests
import websockets

from db import DATA_DIR, db, init_db
from ingest.audio_recorder import AudioRecorder
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


# ---- Lifespan Background Poller & Audio Pipeline ----------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global poller_instance, poller_thread, audio_recorder_instance, whisper_dispatcher_instance
    init_db()
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
    if audio_recorder_instance:
        audio_recorder_instance.stop()
    if whisper_dispatcher_instance:
        whisper_dispatcher_instance.stop()


app = FastAPI(title="op25-tap API", lifespan=lifespan)

# Allow CORS for development (Vite dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


@app.get("/api/events")
def get_events(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    tgid: Optional[int] = None,
    rid: Optional[int] = None,
    since: Optional[float] = None,
):
    """Recent synthesized and decoded call events with pagination and filters."""
    c = db()
    query = """
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
        WHERE e.to_tgid IS NOT NULL
          AND NOT (
              e.duration_ms = 0
              AND EXISTS (
                  SELECT 1 FROM events e2
                  WHERE e2.id != e.id
                    AND e2.frequency = e.frequency
                    AND e2.to_tgid = e.to_tgid
                    AND ABS(e2.ts - e.ts) <= 6.0
                    AND e2.duration_ms > 0
              )
          )
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

    query += " ORDER BY e.ts DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/talkgroups")
def get_talkgroups(limit: int = Query(200, ge=1, le=1000), search: Optional[str] = None):
    """List talkgroups with call stats and labels."""
    c = db()
    query = """
        SELECT tg.id, tg.system_id, s.name as system_name, tg.tgid, tg.alias,
               tg.tg_group, tg.tg_tag, tg.priority, tg.encrypted,
               tg.call_count, tg.total_ms, tg.first_seen, tg.last_seen
        FROM talkgroups tg
        LEFT JOIN systems s ON tg.system_id = s.id
        WHERE 1=1
    """
    params: List[Any] = []
    if search:
        query += " AND (tg.alias LIKE ? OR CAST(tg.tgid AS TEXT) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term])
    query += " ORDER BY tg.last_seen DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/radios")
def get_radios(limit: int = Query(200, ge=1, le=1000), search: Optional[str] = None):
    """List radios/subscribers with call stats."""
    c = db()
    query = """
        SELECT r.id, r.system_id, s.name as system_name, r.rid, r.alias,
               r.call_count, r.total_ms, r.first_seen, r.last_seen
        FROM radios r
        LEFT JOIN systems s ON r.system_id = s.id
        WHERE 1=1
    """
    params: List[Any] = []
    if search:
        query += " AND (r.alias LIKE ? OR CAST(r.rid AS TEXT) LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term])
    query += " ORDER BY r.last_seen DESC LIMIT ?"
    params.append(limit)
    rows = c.execute(query, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/affiliations")
def get_affiliations(limit: int = Query(100, ge=1, le=500)):
    """Active subscriber registrations and affiliations."""
    c = db()
    rows = c.execute(
        """SELECT a.id, a.ts, a.system_id, s.name as system_name, a.site_id,
                  COALESCE(st.name, st.site_id) as site_str, a.rid, r.alias as radio_alias,
                  a.tgid, tg.alias as tg_alias
           FROM affiliations a
           LEFT JOIN systems s ON a.system_id = s.id
           LEFT JOIN sites st ON a.site_id = st.id
           LEFT JOIN radios r ON a.system_id = r.system_id AND a.rid = r.rid
           LEFT JOIN talkgroups tg ON a.system_id = tg.system_id AND a.tgid = tg.tgid
           ORDER BY a.ts DESC LIMIT ?""",
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/anomalies")
def get_anomalies(limit: int = Query(50, ge=1, le=200)):
    """Novelty and traffic spike alerts."""
    c = db()
    rows = c.execute(
        """SELECT an.id, an.ts, an.kind, an.system_id, s.name as system_name,
                  an.site_id, an.rid, r.alias as radio_alias, an.tgid,
                  tg.alias as tg_alias, an.details, an.ack
           FROM anomalies an
           LEFT JOIN systems s ON an.system_id = s.id
           LEFT JOIN radios r ON an.system_id = r.system_id AND an.rid = r.rid
           LEFT JOIN talkgroups tg ON an.system_id = tg.system_id AND an.tgid = tg.tgid
           ORDER BY an.ts DESC LIMIT ?""",
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


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
                        if "bytes" in msg and msg["bytes"]:
                            await op25_ws.send(msg["bytes"])
                        elif "text" in msg and msg["text"]:
                            await op25_ws.send(msg["text"])
                except Exception:
                    pass

            await asyncio.gather(forward_to_client(), forward_to_op25())
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

