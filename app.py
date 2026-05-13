from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from collector import JSONL_PATH, MONSTERS_INC_RIDE_ID, collect
from estimator import ThroughputConfig, compute, summarize

JST = timezone(timedelta(hours=9))

st.set_page_config(
    page_title="アトラクション利用者数推定",
    page_icon="🎢",
    layout="wide",
)

st.title("🎢 アトラクション利用者数推定ダッシュボード")
st.caption("対象: 東京ディズニーランド「モンスターズインク ライド&ゴーシーク」")

# -------------------- サイドバー --------------------
with st.sidebar:
    st.header("⚙️ 処理能力パラメータ")
    st.caption("実地観察にもとづく値です。現場感に合わせて調整できます。")

    people_per_car = st.number_input(
        "1台の平均乗車人数 (人)",
        min_value=1.0, max_value=9.0, value=6.0, step=0.5,
        help="モンスターズインクは定員9人だが、2人×3列で6人が現実的",
    )
    cars_per_dispatch = st.number_input(
        "同時発車する台数 (台)",
        min_value=1, max_value=4, value=2, step=1,
    )
    seconds_per_dispatch = st.number_input(
        "1組の発車間隔 (秒)",
        min_value=10, max_value=120, value=30, step=5,
        help="15秒/台 × 2台 = 30秒/組",
    )
    walkon_util = st.slider(
        "待ち0分時の稼働率",
        min_value=0.0, max_value=1.0, value=0.5, step=0.05,
        help="待ち時間が0でも歩いてくる客で動いている割合",
    )

    config = ThroughputConfig(
        people_per_car=people_per_car,
        cars_per_dispatch=int(cars_per_dispatch),
        seconds_per_dispatch=float(seconds_per_dispatch),
        walkon_utilization=walkon_util,
    )

    st.divider()
    st.metric("1分あたり処理能力", f"{config.people_per_minute:.1f} 人")
    st.metric("1時間あたり処理能力 μ", f"{config.people_per_hour:.0f} 人")

    st.divider()
    refresh = st.button("🔄 最新データを取得", use_container_width=True)


# -------------------- データ取得 --------------------
def load_jsonl(ride_id: int) -> pd.DataFrame:
    if not JSONL_PATH.exists():
        return pd.DataFrame(columns=["last_updated", "recorded_at", "wait_time", "is_open", "ride_id"])
    df = pd.read_json(JSONL_PATH, lines=True)
    if "ride_id" not in df.columns:
        return df.iloc[0:0]
    df = df[df["ride_id"] == ride_id].copy()
    return df.drop_duplicates(subset=["last_updated"], keep="last")


def get_latest_recorded_at(ride_id: int) -> datetime | None:
    if not JSONL_PATH.exists():
        return None
    last_ts = None
    with open(JSONL_PATH) as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("ride_id") == ride_id:
                last_ts = rec.get("recorded_at")
    return datetime.fromisoformat(last_ts) if last_ts else None


def maybe_collect(force: bool) -> tuple[bool, str]:
    latest = get_latest_recorded_at(MONSTERS_INC_RIDE_ID)
    now = datetime.now(timezone.utc)
    if not force and latest is not None and (now - latest).total_seconds() < 300:
        return False, f"前回取得から {(now - latest).total_seconds():.0f} 秒経過(5分未満なのでスキップ)"
    try:
        result = collect()
        if result is None:
            return False, "API応答にこのアトラクションが含まれていません"
        return True, f"取得成功: 待ち {result.get('wait_time')} 分 / open={result.get('is_open')}"
    except Exception as e:  # noqa: BLE001
        return False, f"取得失敗: {e}"


did_collect, msg = maybe_collect(force=refresh)
if refresh:
    (st.success if did_collect else st.warning)(msg)

# -------------------- データ読込 --------------------
df_all = load_jsonl(MONSTERS_INC_RIDE_ID)

if len(df_all) == 0:
    st.warning("まだデータがありません。「最新データを取得」を押してください。")
    st.stop()

df_all["timestamp"] = pd.to_datetime(df_all["last_updated"], utc=True).dt.tz_convert(JST)
df_all = df_all.drop_duplicates(subset=["timestamp"]).sort_values("timestamp")
df_all["is_open"] = df_all["is_open"].astype(int)

today_jst = datetime.now(JST).date()
df_today = df_all[df_all["timestamp"].dt.date == today_jst].copy()

# -------------------- KPI表示 --------------------
if len(df_today) >= 1:
    df_today_est = compute(df_today, config) if len(df_today) >= 2 else df_today.assign(
        queue_length=config.people_per_minute * df_today["wait_time"],
        cumulative_users=0.0,
        arrival_rate_per_hour=0.0,
    )
    summary = summarize(df_today_est)
else:
    df_today_est = pd.DataFrame()
    summary = summarize(df_today_est)

col1, col2, col3, col4 = st.columns(4)
col1.metric(
    "現在の待ち時間",
    f"{summary['current_wait']} 分" if summary["current_wait"] is not None else "—",
)
col2.metric(
    "列にいる人数(推定)",
    f"{summary['current_queue']:.0f} 人" if summary["current_queue"] is not None else "—",
)
col3.metric(
    "本日の累計利用者数(推定)",
    f"{summary['cumulative_users']:,.0f} 人",
)
col4.metric(
    "本日のピーク到着率",
    f"{summary['peak_arrival_rate']:,.0f} 人/時",
)

# -------------------- グラフ --------------------
st.subheader("📊 本日の待ち時間推移")
if len(df_today) >= 1:
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=df_today["timestamp"],
            y=df_today["wait_time"],
            mode="lines+markers",
            name="待ち時間 (分)",
            line=dict(color="#FF6B6B"),
        )
    )
    fig.update_layout(yaxis_title="待ち時間 (分)", xaxis_title="時刻", height=320, margin=dict(t=10))
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("今日のデータがまだありません")

if len(df_today_est) >= 2:
    col_l, col_r = st.columns(2)

    fig_arr = go.Figure()
    fig_arr.add_trace(
        go.Scatter(
            x=df_today_est["timestamp"],
            y=df_today_est["arrival_rate_per_hour"],
            mode="lines",
            name="到着率",
            line=dict(color="#FFA500"),
        )
    )
    fig_arr.add_hline(
        y=config.people_per_hour,
        line_dash="dash",
        annotation_text=f"処理能力 μ={config.people_per_hour:.0f}",
        annotation_position="top right",
    )
    fig_arr.update_layout(
        title="到着率 λ(t) [人/時]",
        yaxis_title="人/時",
        height=320,
        margin=dict(t=40),
    )
    col_l.plotly_chart(fig_arr, use_container_width=True)

    fig_cum = go.Figure()
    fig_cum.add_trace(
        go.Scatter(
            x=df_today_est["timestamp"],
            y=df_today_est["cumulative_users"],
            mode="lines",
            name="累計利用者数",
            fill="tozeroy",
            line=dict(color="#2E8B57"),
        )
    )
    fig_cum.update_layout(
        title="累計利用者数(推定)",
        yaxis_title="人",
        height=320,
        margin=dict(t=40),
    )
    col_r.plotly_chart(fig_cum, use_container_width=True)

# -------------------- 過去7日 --------------------
st.subheader("📅 過去7日間の待ち時間")
seven_days_ago = pd.Timestamp.now(tz=JST) - pd.Timedelta(days=7)
df_7d = df_all[df_all["timestamp"] >= seven_days_ago]
if len(df_7d) >= 2:
    fig_7d = go.Figure()
    fig_7d.add_trace(
        go.Scatter(
            x=df_7d["timestamp"],
            y=df_7d["wait_time"],
            mode="lines",
            line=dict(color="#4A90E2"),
        )
    )
    fig_7d.update_layout(yaxis_title="待ち時間 (分)", height=300, margin=dict(t=10))
    st.plotly_chart(fig_7d, use_container_width=True)
else:
    st.info("過去7日間のデータがまだ蓄積されていません。継続収集してください。")

# -------------------- 解説 --------------------
with st.expander("ℹ️ 推定アルゴリズムについて"):
    st.markdown(
        f"""
        **基礎モデル(オーナー考案)**

        - 1台に **{config.people_per_car:.1f}人** × **{config.cars_per_dispatch}台** = 1組 **{config.people_per_car * config.cars_per_dispatch:.0f}人** を **{config.seconds_per_dispatch:.0f}秒**毎に発車
        - → 1分あたり **{config.people_per_minute:.1f}人** / 1時間あたり **{config.people_per_hour:.0f}人** 捌ける
        - 列にいる人数 ≈ 1分あたり処理能力 × 待ち時間(分)
        - 列がある間は1分に{config.people_per_minute:.1f}人が乗車していると考え、累積する
        - 待ち0分の時間帯は「歩いてくる客」だけが乗るので **{config.walkon_utilization*100:.0f}%** の稼働率と仮定

        **データ更新**: queue-times.com が5分毎に更新。ダッシュボードを開くたび(5分以上経っていれば)自動取得します。

        **次の展開**: 他アトラクションを追加する際は、上のパラメータを各乗り物の物理仕様に書き換えれば対応できます。
        """
    )

st.caption("Data: [Queue-Times.com](https://queue-times.com) (5分毎更新)")
