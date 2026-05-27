# TDL待ち時間データソース調査結果

> 調査日: 2026-05-27  
> 調査者: Claude Code (Sonnet 4.6)  
> 実際にcurl/fetchで動作確認済み

---

## 推奨エンドポイント（第1候補）— ThemeParks.wiki API

- **URL**: `https://api.themeparks.wiki/v1/entity/3cc919f1-d16d-43e0-8c3f-1dd269bd1a42/live`
- **CORS**: **〇（完全対応）**
  - レスポンスヘッダー: `access-control-allow-origin: *`
  - ブラウザから直接 `fetch()` 可能。プロキシ不要。
- **キャッシュ/更新頻度**: `cache-control: public, max-age=60` → 最大60秒キャッシュ（実質1分更新）
- **認証**: 不要（APIキー不要）
- **レート制限**: 公式ドキュメントに明記なし。Cloudflare/Heroku経由のため急激な連打は避けること。

### レスポンス例（実測値）

```json
{
  "id": "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42",
  "name": "Tokyo Disneyland",
  "entityType": "DESTINATION",
  "timezone": "Asia/Tokyo",
  "liveData": [
    {
      "id": "e541ad8f-1457-469a-8f35-457555f475ad",
      "name": "Peter Pan's Flight",
      "entityType": "ATTRACTION",
      "parkId": "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42",
      "externalId": "164",
      "queue": {
        "STANDBY": {
          "waitTime": 30
        },
        "PAID_RETURN_TIME": {
          "price": { "amount": 0, "currency": "JPY", "formatted": "Unknown" },
          "state": "AVAILABLE",
          "returnEnd": null,
          "returnStart": null
        }
      },
      "status": "OPERATING",
      "lastUpdated": "2026-05-27T00:31:14Z"
    },
    {
      "id": "cf1e721e-ba51-4e48-a2bc-b07883091e88",
      "name": "Enchanted Tale of Beauty and the Beast",
      "entityType": "ATTRACTION",
      "parkId": "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42",
      "externalId": "205",
      "queue": {
        "STANDBY": { "waitTime": 140 }
      },
      "status": "OPERATING",
      "lastUpdated": "2026-05-27T01:00:00Z"
    }
  ]
}
```

### アトラクション名/待ち時間のJSONパス

| データ | JSONパス |
|--------|---------|
| アトラクション名 | `liveData[].name` |
| 待ち時間（分） | `liveData[].queue.STANDBY.waitTime` |
| 運営状態 | `liveData[].status` （`"OPERATING"` / `"CLOSED"`） |
| 最終更新時刻 | `liveData[].lastUpdated` （ISO 8601 UTC） |
| エンティティ種別 | `liveData[].entityType` （`"ATTRACTION"` のみフィルタ推奨） |
| プレミアムアクセス状態 | `liveData[].queue.PAID_RETURN_TIME.state` |

### 実測アトラクション一覧（2026-05-27 調査時点）

| アトラクション | 待ち時間 | 状態 |
|---|---|---|
| Enchanted Tale of Beauty and the Beast | 140分 | OPERATING |
| Splash Mountain | 100分 | OPERATING |
| The Happy Ride with Baymax | 80分 | OPERATING |
| Monsters, Inc. Ride & Go Seek! | 70分 | OPERATING |
| Pooh's Hunny Hunt | 60分 | OPERATING |
| Haunted Mansion | 20分 | OPERATING |
| Snow White's Adventures | 20分 | OPERATING |
| Roger Rabbit's Car Toon Spin | 30分 | OPERATING |
| Peter Pan's Flight | 30分 | OPERATING |
| （他22施設） | 5〜25分 | OPERATING |

### 関連エンドポイント

```
# 全パーク一覧（Tokyo Disney Resortの parkID確認用）
GET https://api.themeparks.wiki/v1/destinations

# 営業時間スケジュール
GET https://api.themeparks.wiki/v1/entity/3cc919f1-d16d-43e0-8c3f-1dd269bd1a42/schedule

# Tokyo DisneySea（姉妹パーク）
GET https://api.themeparks.wiki/v1/entity/67b290d5-3478-4f23-b601-2f8fb71ba803/live
```

### 採用理由

- **CORS完全対応**（`Access-Control-Allow-Origin: *`）でローカルHTMLから直接fetchできる唯一の実測確認済みAPI
- 実際に37アトラクション・31施設の待ち時間が取得できた
- 更新頻度1分（cache-control: 60秒）は実用十分
- APIキー不要・無料
- プレミアアクセス（有料整理券）情報も含む

---

## 候補2 — queue-times.com API

- **URL**: `https://queue-times.com/parks/274/queue_times.json`
- **CORS**: **×（非対応）**
  - レスポンスヘッダーに `Access-Control-Allow-Origin` が存在しない
  - ブラウザから直接fetchするとCORSエラーが発生
  - ただし `allorigins.win` プロキシ経由なら CORS: `*` でアクセス可能（後述）
- **更新頻度**: `cache-control: max-age=60` → 1分更新
- **認証**: 不要
- **利用規約**: アプリやサービスで使用する場合は「Powered by Queue-Times.com」の表示とリンクが必須

### レスポンス例（実測値）

```json
{
  "lands": [],
  "rides": [
    {
      "id": 8006,
      "name": "“it’s a small world with Groot”",
      "is_open": true,
      "wait_time": 15,
      "last_updated": "2026-05-27T01:46:06.000Z"
    },
    {
      "id": 8007,
      "name": "Alice's Tea Party",
      "is_open": true,
      "wait_time": 10,
      "last_updated": "2026-05-27T01:46:06.000Z"
    },
    {
      "id": 7994,
      "name": "Big Thunder Mountain",
      "is_open": false,
      "wait_time": 0,
      "last_updated": "2026-05-27T01:46:06.000Z"
    }
  ]
}
```

### アトラクション名/待ち時間のJSONパス

| データ | JSONパス |
|--------|---------|
| アトラクション名 | `rides[].name` |
| 待ち時間（分） | `rides[].wait_time` |
| 営業状態 | `rides[].is_open` （`true` / `false`） |
| 最終更新時刻 | `rides[].last_updated` （ISO 8601 UTC） |
| ライドID | `rides[].id` |

### プロキシ経由での利用（CORSプロキシ）

```javascript
// allorigins.win 経由（CORSヘッダー: * 対応、ただし応答が遅い場合あり）
const PROXY = 'https://api.allorigins.win/get?url=';
const TARGET = 'https://queue-times.com/parks/274/queue_times.json';

const response = await fetch(PROXY + encodeURIComponent(TARGET));
const wrapper = await response.json();
const data = JSON.parse(wrapper.contents);
// data.rides[] を使用
```

**注意**: `allorigins.win` はサーバー混雑時にタイムアウト（408）が発生する場合がある。本番利用には不安定。

### 備考

- `lands` 配列は現在空（TDLではエリア分類なし、全て `rides[]` にフラット格納）
- 合計37アトラクション、うち31営業中を確認

---

## 候補3 — queue-times.com（直接fetch + No-CORS モード / パーク一覧取得）

- **URL（パーク一覧）**: `https://queue-times.com/parks.json`
- **目的**: TDLのpark IDを動的に取得したい場合
- **CORS**: ×（同様に非対応）

### パーク一覧からTDLを特定する方法

```javascript
// park IDが固定であれば不要だが、変わる可能性に備えて
const parksResp = await fetch('https://api.allorigins.win/get?url=' + 
  encodeURIComponent('https://queue-times.com/parks.json'));
const { contents } = await parksResp.json();
const parks = JSON.parse(contents);

// Tokyo Disneylandを探す（現在のID: 274）
const tdl = parks
  .flatMap(group => group.parks || [])
  .find(p => p.name === 'Tokyo Disneyland');
```

---

## 候補4（参考）— Wartezeiten.APP API

- **URL**: `https://api.wartezeiten.app/` (Swagger UI)
- **CORS**: 不明（Cloudflare保護によりブラウザからのアクセスに制限あり）
- **TDL対応**: 不明（Swagger仕様が取得できなかったため未確認）
- **評価**: 現時点での動作確認が取れないため採用非推奨

---

## 注意点・制約

### ThemeParks.wiki（第1候補）の注意点

1. **非公式API** — 利用規約は明示されていないが、商用利用や高頻度アクセスはサーバー負荷の観点から避けること
2. **アトラクション名が英語** — 日本語名称への変換テーブルが別途必要（externalId を使えばTDR公式APIの施設コードと紐付け可能）
3. **データソース** — TDR公式アプリのAPIをリバースエンジニアリングして取得していると思われる
4. **サービス継続性** — 非公式のため突然終了する可能性がある。定期的に動作確認を
5. **`lastUpdated` はUTC** — 表示時は `+09:00` に変換すること

### queue-times.com（第2候補）の注意点

1. **CORS非対応** — プロキシ必須。`allorigins.win` は不安定
2. **アトラクション名が英語** — 同上
3. **`wait_time: 0` はCLOSED** — `is_open: false` と組み合わせて判定すること
4. **Powered by表示義務** — 利用規約により帰属表示が必須

### 共通の注意点

- TDRの公式APIは存在するが非公開（公式アプリのみ利用可能）
- スクレイピングや非公式APIの利用は常にサービス変更リスクを伴う
- 運営時間外（閉園中）は全アトラクションがCLOSED/waitTime=nullになる

---

## fetch実装サンプル

### 第1候補（ThemeParks.wiki）— ローカルHTMLから直接動作

```javascript
const TDL_PARK_ID = '3cc919f1-d16d-43e0-8c3f-1dd269bd1a42';
const API_BASE = 'https://api.themeparks.wiki/v1';

async function fetchWaitTimes() {
  const url = `${API_BASE}/entity/${TDL_PARK_ID}/live`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // アトラクションのみフィルタ（ショップ・レストランを除外）
  const attractions = data.liveData.filter(
    item => item.entityType === 'ATTRACTION'
  );
  
  // 待ち時間マップを生成
  return attractions.map(item => ({
    id: item.id,
    externalId: item.externalId,       // TDR施設コード（例: "164"）
    name: item.name,                    // 英語名
    status: item.status,               // "OPERATING" | "CLOSED" | "REFURBISHMENT"
    waitMinutes: item.queue?.STANDBY?.waitTime ?? null,  // 分 or null
    hasPaidAccess: !!item.queue?.PAID_RETURN_TIME,
    lastUpdated: new Date(item.lastUpdated), // UTC→Dateオブジェクト
    lastUpdatedJST: new Date(item.lastUpdated).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo'
    })
  }));
}

// 使用例
async function displayWaitTimes() {
  try {
    const rides = await fetchWaitTimes();
    
    // 待ち時間が長い順にソート（営業中のみ）
    const operating = rides
      .filter(r => r.status === 'OPERATING' && r.waitMinutes !== null)
      .sort((a, b) => b.waitMinutes - a.waitMinutes);
    
    console.log(`取得件数: ${rides.length}アトラクション`);
    operating.forEach(r => {
      console.log(`${r.name}: ${r.waitMinutes}分`);
    });
    
    return rides;
  } catch (err) {
    console.error('取得失敗:', err);
    throw err;
  }
}
```

### フォールバック実装（queue-times.com + allorigins.win プロキシ）

```javascript
const QT_PARK_ID = 274; // Tokyo Disneyland

async function fetchWaitTimesQueueTimes() {
  const target = `https://queue-times.com/parks/${QT_PARK_ID}/queue_times.json`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
  
  const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
  
  const wrapper = await response.json();
  const data = JSON.parse(wrapper.contents);
  
  // rides[] はフラット配列
  return data.rides.map(ride => ({
    id: ride.id,
    name: ride.name,
    isOpen: ride.is_open,
    waitMinutes: ride.is_open ? ride.wait_time : null,
    lastUpdated: new Date(ride.last_updated)
  }));
}
```

### 両候補を組み合わせた堅牢な実装

```javascript
async function fetchWaitTimesWithFallback() {
  // 第1候補: ThemeParks.wiki（CORS対応、直接fetch）
  try {
    const rides = await fetchWaitTimes(); // 上記の第1候補関数
    console.log('[ThemeParks.wiki] 取得成功');
    return { source: 'themeparks.wiki', rides };
  } catch (e) {
    console.warn('[ThemeParks.wiki] 失敗、フォールバックへ:', e.message);
  }
  
  // 第2候補: queue-times.com + allorigins.win
  try {
    const rides = await fetchWaitTimesQueueTimes();
    console.log('[queue-times.com] 取得成功');
    return { source: 'queue-times.com', rides };
  } catch (e) {
    console.error('[queue-times.com] 失敗:', e.message);
    throw new Error('全データソースで取得失敗');
  }
}

// 60秒ごとに自動更新
let intervalId = null;
function startAutoRefresh(callback, intervalMs = 60000) {
  fetchWaitTimesWithFallback().then(callback);
  intervalId = setInterval(() => {
    fetchWaitTimesWithFallback().then(callback);
  }, intervalMs);
  return () => clearInterval(intervalId); // 停止関数を返す
}
```

---

## 総括

| 項目 | ThemeParks.wiki | queue-times.com | queue-times + proxy |
|------|:--------------:|:---------------:|:-------------------:|
| CORS | **〇** | × | △（不安定） |
| 直接fetch | **〇** | × | 〇 |
| 更新頻度 | 1分 | 1分 | 1分 |
| アトラクション数 | 37 | 37 | 37 |
| 日本語名 | × | × | × |
| 認証不要 | **〇** | **〇** | **〇** |
| 安定性 | 高 | 高 | 低 |
| **推奨度** | **★★★** | ★ | ★★ |

**結論**: ThemeParks.wiki APIを第1候補として採用することを強く推奨。`access-control-allow-origin: *` が確認済みで、ローカルHTMLからプロキシなしで直接fetchできる唯一の実用的な選択肢。
