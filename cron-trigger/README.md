# Cloudflare Workers Cron Trigger

GitHub Actions の `schedule:` イベントは無料枠で 1〜3 時間に1回まで遅延されます。
代わりに **Cloudflare Workers の Cron Triggers** から 15 分おきに
`workflow_dispatch` API を叩くことで、遅延なく 15 分間隔で
`Collect TDL wait times` ワークフローを実行できます。

GitHub Actions は public リポジトリなら **実行時間は無制限・無料**なので
追加コストは発生しません。

## セットアップ (約5分)

### 1. GitHub Personal Access Token (PAT) を生成

1. https://github.com/settings/personal-access-tokens/new (fine-grained PAT)
2. Token name: `tdl-cron-trigger`
3. Expiration: 1年など好きな期間
4. Repository access: **Only select repositories** → `ZambiniBrothers/tdl-wait-tracker`
5. Permissions → **Actions** → **Read and write**
6. **Generate token** で表示されたトークン文字列をコピー (これは一度しか見えない)

### 2. Cloudflare アカウントを作成

1. https://dash.cloudflare.com/sign-up
2. メールアドレスとパスワードだけで OK (クレジットカード不要)

### 3. Worker を作成

1. ダッシュボード左メニュー → **Workers & Pages**
2. **Create** → **Workers** → **Hello World** テンプレ → **Get started**
3. Worker name: `tdl-cron-trigger`
4. **Deploy** ボタンで初期デプロイ
5. **Edit code** に進み、エディタの内容を全消して `worker.js` の中身を貼り付け
6. 右上の **Deploy** ボタン

### 4. シークレットを登録

1. Worker の **Settings** → **Variables and Secrets** → **Add variable**
2. Type: **Secret**, Name: `GITHUB_TOKEN`, Value: 手順1のトークン
3. **Save and deploy**

### 5. Cron Trigger を追加

1. Worker の **Settings** → **Triggers** → **Cron Triggers** → **Add Cron Trigger**
2. Cron expression: `*/15 * * * *`
3. **Add**

完了。次の :00 / :15 / :30 / :45 から発火し、Actions タブで
`Collect TDL wait times` が workflow_dispatch で実行されているはずです。

## 動作確認

- Cloudflare Worker の **Logs** タブでスケジュール実行の log を確認
- GitHub Actions タブで実行履歴を確認
- 24 時間後に `data/snapshots/<date>/series.json` の points が増えていれば成功

## 解除したいとき

Worker を **Delete** すれば停止します。GitHub Actions 側の cron は残り続けるので、
保険として「最低でも数時間に1回は走る」状態は維持されます。
