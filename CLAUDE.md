# TDL Wait Tracker

Tokyo Disneyland のアトラクション待ち時間を自動収集し、スループットモデルで利用者数を推定する Streamlit ダッシュボード。

## プロジェクト構成

```
app.py                   # Streamlit ダッシュボード（メインUI）
collector.py             # 待ち時間データ収集（queue-times.com API）
estimator.py             # 利用者数推定アルゴリズム
attractions_config.json  # 監視対象アトラクション設定
data/
  wait_times.jsonl       # 収集データ（JSONL形式、Git管理）
.github/                 # GitHub Actions（自動収集ワークフロー）
requirements.txt
```

## セットアップ

```bash
pip install -r requirements.txt
streamlit run app.py
```

## アーキテクチャ

### データ収集
- **API**: [queue-times.com](https://queue-times.com) (5分毎更新) → `collector.py`
- **スケジュール**: [themeparks.wiki](https://api.themeparks.wiki) でパーク営業時間を取得し、営業時間外は収集しない
- **自動収集**: GitHub Actions が定期実行 → `data/wait_times.jsonl` に追記 → git commit & push
- **手動取得**: ダッシュボードの「最新データを取得」ボタン（`app.py` から `collect_all()` を呼ぶ）

### 推定モデル (`estimator.py`)
- **処理能力 μ** = `people_per_car × cars_per_dispatch × (60 / seconds_per_dispatch)` [人/分]
- **列の人数** ≈ μ × 待ち時間(分)
- **累計利用者数**: 列がある間は μ 人/分が乗車し続けると仮定して累積
- **到着率 λ(t)**: `μ + ΔL/Δt`（列の変化量から逆算）
- 待ち時間 0 分の時間帯は `walkon_utilization × μ` で稼働

### データ形式（JSONL）
```json
{"park_id": 274, "ride_id": 8018, "ride_name": "...", "wait_time": 30, "is_open": true, "last_updated": "2026-05-13T10:00:00Z", "recorded_at": "2026-05-13T10:01:00Z"}
```

## 主要定数

| 定数 | 値 | 説明 |
|------|-----|------|
| `TDL_PARK_ID` | 274 | queue-times.com の TDL パーク ID |
| `TDL_ENTITY_ID` | `3cc919f1-...` | themeparks.wiki の TDL エンティティ ID |
| `SCHEDULE_BUFFER_MINUTES` | 15 | 開園前後のバッファ（分） |

## アトラクション追加手順

1. ダッシュボードのサイドバー「アトラクション追加」から登録
2. `attractions_config.json` が更新される
3. `git push` → GitHub Actions の収集対象に反映

## ファイル別注意点

- `data/wait_times.jsonl` は Git で管理されており、GitHub Actions が push してくる。`app.py` の「最新データ取得」ボタンは `git pull --rebase --autostash` でクラウド側の追記を取り込む。
- `attractions_config.json` を変更したら必ず git push して Actions に反映させること。
- `estimator.py` の `ThroughputConfig` はデータクラス。パラメータはサイドバーから変更・保存可能（`save_attractions_config()` で JSON に永続化）。
