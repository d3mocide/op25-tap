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
.venv\Scripts\uvicorn.exe api.main:app --host 0.0.0.0 --port 8000
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
| `WHISPER_RETENTION_HOURS` | `24`             | Hours to keep recorded call audio on disk for UI playback   |

### 2. Optional Advanced Configuration: `config/`

If you require advanced capabilities such as polling multiple OP25 instances simultaneously, granular hex NAC lookup tables, or custom regex naming rules, you can optionally supply JSON files in the `config/` folder:

- **`config/op25.json`**: Multi-endpoint arrays (`endpoints: [...]`) and NAC/SYSID mapping tables (`systems: { "0x3cc": "County P25" }`). See [config/op25.example.json](file:///d:/Projects/op25-tap/config/op25.example.json).
- **`config/systems.json`**: Regex/prefix system name canonicalization rules and RadioReference System ID deep-links (`rr_sids`). See [config/systems.example.json](file:///d:/Projects/op25-tap/config/systems.example.json).

_For in-depth schema documentation on JSON configuration, see [config/README.md](file:///d:/Projects/op25-tap/config/README.md)._

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
├── ingest/               # OP25 status poller, diff engine, and anomaly detection
│   ├── op25_trunk.py
│   └── anomalies.py
├── samples/              # Captured raw OP25 status dumps
├── tests/                # Automated ingest tests
├── web/                  # Vite + React / TypeScript tactical frontend
│   ├── src/
│   │   ├── components/   # Header, VoiceGrid, LiveEventFeed, SubscribersTable, etc.
│   │   ├── hooks/        # useLiveTelemetry WebSocket & REST hook
│   │   └── types.ts
│   └── dist/             # Compiled production bundle
├── Dockerfile            # Multi-stage Docker build
└── docker-compose.yml
```

---

## Acknowledgments & Credits

- [**colonelpanichacks/trunk-tap**](https://github.com/colonelpanichacks/trunk-tap) — The pioneer SDRTrunk forensics dashboard whose architecture, anomaly tracking patterns, and UI philosophy directly inspired `op25-tap`.
- [**boatbod/op25**](https://github.com/boatbod/op25) — The foundational open-source OP25 software-defined radio implementation for P25 Phase 1 / Phase 2 digital trunking and HTTP telemetry reporting.

