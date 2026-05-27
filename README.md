# TDL 待ち時間 逆算カリキュレーター

東京ディズニーランドのアトラクション待ち時間から、列に並んでいる人数と来園者数を逆算するウェブアプリです。
GitHub Actions が 10 分おきにクラウドでデータを収集し、過去の推移を折れ線グラフで確認できます。

## 全体図

```
  ┌───────────────────────────────┐
  │  GitHub Actions (10分ごと)    │
  │   scripts/collect.mjs         │
  │     ↓                         │
  │   ThemeParks.wiki API         │  ← 一次
  │     ↓ 失敗時                  │
  │   queue-times.com API         │  ← 二次
  │     ↓                         │
  │   data/latest.json            │
  │   data/snapshots/             │
  │     YYYY-MM-DD/HHMM.json      │
  │     index.json                │
  └───────────────────────────────┘
              ↓ GitHub Pages
  ┌───────────────────────────────┐
  │  ブラウザ                      │
  │   index.html   (計算機)        │
  │   history.html (履歴+グラフ)   │
  └───────────────────────────────┘
```

## できること

- リアルタイム待ち時間表示と「並んでいる人数」「来園者数」の逆算
- 過去スナップショットのタイムライン閲覧、アトラクション別の折れ線グラフ
- アトラクション別メモのトグル表示・エクスポート/インポート

## セットアップ手順

### 1. リポジトリ作成

このディレクトリの中身（index.html / history.html / scripts/ / .github/ / data/ / README.md）を GitHub の新規 **public** リポジトリに push します。

```bash
cd /path/to/tdl-wait-calc
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

### 2. GitHub Pages を有効化

リポジトリの **Settings → Pages** で:

- **Source**: `Deploy from a branch`
- **Branch**: `main` / `/ (root)`

数分待つと `https://<user>.github.io/<repo>/` で公開されます。

### 3. Actions の書き込み権限を有効化

**Settings → Actions → General → Workflow permissions** で **Read and write permissions** を選択し、Save。

これをしないと cron で取得したデータを `data/` にコミットできません。

### 4. 初回実行

**Actions タブ → Collect TDL wait times → Run workflow** で手動実行。
10 分の cron 待たずに最初のスナップショットが生成されます。

### 5. 動作確認

- `https://<user>.github.io/<repo>/` で index.html が開き、データ取得元が「クラウド」になっていれば成功
- `history.html` に遷移して過去データのドロップダウンが出れば成功

## 使い方

### index.html（計算機）

- 各アトラクションの **キャリー（人/分）** を順次入力
  - 例：スプラッシュ・マウンテン = 30、ホーンテッドマンション = 60 など
  - 未入力のものは `--` 表示で人数計算からスキップ
- **並列係数** スライダー：並んでいる人数 ÷ 並列係数 ≒ 来園者数
  - 0.35 = 来園者の 35% が常に列に並んでいる想定（デフォルト）
- 📝 **メモ** ボタン：アトラクションごとに自由メモ（localStorage に保存）
- 📊 **過去データ** ボタン：history.html へ
- **メモをエクスポート / 取り込み** ：JSON ファイルでメモを移行可能

### history.html（履歴）

- 日付 + 時刻のドロップダウンで過去スナップショットを表示
- 「最新」ボタンで最新へジャンプ
- 下部の **折れ線グラフ** ：アトラクションを選ぶと過去 24 時間分の待ち時間推移を表示

## データソース

| 優先 | API | 認証 | CORS | 更新頻度 |
|---|---|---|---|---|
| 一次 | [ThemeParks.wiki](https://api.themeparks.wiki/) | 不要 | ○ | 60秒キャッシュ |
| 二次 | [queue-times.com](https://queue-times.com/) | 不要 | × (GitHub Actions 経由) | 5分程度 |

どちらも公開 API で、規約上の制限を守って利用しています。

## 更新頻度

- GitHub Actions の cron で **10 分おき** に取得
- 同じ 10 分粒度のスナップショットは上書き
- 公演中の急変動には間に合わないため、参考値として使用してください

## ファイル構成

```
.
├── index.html               # 計算機本体
├── history.html             # 履歴閲覧 + グラフ
├── README.md                # このファイル
├── data-source-research.md  # API調査メモ（参考）
├── scripts/
│   └── collect.mjs          # Node.js データ収集スクリプト
├── .github/
│   └── workflows/
│       └── collect.yml      # 10分おき cron
└── data/
    ├── latest.json          # 最新スナップショット
    └── snapshots/
        ├── index.json       # 全スナップショット索引
        └── 2026-05-27/
            ├── 0000.json
            ├── 0010.json
            └── ...
```

## トラブルシューティング

### Adobe Creative Cloud Files フォルダで HTML が開かない

Adobe CC Files フォルダ内の HTML はブラウザ選択ダイアログ（saqoo.sh など）に飛ぶことがあります。
デスクトップにコピーしてから開くか、GitHub Pages 経由でアクセスしてください。

```bash
cp index.html ~/Desktop/tdl-wait-calc.html
open ~/Desktop/tdl-wait-calc.html
```

### data/latest.json が 404

GitHub Actions の初回実行がまだ完了していません。index.html は自動的に API 直接取得にフォールバックするので、そのまま使用できます。

### Actions が `Permission denied to github-actions[bot]`

Settings → Actions → General → Workflow permissions が **Read and write permissions** になっているか再確認してください。

### history.html が空

`data/snapshots/index.json` がまだ生成されていません。Actions を 1 回以上手動実行してください。

## ライセンス

自由に改変・利用してください（MIT 相当）。

## 注意・免責

- 本ツールは **非公式ファンメイド** であり、東京ディズニーランド／株式会社オリエンタルランドとは一切関係ありません
- データの正確性は保証されません
- 商用利用や運用上の重要判断には使用しないでください
