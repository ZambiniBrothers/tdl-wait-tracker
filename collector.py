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
ATTRACTIONS_CONFIG_PATH = Path(__file__).parent / "attractions_config.json"


def load_attractions_config() -> list[dict]:
    if not ATTRACTIONS_CONFIG_PATH.exists():
        return []
    try:
        with open(ATTRACTIONS_CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_attractions_config(attractions: list[dict]) -> None:
    with open(ATTRACTIONS_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(attractions, f, indent=2, ensure_ascii=False)


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


def list_park_rides(park_id: int = TDL_PARK_ID) -> list[dict]:
    """パーク内の全アトラクションを返す（id, name のリスト）。"""
    data = fetch_park_data(park_id)
    rides = []
    for ride in data.get("rides", []):
        rides.append({"id": ride["id"], "name": ride["name"]})
    for land in data.get("lands", []):
        for ride in land.get("rides", []):
            rides.append({"id": ride["id"], "name": ride["name"]})
    return sorted(rides, key=lambda r: r["name"])


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


def _save_ride_record(park_id: int, ride_id: int, ride: dict) -> bool:
    """1アトラクション分を JSONL に追記する。重複の場合は False を返す。"""
    recorded_at = datetime.now(timezone.utc).isoformat()
    last_updated = ride.get("last_updated") or recorded_at

    prev = _last_record_for(ride_id)
    if prev and prev.get("last_updated") == last_updated:
        return False

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

    return True


def collect(park_id: int = TDL_PARK_ID, ride_id: int = MONSTERS_INC_RIDE_ID) -> Optional[dict]:
    """1アトラクション分を収集して JSONL に追記する。"""
    data = fetch_park_data(park_id)
    ride = extract_ride(data, ride_id)
    if ride is None:
        return None
    _save_ride_record(park_id, ride_id, ride)
    return ride


def collect_all(attractions: list[dict]) -> list[tuple[dict, Optional[dict]]]:
    """全登録アトラクションを1パーク1リクエストでまとめて収集する。"""
    from collections import defaultdict
    by_park: dict[int, list[dict]] = defaultdict(list)
    for a in attractions:
        by_park[a.get("park_id", TDL_PARK_ID)].append(a)

    results: list[tuple[dict, Optional[dict]]] = []
    for park_id, park_attractions in by_park.items():
        try:
            data = fetch_park_data(park_id)
        except Exception:
            for a in park_attractions:
                results.append((a, None))
            continue
        for a in park_attractions:
            ride = extract_ride(data, a["ride_id"])
            if ride is not None:
                _save_ride_record(park_id, a["ride_id"], ride)
            results.append((a, ride))

    return results


if __name__ == "__main__":
    attractions = load_attractions_config()
    if not attractions:
        result = collect()
        if result is None:
            print("Ride not found in API response")
        else:
            print(
                f"OK: {result.get('name')} | wait={result.get('wait_time')}min | "
                f"open={result.get('is_open')} | updated={result.get('last_updated')}"
            )
    else:
        for attraction, ride in collect_all(attractions):
            name = attraction.get("display_name") or attraction.get("ride_name")
            if ride is None:
                print(f"NOT FOUND: {name} (ride_id={attraction['ride_id']})")
            else:
                print(
                    f"OK: {name} | wait={ride.get('wait_time')}min | "
                    f"open={ride.get('is_open')} | updated={ride.get('last_updated')}"
                )
