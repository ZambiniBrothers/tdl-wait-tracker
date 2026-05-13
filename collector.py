from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import requests

QUEUE_TIMES_URL = "https://queue-times.com/parks/{park_id}/queue_times.json"
SCHEDULE_API_URL = "https://api.themeparks.wiki/v1/entity/{entity_id}/schedule"

TDL_PARK_ID = 274
TDL_ENTITY_ID = "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42"  # themeparks.wiki の TDL ID
MONSTERS_INC_RIDE_ID = 8018

# 運営時間の前後にこの分だけバッファをとって収集する
SCHEDULE_BUFFER_MINUTES = 15

JST = timezone(timedelta(hours=9))

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


def fetch_park_schedule(entity_id: str = TDL_ENTITY_ID) -> list[dict]:
    """themeparks.wiki から運営スケジュール（向こう数週間）を取得する。"""
    response = requests.get(
        SCHEDULE_API_URL.format(entity_id=entity_id),
        timeout=10,
        headers={"User-Agent": "tdl-wait-estimator/0.1"},
    )
    response.raise_for_status()
    return response.json().get("schedule", [])


def get_today_hours(
    now_utc: Optional[datetime] = None,
    entity_id: str = TDL_ENTITY_ID,
) -> Optional[tuple[datetime, datetime]]:
    """今日の運営時間 (open_utc, close_utc) を返す。閉園日・取得失敗時は None。"""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    try:
        schedule = fetch_park_schedule(entity_id)
    except Exception:
        return None

    today_jst = now_utc.astimezone(JST).date().isoformat()
    for entry in schedule:
        if entry.get("date") == today_jst and entry.get("type") == "OPERATING":
            return (
                datetime.fromisoformat(entry["openingTime"]),
                datetime.fromisoformat(entry["closingTime"]),
            )
    return None


def is_park_open_now(
    now_utc: Optional[datetime] = None,
    buffer_minutes: int = SCHEDULE_BUFFER_MINUTES,
) -> tuple[bool, str]:
    """現在パーク運営中か(バッファ込み)。理由文字列も返す。

    スケジュール取得失敗時は安全側に倒して True を返す(収集を続行)。
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)

    try:
        schedule = fetch_park_schedule()
    except Exception as e:
        return True, f"スケジュール取得失敗、収集継続: {e}"

    today_jst = now_utc.astimezone(JST).date().isoformat()
    today_entry = next((e for e in schedule if e.get("date") == today_jst), None)

    if today_entry is None:
        return True, "本日のスケジュール情報なし、収集継続"

    entry_type = today_entry.get("type")
    if entry_type != "OPERATING":
        return False, f"本日は {entry_type}"

    open_t = datetime.fromisoformat(today_entry["openingTime"])
    close_t = datetime.fromisoformat(today_entry["closingTime"])
    buffer = timedelta(minutes=buffer_minutes)

    if now_utc < open_t - buffer:
        return False, f"開園前 (本日 {open_t.astimezone(JST).strftime('%H:%M')} 開園)"
    if now_utc > close_t + buffer:
        return False, f"閉園後 (本日 {close_t.astimezone(JST).strftime('%H:%M')} 閉園)"

    return True, f"運営中 ({open_t.astimezone(JST).strftime('%H:%M')}-{close_t.astimezone(JST).strftime('%H:%M')})"


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
    is_open, reason = is_park_open_now()
    print(f"Park status: {reason}")
    if not is_open:
        sys.exit(0)

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
