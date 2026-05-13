from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class ThroughputConfig:
    """モンスターズインクの処理能力を物理パラメータから計算する設定"""
    people_per_car: float = 6.0      # 1台あたり平均乗車人数(2人×3列)
    cars_per_dispatch: int = 2        # 同時発車する台数
    seconds_per_dispatch: float = 30  # 1組の発車間隔(秒)
    walkon_utilization: float = 0.5   # 待ち時間0分の時に何%が稼働しているか

    @property
    def people_per_minute(self) -> float:
        dispatches_per_minute = 60.0 / self.seconds_per_dispatch
        return self.people_per_car * self.cars_per_dispatch * dispatches_per_minute

    @property
    def people_per_hour(self) -> float:
        return self.people_per_minute * 60.0


def compute(df: pd.DataFrame, config: ThroughputConfig) -> pd.DataFrame:
    """
    入力 df:
      - timestamp: datetime (JST想定)
      - wait_time: int (分)
      - is_open: int (0/1)

    返り値 df に下記列を追加:
      - queue_length: 現在列にいる推定人数 = people_per_min * wait_time
      - dt_min: 前サンプルからの経過分
      - served: この区間で乗車した推定人数
      - cumulative_users: 累計利用者数
      - arrival_rate_per_hour: 到着率の推定 (人/時)
    """
    df = df.sort_values("timestamp").reset_index(drop=True).copy()
    ppm = config.people_per_minute

    df["queue_length"] = (ppm * df["wait_time"].clip(lower=0)).astype(float)
    df["dt_min"] = df["timestamp"].diff().dt.total_seconds() / 60.0

    is_open_prev = df["is_open"].shift(1).fillna(0).astype(int)
    is_open_curr = df["is_open"].astype(int)
    L_prev = df["queue_length"].shift(1).fillna(0.0)
    L_curr = df["queue_length"]

    both_open = (is_open_prev == 1) & (is_open_curr == 1)
    has_queue = (L_prev > 0) | (L_curr > 0)

    served_rate_per_min = np.where(
        both_open & has_queue,
        ppm,
        np.where(both_open & ~has_queue, config.walkon_utilization * ppm, 0.0),
    )
    df["served"] = (served_rate_per_min * df["dt_min"].fillna(0.0)).astype(float)
    df["cumulative_users"] = df["served"].cumsum()

    dL = df["queue_length"].diff()
    arrival_per_min = (ppm + dL / df["dt_min"]).clip(lower=0)
    arrival_per_min = arrival_per_min.where(is_open_curr == 1, 0.0)
    df["arrival_rate_per_hour"] = arrival_per_min * 60.0

    return df


def summarize(df: pd.DataFrame) -> dict:
    if len(df) == 0:
        return {
            "current_wait": None,
            "current_queue": None,
            "cumulative_users": 0.0,
            "peak_arrival_rate": 0.0,
        }
    last = df.iloc[-1]
    return {
        "current_wait": int(last["wait_time"]) if pd.notna(last["wait_time"]) else None,
        "current_queue": float(last["queue_length"]),
        "cumulative_users": float(df["cumulative_users"].iloc[-1]) if "cumulative_users" in df else 0.0,
        "peak_arrival_rate": float(df["arrival_rate_per_hour"].max()) if "arrival_rate_per_hour" in df else 0.0,
    }
