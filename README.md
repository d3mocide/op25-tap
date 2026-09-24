# op25-tap

Real-time APCO P25 trunking telemetry, subscriber monitor, and forensics dashboard fed by OP25's HTTP status endpoint.

> Inspired by [**colonelpanichacks/trunk-tap**](https://github.com/colonelpanichacks/trunk-tap), adapting its tactical telemetry dashboard, call history, and forensic insights for OP25 systems.

Built with a **Python FastAPI** backend (REST + WebSockets) and a modern **Vite + React / TypeScript** tactical frontend.

---

## Prerequisites

**`op25-tap` requires a fully working installation of OP25 by boatbod:**

- **OP25 by boatbod**: [https://github.com/boatbod/op25](https://github.com/boatbod/op25)
  - Ensure OP25 is installed, configured for your local SDR (RTL-SDR, HackRF, Airspy, etc.), and actively decoding your target trunked radio system.
  - **HTTP Server**: OP25 must be launched with its HTTP server status endpoint enabled (e.g. `-l http:0.0.0.0:8080` in `rx.py` or `multi_rx.py`). This is the status feed that `op25-tap` polls.
  - **Live Audio & Transcription (Optional)**: If you want live browser audio streaming and remote Whisper speech-to-text transcription, ensure OP25's raw audio forwarding is enabled (e.g. `-V` flags forwarding 8 kHz mono raw PCM to port `9000`).

---

## Features

- **Live RF Frequency Monitoring**: Visual cards for all monitored frequencies showing channel type (`voice`, `pri-cc`, `alt-cc`), hit counters, and real-time active transmissions.
- **Real-Time Call Stream**: WebSocket-driven call feed showing Talkgroups, Source Radio IDs (RIDs), frequencies, duration, and encryption status (`CLEAR` / `ENC`).
- **Subscriber Registrations & Affiliations**: Live tracking of subscriber Wireless User IDs (RIDs) and their affiliated talkgroups from OP25's `wuid_data`.
- **Talkgroups Directory**: Complete inventory of talkgroups with call statistics and total airtime.
- **History Mode & Date-Range Picker**: Switch from Live to History to replay any past period: presets (last hour, 24h, today, yesterday, 7/30 days), a custom range, and step back/forward buttons. Every panel (calls, transcripts and audio, subscribers, talkgroups, alerts) is scoped to the range, and the URL (`?from=…&to=…`) can be bookmarked or shared.
- **Activity Timeline**: Calls-per-interval bar chart for the selected range with alert markers. Drag to zoom, click a bar to drill in, browser Back to zoom out.
- **Trends Dashboard**: 7/30/90-day KPIs with sparklines and period-over-period change, a clickable calls-per-day chart, and top talkgroups/radios with daily sparklines. Built from daily rollups that are kept after raw history expires.
- **Retention Policy**: Raw history and call audio are purged on a schedule so the database doesn't grow without bound; disk usage is shown in the footer.
- **Network Topology**: Discovered adjacent neighbor towers and uplink frequencies from control channel broadcast messages.
- **Embedded Audio Stream**: Integrated Icecast audio player with live streaming and volume control.
- **Remote Whisper Speech-to-Text**: Automatic background capture of OP25 port 9000 raw PCM audio, retention window buffering, remote Whisper transcription, and inline speech bubbles with historical audio playback in the Call History feed.
- **Single-Port or Containerized**: FastAPI serves both the API, WebSocket stream, and compiled frontend SPA from a single port.

---

## Quickstart

### Running with Docker

#### Production (Single Port 8000)
```bash
# Start pre-compiled single-port production instance
docker compose up --build -d
```
Visit **`http://localhost:8000/`** in your browser.

#### Development with Hot-Reload (Vite HMR on Port 5173)
```bash
# Start dev instance with live UI hot-reload and backend auto-reload
docker compose -f docker-compose.dev.yml up --build -d
```
Visit **`http://localhost:5173/`** in your browser. Any edits in `web/src/` or backend Python files update live instantly without rebuilding the container!


### Running Locally

#### 1. Setup Backend

```bash
# Create venv and install dependencies
uv venv
uv pip install -r requirements.txt

# Start backend server (serves API and compiled frontend at http://localhost:8000)
# (Windows: .venv\Scripts\uvicorn.exe ...)
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
```

#### 2. Development Mode with Frontend Hot-Reload

```bash
# In another terminal:
cd web
npm install
npm run dev
```

Open **`http://localhost:5173/`** for hot-reloading (API requests and WebSockets are automatically proxied to port 8000).

---

## Configuration

### 1. Primary Configuration: `.env` (Recommended)

For almost all setups, configuration is handled via environment variables or a `.env` file in the project root. Copy `.env.example` to get started:

```bash
cp .env.example .env
```

| Variable             | Default               | Description                                                 |
| :------------------- | :-------------------- | :---------------------------------------------------------- |
| `OP25_URL`           | `http://<op25-host>:8080/` | Target OP25 receiver HTTP endpoint                          |
| `OP25_AUDIO_WS`      | _(auto-derived)_           | Optional raw PCM WebSocket URL (e.g. `ws://<op25-host>:9000`) |
| `OP25_POLL_INTERVAL` | `1.0`                 | Polling frequency in seconds                                |
| `OP25_HOLD_SECONDS`  | `3.0`                 | Hang time before an inactive call is considered closed      |
| `OP25_SYSTEM_NAME`   | `County P25`          | Default human-readable label if OP25 reports no system name |
| `HOST`               | `0.0.0.0`             | API server host binding                                     |
| `PORT`               | `8000`                | API server port binding                                     |
| `OP25TAP_DATA_DIR`   | `./data`              | Directory for persistent SQLite databases and cache         |
| `WHISPER_URL`        | _(disabled)_          | Remote OpenAI-compatible Whisper transcription URL          |
| `WHISPER_MODEL`      | `base.en`             | Whisper model name passed to remote API                     |
| `WHISPER_API_KEY`    | _(optional)_          | Bearer token or authorization key for Whisper service       |
| `WHISPER_LANGUAGE`   | `en`                  | Spoken language hint for transcription                      |
| `RETENTION_DAYS`     | `30`                  | Days of raw history (calls, affiliations, roaming, alerts) to keep; `0` keeps everything |
| `AUDIO_RETENTION_HOURS` | `168`              | Hours to keep recorded call audio for playback; `0` disables saving audio (was `WHISPER_RETENTION_HOURS`, still honored) |
| `MAINTENANCE_INTERVAL_MINUTES` | `15`        | How often rollups, purging and audio cleanup run            |
| `TZ`                 | _(system)_            | Time zone that defines "a day" for daily trends (e.g. `America/Chicago`; set it in Docker, which defaults to UTC) |

### 2. Optional Advanced Configuration: `config/`

If you require advanced capabilities such as polling multiple OP25 instances simultaneously, granular hex NAC lookup tables, or custom regex naming rules, you can optionally supply JSON files in the `config/` folder:

- **`config/op25.json`**: Multi-endpoint arrays (`endpoints: [...]`) and NAC/SYSID mapping tables (`systems: { "0x3cc": "County P25" }`). See [config/op25.example.json](config/op25.example.json).
- **`config/systems.json`**: Regex/prefix system name canonicalization rules and RadioReference System ID deep-links (`rr_sids`). See [config/systems.example.json](config/systems.example.json).

_For in-depth schema documentation on JSON configuration, see [config/README.md](config/README.md)._

### 3. Data Retention & History

A background maintenance job (every `MAINTENANCE_INTERVAL_MINUTES`) keeps storage bounded:

| Data | Kept for | Notes |
| :--- | :------- | :---- |
| Calls, affiliations, roaming, alerts | `RETENTION_DAYS` (30) | Cut at local midnight, so a day is either fully kept or fully purged |
| Call audio (WAV) | `AUDIO_RETENTION_HOURS` (168) | About 1 MB per minute of audio, which is usually the biggest consumer of disk space |
| Daily rollups (per system, talkgroup, radio) | Forever | Very small; powers the Trends dashboard beyond the raw retention window |
| Talkgroup / radio / site directories | Forever | Names, first/last seen, lifetime counters |

Every day is rolled up before it's purged. Freed space is returned to the OS (SQLite incremental vacuum). `GET /api/storage` reports DB and audio size, row counts and the oldest retained record.

Schema changes are applied automatically on startup through numbered migrations (`PRAGMA user_version`). The first start after upgrading drops the unused trunk-tap tables and runs a one-time `VACUUM`, which can take a moment on a large database.

---

## Project Structure

```
op25-tap/
├── api/                  # FastAPI application & WebSocket handlers
│   └── main.py
├── config/               # Configuration files (endpoints, system mappings)
│   ├── op25.json
│   └── op25.example.json
├── db/                   # SQLite schema & database helpers
│   ├── __init__.py
│   └── schema.sql
├── ingest/               # OP25 status poller, diff engine, anomaly detection, retention
│   ├── op25_trunk.py
│   ├── anomalies.py
│   └── maintenance.py    # daily rollups, retention purge, audio cleanup
├── samples/              # Captured raw OP25 status dumps
├── tests/                # Automated ingest tests
├── web/                  # Vite + React / TypeScript tactical frontend
│   ├── src/
│   │   ├── components/   # Header, VoiceGrid, LiveEventFeed, SubscribersTable, etc.
│   │   ├── hooks/        # useLiveTelemetry (WebSocket), useTimeRange (URL), useHistoryData
│   │   └── types.ts
│   └── dist/             # Compiled production bundle
├── Dockerfile            # Multi-stage Docker build
└── docker-compose.yml
```

---

## Acknowledgments & Credits

- [**colonelpanichacks/trunk-tap**](https://github.com/colonelpanichacks/trunk-tap) — The pioneer SDRTrunk forensics dashboard whose architecture, anomaly tracking patterns, and UI philosophy directly inspired `op25-tap`.
- [**boatbod/op25**](https://github.com/boatbod/op25) — The foundational open-source OP25 software-defined radio implementation for P25 Phase 1 / Phase 2 digital trunking and HTTP telemetry reporting.

