# op25-tap: Design Notes

Status: brainstorm / pre-implementation. Written from an analysis of
`trunk-tap-downstream` (SDRTrunk-based) as a reference implementation, plus
general knowledge of OP25's data surface. **Field names for OP25's JSON feed
are stated from memory and flagged below — confirm against a live instance
before coding against them.**

## 0. Baseline: what trunk-tap does today

Reference repo: `trunk-tap-downstream` (this repo). Two independent ingest
lanes feed one SQLite DB, reconciled into a single "system" identity:

1. **RDIO Scanner protocol POST** (`ingest/rdio.py`, endpoint
   `/api/call-upload`) — SDRTrunk pushes one `multipart/form-data` POST per
   _completed call_: audio file + `systemLabel`, `talkgroup`,
   `talkgroupLabel`, `source` (radio id), `frequency`, `dateTime`. This is
   SDRTrunk imitating an upload to a real
   [rdio-scanner](https://github.com/chuot/rdio-scanner) server. trunk-tap
   just implements that server's contract, including a magic
   `"incomplete call data: no talkgroup"` response SDRTrunk's broadcaster
   checks for to mark the target healthy. No site/registration/deny/patch
   data — not in this protocol.

2. **Event-log tail** (`ingest/tail.py`) — SDRTrunk writes a CSV per channel
   to `event_logs/*_call_events.log`
   (`TIMESTAMP,DURATION_MS,PROTOCOL,EVENT,FROM,TO,CHANNEL_NUMBER,FREQUENCY,
TIMESLOT,DETAILS,EVENT_ID`). trunk-tap tails these with `watchdog` (+ 1s
   poll fallback), tracking a byte offset per file (`ingest_state` table) so
   it survives restarts. Per row it: regex-parses `FROM`/`TO` (format
   `"[Label] (12345)"` / `"(12345)"` / `"12345"`), branches on `EVENT` type
   (`Group Call`, `Unit Call`, `Data Call`, `Response`, `Register`, ...),
   splits `CHANNEL_NUMBER` (`"1-1"`) into a site key, infers encryption from
   `"ENCRYPT"` substrings in free-text `DETAILS`, and dedups/merges on
   SDRTrunk's own `EVENT_ID` (multiple log rows per event as it fills in).
   This is where all the forensic depth comes from: `affiliations`,
   `roaming`, `denies`, `patches`, `adjacent_sites`, anomaly detection
   (new RID/TG/site, spikes).

**Reconciliation**: SDRTrunk's per-site event-log filenames
(`"County P25 East"`) don't match the RDIO upload's `systemLabel`
(`"Countywide"`) — `canonical_system()` (config-driven,
`config/systems.json` → `canonical_rules`) folds them into one identity so a
call and its control-channel events are recognized as the same network.
`ingest/aliases.py` separately bulk-imports TG names/groups from SDRTrunk's
playlist XML.

Schema: `db/schema.sql` — `systems`, `sites`, `talkgroups`, `radios`,
`calls` (has `raw_json` for full forensics), `events`, `affiliations`,
`roaming`, `patches`, `denies`, `adjacent_sites`, `anomalies`,
`calls_fts` (FTS5 over transcripts), `ingest_state` (tail offsets).

## 1. Goal

Stand up an equivalent dashboard fed by OP25 instead of SDRTrunk — same DB
shape and UI where possible, different ingest lane(s) underneath. Working
name: `op25-tap`.

## 2. OP25 as a data source

OP25's own web dashboard is fed by a live HTTP JSON status endpoint (commonly
port 8080, e.g. `boatbod/op25`'s `http_server.py` terminal type). This is a
**snapshot poll**, not an append-only event log like SDRTrunk's CSVs — it
reflects current state and gets re-fetched on an interval by the dashboard
JS. From memory, the shape is roughly two `json_type` blobs (verify — this
varies by fork/version):

- `trunk_update` — per monitored system: NAC, WACN, SYSID, RFID/STID, and a
  `frequency_data` map of `{freq_hz: {tag, srcaddr, tgid, mode, time}}`
  describing recent activity per control/voice frequency.
- `channel_update` — per active receive channel: freq, tgid, srcaddr, error
  rate, stream info.

What this does **not** give you (unlike SDRTrunk's decoded control-channel
log): a discrete `EVENT_ID`-keyed stream of register/affiliation/deny/patch
messages. OP25 sees those on the control channel but its status API
summarizes into current state rather than logging every message. Whether
your specific setup logs anything richer (OP25 has various `-l`/logging
options, and some forks/log adapters exist) is one of the things to check
against your actual instance.

**Audio**: SDRTrunk hands over one call = one clean POST with audio
attached. OP25 doesn't do this natively. Options, roughly in order of least
to most invasive:

- Check whether your OP25 setup already has an rdio-scanner-style
  uploader in front of it (some community configs push call audio +
  metadata to an rdio-scanner-compatible endpoint). **If so, `ingest/rdio.py`
  may work almost unchanged** — this is the cheapest possible win, see
  §4.1.
- Otherwise, capture OP25's own audio output (per-call file, if
  configured to write one; or continuous stream from a wireshark/UDP
  audio sink) and correlate it back to JSON state by timestamp + tgid —
  a fuzzier join than SDRTrunk's atomic call record.

## 3. Proposed architecture

### 3.1 Cheapest path — check this first

Before building anything: does your OP25 install already (or could it
easily) push finished calls to an rdio-scanner-compatible target? If yes,
point it at `/api/call-upload` and **reuse `ingest/rdio.py` as-is** — it's
protocol-shaped, not SDRTrunk-shaped, so nothing in it actually assumes
SDRTrunk except the `protocol="APCO-25"` label and the health-check text
(which any real rdio-scanner client, including a generic uploader, would
also expect). That leaves only the control-channel/site lane to build.

### 3.2 New lane: `ingest/op25_trunk.py` (replaces `ingest/tail.py`'s role)

Poll-and-diff instead of tail-and-dedup:

- Poll the OP25 JSON status endpoint on an interval (start with whatever
  the OP25 dashboard itself uses, likely ~1s).
- Keep last-seen state in memory (or a small table, analogous to
  `ingest_state`) keyed by `(system, freq)` or `(system, tgid)`.
- Diff against the previous poll to synthesize "events": `srcaddr` changed
  on a freq → transmission start (≈ SDRTrunk's `Group Call`/`Unit Call`);
  new `tgid` never seen on this system → first-seen (feeds the same
  `anomalies` novelty logic as `tail.py`'s `_detect_novelty`); `mode`
  indicating encrypted → `encrypted` flag.
- NAC/WACN/SYSID/RFID/STID map more cleanly onto `sites` than SDRTrunk's
  opaque `"1-1"` site string does — arguably an improvement in that one
  corner.
- No registrations/denies/patches/adjacent-sites unless a further OP25 data
  source is found — those tables would just stay empty, or get dropped from
  the schema for this variant. Decide per §5.

### 3.3 Schema

Reuse `db/schema.sql` largely as-is — it's decoder-agnostic in structure
(systems/sites/talkgroups/radios/calls/events). Candidate changes:

- `sites`: consider populating `rfss`/`wacn` columns (already present but
  SDRTrunk's ingest never fills them) from OP25's NAC/WACN/SYSID.
  Drop/repurpose whichever of `affiliations`/`denies`/`patches`/
  `adjacent_sites` end up permanently empty for this variant, or leave them
  as no-ops for forward compatibility.
- `events.event_id`: OP25 has no equivalent — dedup key becomes
  synthetic (e.g. `(system_id, freq, srcaddr, ts_bucket)`), decided in §5.

### 3.4 Config

Analogous to `config/systems.json`'s `canonical_rules`: an
`config/op25.json` (or reuse `systems.json`) mapping OP25's per-system NAC/
label to the canonical system name, plus the endpoint URL(s)/poll interval.

## 4. Field mapping table (draft — confirm names against live JSON)

| OP25 field (approx.)           | trunk-tap column                                                              |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `srcaddr`                      | `radios.rid` / `events.from_rid`                                              |
| `tgid`                         | `talkgroups.tgid` / `events.to_tgid`                                          |
| `freq` (already Hz)            | `calls.frequency` / `events.frequency`                                        |
| `tag`                          | `talkgroups.alias` (seed, cheaper than SDRTrunk's playlist-XML import)        |
| `nac` / `wacn` / `sysid`       | `sites.rfss` / `sites.wacn` / system identity                                 |
| `mode` (`"encrypted"`/digital) | `encrypted` flag (explicit — better than SDRTrunk's DETAILS-string sniffing)  |
| `time` / poll timestamp        | `events.ts` (synthesized, not decoder-native like SDRTrunk's `EVENT_ID` rows) |

## 5. Open questions to resolve against your live instance

1. What does a raw response from your OP25 status endpoint actually look
   like? (paste a sample — this drives every column in §4)
2. Does your OP25 setup emit anything beyond the dashboard JSON — any log
   file, MQTT feed, or rdio-scanner-compatible uploader already running?
3. How is audio currently being captured/stored on your box, if at all?
4. Is there more than one OP25 instance/system to unify (the
   `canonical_system` problem), or just one?
5. Poll interval vs. load: how chatty can we be against the endpoint
   without stepping on OP25 itself?

## 6. Suggested phased build

1. Pull a handful of raw JSON samples from the live endpoint; nail down
   §4's mapping for real.
2. Build `ingest/op25_trunk.py` as a poll-and-diff loop writing straight
   into `events`/`radios`/`talkgroups`/`sites`/`anomalies` — no audio yet.
   Get the live dashboard's event feed and topology graph working off pure
   OP25 telemetry.
3. Solve audio separately (rdio-scanner bridge if available, else a
   capture+correlate step) and wire into `calls`.
4. Revisit which of `affiliations`/`denies`/`patches`/`adjacent_sites`
   are worth keeping vs. dropping for this variant.

## 7. Risks / gotchas carried over from trunk-tap

- Encryption inference: OP25's `mode` field, if it exists as such, is
  likely more reliable than SDRTrunk's DETAILS-string sniffing — worth
  leaning on it directly rather than re-deriving from audio presence.
- Dedup: without an `EVENT_ID`, a noisy poll loop can double-count a single
  transmission as multiple "events" if the diff logic isn't debounced —
  budget time for this before assuming parity with SDRTrunk's clean
  per-event rows.
- Everything in trunk-tap's README "Gotchas learned the hard way" section
  about the RDIO Scanner health-check string still applies if §3.1's bridge
  path is used.
