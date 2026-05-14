from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from collector import (
    JSONL_PATH,
    TDL_PARK_ID,
    collect_all,
    fetch_park_data,
    get_today_hours,
    is_park_open_now,
    list_park_rides,
    load_attractions_config,
    save_attractions_config,
)
from estimator import ThroughputConfig, compute, summarize

JST = timezone(timedelta(hours=9))

st.set_page_config(
    page_title="アトラクション利用者数推定",
    page_icon="🎢",
    layout="wide",
)

st.title("🎢 アトラクション利用者数推定ダッシュボード")


# -------------------- キャッシュ関数 --------------------
@st.cache_data(ttl=3600)
def get_park_rides_cached(park_id: int) -> list[dict]:
    return list_park_rides(park_id)


@st.cache_data(ttl=3600)
def get_today_hours_cached() -> tuple[datetime, datetime] | None:
    return get_today_hours()


@st.cache_data(ttl=300)
def get_park_status_cached() -> tuple[bool, str]:
    return is_park_open_now()


def git_pull_data() -> tuple[bool, str]:
    """git pull --rebase --autostash でクラウドの最新データを取り込む。"""
    project_root = Path(__file__).parent
    try:
        result = subprocess.run(
            ["git", "pull", "--rebase", "--autostash"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            output = (result.stdout or "").strip()
            if "Already up to date" in output or "up-to-date" in output:
                return True, "既に最新"
            return True, "新しいデータを取り込みました"
        return False, (result.stderr or "").strip()[:200] or "git pull 失敗"
    except subprocess.TimeoutExpired:
        return False, "タイムアウト(30秒)"
    except FileNotFoundError:
        return False, "git コマンドが見つかりません"
    except Exception as e:
        return False, str(e)


# -------------------- パーク運営状況 --------------------
park_is_open, park_status_reason = get_park_status_cached()
today_hours = get_today_hours_cached()
if today_hours:
    open_jst = today_hours[0].astimezone(JST).strftime("%H:%M")
    close_jst = today_hours[1].astimezone(JST).strftime("%H:%M")
    status_label = "🟢 運営中" if park_is_open else "🔴 時間外"
    st.caption(f"本日のTDL運営時間: **{open_jst} - {close_jst}**　({status_label})")
else:
    st.caption(f"本日のTDL: **{park_status_reason}**")


# -------------------- アトラクション設定 --------------------
attractions = load_attractions_config()


# -------------------- サイドバー --------------------
with st.sidebar:
    st.header("🎡 アトラクション選択")

    if not attractions:
        st.warning("アトラクションが未登録です")
        selected_idx = None
        selected = None
    else:
        display_names = [a.get("display_name") or a["ride_name"] for a in attractions]
        selected_idx = st.selectbox(
            "表示するアトラクション",
            options=list(range(len(attractions))),
            format_func=lambda i: display_names[i],
            label_visibility="collapsed",
        )
        selected = attractions[selected_idx]

    st.divider()

    if selected is not None:
        st.header("⚙️ 処理能力パラメータ")
        st.caption("実地観察にもとづく値です。調整後「保存」を押してください。")

        people_per_car = st.number_input(
            "1台の平均乗車人数 (人)",
            min_value=1.0, max_value=30.0, value=float(selected["people_per_car"]), step=0.5,
        )
        cars_per_dispatch = st.number_input(
            "同時発車する台数 (台)",
            min_value=1, max_value=10, value=int(selected["cars_per_dispatch"]), step=1,
        )
        seconds_per_dispatch = st.number_input(
            "1組の発車間隔 (秒)",
            min_value=5, max_value=300, value=int(selected["seconds_per_dispatch"]), step=5,
        )
        walkon_util = st.slider(
            "待ち0分時の稼働率",
            min_value=0.0, max_value=1.0, value=float(selected["walkon_utilization"]), step=0.05,
        )

        if st.button("💾 パラメータを保存", use_container_width=True):
            attractions[selected_idx].update({
                "people_per_car": people_per_car,
                "cars_per_dispatch": int(cars_per_dispatch),
                "seconds_per_dispatch": float(seconds_per_dispatch),
                "walkon_utilization": walkon_util,
            })
            save_attractions_config(attractions)
            st.success("保存しました")

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
    refresh = st.button("🔄 最新データを取得(全アトラクション)", use_container_width=True)

    st.divider()
    with st.expander("➕ アトラクション追加"):
        st.caption("TDLの全アトラクション一覧を取得して選びます")
        try:
            all_rides = get_park_rides_cached(TDL_PARK_ID)
            existing_ids = {a["ride_id"] for a in attractions}
            available = [r for r in all_rides if r["id"] not in existing_ids]
        except Exception as e:
            st.error(f"一覧取得失敗: {e}")
            available = []

        if not available:
            st.info("登録可能なアトラクションがありません")
        else:
            new_ride = st.selectbox(
                "追加するアトラクション",
                options=available,
                format_func=lambda r: r["name"],
            )

            st.caption("処理能力パラメータ（現地観察後に入力）")
            new_ppc = st.number_input(
                "1台の平均乗車人数", min_value=1.0, max_value=30.0,
                value=6.0, step=0.5, key="new_ppc",
            )
            new_cpd = st.number_input(
                "同時発車台数", min_value=1, max_value=10,
                value=1, step=1, key="new_cpd",
            )
            new_spd = st.number_input(
                "発車間隔(秒)", min_value=5, max_value=300,
                value=30, step=5, key="new_spd",
            )
            new_wu = st.slider(
                "待ち0分時稼働率", min_value=0.0, max_value=1.0,
                value=0.5, step=0.05, key="new_wu",
            )

            if st.button("登録", use_container_width=True, key="btn_add"):
                new_entry = {
                    "park_id": TDL_PARK_ID,
                    "ride_id": new_ride["id"],
                    "ride_name": new_ride["name"],
                    "display_name": new_ride["name"],
                    "added_date": datetime.now(JST).date().isoformat(),
                    "people_per_car": new_ppc,
                    "cars_per_dispatch": int(new_cpd),
                    "seconds_per_dispatch": float(new_spd),
                    "walkon_utilization": new_wu,
                }
                attractions.append(new_entry)
                save_attractions_config(attractions)
                st.success(f"「{new_ride['name']}」を登録しました！")
                st.info("git push してください（GitHub Actions の収集に反映されます）")
                st.rerun()


# -------------------- 未登録時 --------------------
if not attractions or selected is None:
    st.warning("サイドバーからアトラクションを追加してください。")
    st.stop()


# -------------------- データ取得 --------------------
def load_jsonl(ride_id: int, from_date: str | None = None) -> pd.DataFrame:
    if not JSONL_PATH.exists():
        return pd.DataFrame(columns=["last_updated", "recorded_at", "wait_time", "is_open", "ride_id"])
    df = pd.read_json(JSONL_PATH, lines=True)
    if "ride_id" not in df.columns:
        return df.iloc[0:0]
    df = df[df["ride_id"] == ride_id].copy()
    df = df.drop_duplicates(subset=["last_updated"], keep="last")
    if from_date:
        df["_ts"] = pd.to_datetime(df["last_updated"], utc=True)
        df = df[df["_ts"].dt.date >= pd.Timestamp(from_date).date()]
        df = df.drop(columns=["_ts"])
    return df


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


if refresh:
    with st.spinner("クラウド側の最新データを取得中..."):
        pull_ok, pull_msg = git_pull_data()
    if pull_ok:
        st.info(f"📥 {pull_msg}")
    else:
        st.warning(f"⚠️ git pull失敗（収集は続行）: {pull_msg}")

    try:
        results = collect_all(attractions)
        msgs = []
        for attr, ride in results:
            name = attr.get("display_name") or attr["ride_name"]
            if ride is None:
                msgs.append(f"❌ {name}: APIに見つからず")
            else:
                msgs.append(f"✅ {name}: 待ち {ride.get('wait_time')} 分 / open={ride.get('is_open')}")
        st.success("\n".join(msgs))
    except Exception as e:
        st.warning(f"取得失敗: {e}")


# -------------------- 選択アトラクションのデータ読込 --------------------
ride_id = selected["ride_id"]
added_date = selected.get("added_date")
attraction_name = selected.get("display_name") or selected["ride_name"]

st.caption(f"対象: {attraction_name}")

df_all = load_jsonl(ride_id, from_date=added_date)

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
    if len(df_today) >= 2:
        df_today_est = compute(df_today, config)
    else:
        # 1点のみ: 開園時刻〜計測時刻の経過分 × μ で累計を推定
        latest = df_today.iloc[-1]
        queue_length = config.people_per_minute * float(latest["wait_time"])
        if today_hours:
            open_utc = today_hours[0]
            latest_ts = latest["timestamp"]
            elapsed_min = (latest_ts.to_pydatetime() - open_utc.astimezone(JST)).total_seconds() / 60.0
            elapsed_min = max(0.0, elapsed_min)
        else:
            elapsed_min = 0.0
        rate = config.people_per_minute if float(latest["wait_time"]) > 0 else config.walkon_utilization * config.people_per_minute
        cumulative = rate * elapsed_min
        df_today_est = df_today.assign(
            queue_length=queue_length,
            cumulative_users=cumulative,
            arrival_rate_per_hour=0.0,
        )
    summary = summarize(df_today_est)
else:
    df_today_est = pd.DataFrame()
    summary = summarize(df_today_est)

col1, col2 = st.columns(2)
col1.metric(
    "現在の待ち時間",
    f"{summary['current_wait']} 分" if summary["current_wait"] is not None else "—",
)
col2.metric(
    "本日の総利用者数(推定)",
    f"{summary['cumulative_users']:,.0f} 人",
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
        **基礎モデル**

        - 1台に **{config.people_per_car:.1f}人** × **{config.cars_per_dispatch}台** = 1組 **{config.people_per_car * config.cars_per_dispatch:.0f}人** を **{config.seconds_per_dispatch:.0f}秒**毎に発車
        - → 1分あたり **{config.people_per_minute:.1f}人** / 1時間あたり **{config.people_per_hour:.0f}人** 捌ける
        - 列にいる人数 ≈ 1分あたり処理能力 × 待ち時間(分)
        - 列がある間は1分に{config.people_per_minute:.1f}人が乗車していると考え、累積する
        - 待ち0分の時間帯は **{config.walkon_utilization*100:.0f}%** の稼働率と仮定

        **データ更新**: queue-times.com が5分毎に更新。GitHub Actions がクラウドで自動収集します。

        **アトラクション追加**: サイドバーの「アトラクション追加」から登録後、git push してください。
        """
    )

st.caption("Data: [Queue-Times.com](https://queue-times.com) (5分毎更新)")
