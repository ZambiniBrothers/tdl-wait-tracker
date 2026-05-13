from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

QUEUE_TIMES_URL = "https://queue-times.com/parks/{park_id}/queue_times.json"

TDL_PARK_ID = 274
MONSTERS_INC_RIDE_ID = 8018

DATA_DIR = Path(__file__).parent / "data"
JSONL_PATH = DATA_DIR / "wait_times.jsonl"


def fetch_park_data(park_id: int) -> dict:
    response = requests.get(
        QUEUE_TIMES_URL.format(park_id=park_id),
        timeout=10,
        headers={"User-Agent": "tdl-wait-estimator/0.1"},
    )
    response.raise_for_status()
    return response.json()


def extract_ride(data: dict, ride_id: int) -> Optional[dict]:
    for ride in data.get("rides", []):
        if ride.get("id") == ride_id:
            return ride
    for land in data.get("lands", []):
        for ride in land.get("rides", []):
            if ride.get("id") == ride_id:
                return ride
    return None


def _last_record_for(ride_id: int) -> Optional[dict]:
    if not JSONL_PATH.exists():
        return None
    last = None
    with open(JSONL_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("ride_id") == ride_id:
                last = rec
    return last


def collect(park_id: int = TDL_PARK_ID, ride_id: int = MONSTERS_INC_RIDE_ID) -> Optional[dict]:
    data = fetch_park_data(park_id)
    ride = extract_ride(data, ride_id)
    if ride is None:
        return None

    recorded_at = datetime.now(timezone.utc).isoformat()
    last_updated = ride.get("last_updated") or recorded_at

    prev = _last_record_for(ride_id)
    if prev and prev.get("last_updated") == last_updated:
        return ride

    record = {
        "park_id": park_id,
        "ride_id": ride_id,
        "ride_name": ride.get("name"),
        "wait_time": ride.get("wait_time"),
        "is_open": bool(ride.get("is_open")),
        "last_updated": last_updated,
        "recorded_at": recorded_at,
    }

    DATA_DIR.mkdir(exist_ok=True)
    with open(JSONL_PATH, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    return ride


if __name__ == "__main__":
    result = collect()
    if result is None:
        print("Ride not found in API response")
    else:
        print(
            f"OK: {result.get('name')} | wait={result.get('wait_time')}min | "
            f"open={result.get('is_open')} | updated={result.get('last_updated')}"
        )
