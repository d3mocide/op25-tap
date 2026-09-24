# Optional Advanced Configuration Directory

This directory provides **optional, advanced configuration** for `op25-tap`.

> [!NOTE]
> **For standard single-receiver deployments, you do NOT need any files in this directory.**
> All primary settings (`OP25_URL`, `OP25_AUDIO_WS`, `OP25_POLL_INTERVAL`, `OP25_HOLD_SECONDS`, `OP25_SYSTEM_NAME`, `HOST`, `PORT`, `OP25TAP_DATA_DIR`) can be configured directly in your root `.env` file.

---

## 1. `op25.json` (Advanced Receiver & System Mappings)

If you need to poll multiple OP25 instances or map specific hex Network Access Codes (NAC) / System IDs (SYSID) to friendly names, copy `op25.example.json` to `op25.json`:

```bash
cp config/op25.example.json config/op25.json
```

### Schema & Fields

```json
{
  "endpoints": [
    { "url": "http://<op25-host>:8080/", "poll_interval": 1.0 }
  ],
  "audio_ws_url": "ws://<op25-host>:9000",
  "hold_seconds": 3.0,
  "systems": {
    "972": "County P25",
    "0x3cc": "County P25",
    "0x3c0": "County P25"
  }
}
```

- **`endpoints`**: List of OP25 HTTP servers to poll concurrently.
- **`audio_ws_url`**: WebSocket endpoint for raw PCM audio (port 9000).
- **`hold_seconds`**: Silence hang time in seconds before an inactive call transmission is closed.
- **`systems`**: Dictionary mapping numeric/hex NACs, SYSIDs, or raw system strings to human-readable network labels.

*Note: If an environment variable like `OP25_URL` is set, it overrides the corresponding entry in `op25.json`.*

---

## 2. `systems.json` (Canonical Naming & RadioReference Integration)

Used for deep-linking to RadioReference and normalizing site names. Copy `systems.example.json` to `systems.json`:

```bash
cp config/systems.example.json config/systems.json
```

### Schema & Fields

```json
{
  "canonical_rules": [
    { "exact": { "County P25 Control": "Countywide" } },
    { "prefix": "County P25", "canonical": "Countywide" },
    { "prefix": "STATEP25 ", "canonical": "State P25" }
  ],
  "rr_sids": {
    "Countywide": 1234,
    "State P25": 5678
  }
}
```

- **`canonical_rules`**: Evaluated in order. Replaces site-specific names with a unified canonical network name.
  - `exact`: Exact dictionary match.
  - `prefix`: Prefix match and replacement.
- **`rr_sids`**: Maps canonical system names to RadioReference System IDs (`https://www.radioreference.com/db/sid/<id>`). Enables one-click RadioReference links in the UI.

---

## Git & Docker Behavior

- `config/op25.json` and `config/systems.json` are listed in `.gitignore` so your personal site URLs and mappings are never accidentally committed to git.
- The `config/` directory is mounted into Docker at `/app/config` via `docker-compose.yml`, allowing changes to take effect without rebuilding the container image.
