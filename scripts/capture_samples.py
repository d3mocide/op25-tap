"""Phase 1: save raw OP25 status responses so field names can be confirmed.

Usage: python scripts/capture_samples.py [url] [count] [interval_s]
Writes samples/<n>.json (+ prints the json_type keys seen).

boatbod/op25's http_server takes a POST of a JSON command list; the dashboard
JS sends [{"command":"update","arg1":0,"arg2":0}] and gets a list of dicts back.
(From memory -- if POST fails, try a plain GET.)
"""
import json, sys, time
from pathlib import Path
import requests

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/"
count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
interval = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
out = Path(__file__).resolve().parents[1] / "samples"
out.mkdir(exist_ok=True)

for i in range(count):
    try:
        r = requests.post(url, json=[{"command": "update", "arg1": 0, "arg2": 0}], timeout=5)
        data = r.json()
    except Exception as e:
        print(f"[{i}] error: {e!r}")
    else:
        (out / f"{i:03d}.json").write_text(json.dumps(data, indent=1))
        items = data if isinstance(data, list) else [data]
        print(f"[{i}]", [d.get("json_type") for d in items if isinstance(d, dict)])
    time.sleep(interval)
