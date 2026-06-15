// queue-times.com を使った汎用の待ち時間コレクター（海外ディズニー系パークなど）。
// 環境変数で対象パークを指定して data/<PARK_KEY>/ に保存する。各パークは独立収集で、
// 1パークの失敗が他に波及しないよう workflow 側で continue-on-error を付ける。
//
//   PARK_KEY  保存先ディレクトリ・id接頭辞に使う短いキー（例: dlr, mk, dlp）
//   QT_PARK_ID queue-times の park id（例: 16）
//
// 例: PARK_KEY=dlr QT_PARK_ID=16 node scripts/collect-qt.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PARK_KEY = String(process.env.PARK_KEY || '').trim();
const QT_PARK_ID = String(process.env.QT_PARK_ID || '').trim();
if (!PARK_KEY || !QT_PARK_ID) {
  console.error('collect-qt: PARK_KEY と QT_PARK_ID の環境変数が必要です');
  process.exit(1);
}

const BASE_DIR = path.join('data', PARK_KEY);
const QUEUE_TIMES_URL = `https://queue-times.com/parks/${QT_PARK_ID}/queue_times.json`;
const TIMEOUT_MS = 12_000;
// queue-times は閉園後も最後の値を返し続けるため、last_updated が一定時間より古いライドは
// 「鮮度なし＝休止」とみなす。
const STALE_MS = 45 * 60 * 1000;
const ID_PREFIX = `a-${PARK_KEY}-`;

// 有名アトラクションの英語名→日本語名（パーク横断で共通）。正規化キーで variant を吸収する。
const JA_MAP = {
  'space mountain': 'スペース・マウンテン',
  'hyperspace mountain': 'ハイパースペース・マウンテン',
  'star wars hyperspace mountain': 'スター・ウォーズ：ハイパースペース・マウンテン',
  'big thunder mountain': 'ビッグサンダー・マウンテン',
  'big thunder mountain railroad': 'ビッグサンダー・マウンテン',
  'splash mountain': 'スプラッシュ・マウンテン',
  'matterhorn bobsleds': 'マッターホルン・ボブスレー',
  'pirates of the caribbean': 'カリブの海賊',
  'pirates of the caribbean battle for the sunken treasure': 'カリブの海賊：沈没船の財宝をめぐるバトル',
  'haunted mansion': 'ホーンテッドマンション',
  'phantom manor': 'ファントム・マナー',
  'mystic manor': 'ミスティック・マナー',
  "it's a small world": 'イッツ・ア・スモールワールド',
  'jungle cruise': 'ジャングルクルーズ',
  'jungle river cruise': 'ジャングルリバークルーズ',
  "peter pan's flight": 'ピーターパン空の旅',
  'indiana jones adventure': 'インディ・ジョーンズ・アドベンチャー',
  'indiana jones and the temple of peril': 'インディ・ジョーンズと危難の魔宮',
  'star tours - the adventures continue': 'スター・ツアーズ',
  'star tours: the adventures continue': 'スター・ツアーズ',
  'star wars: rise of the resistance': 'スター・ウォーズ：ライズ・オブ・ザ・レジスタンス',
  'millennium falcon: smugglers run': 'ミレニアム・ファルコン：スマグラーズ・ラン',
  'autopia': 'オートピア',
  'dumbo the flying elephant': '空飛ぶダンボ',
  'alice in wonderland': 'ふしぎの国のアリス',
  "alice's curious labyrinth": 'ふしぎの国のアリスの迷路',
  'mad tea party': 'マッドティーパーティー',
  'tron lightcycle / run': 'トロン・ライトサイクル・ラン',
  'tron lightcycle power run': 'トロン・ライトサイクル・パワーラン',
  'test track': 'テスト・トラック',
  "soarin' over california": 'ソアリン・オーバー・カリフォルニア',
  "soarin' across america": 'ソアリン・アクロス・アメリカ',
  'soaring over the horizon': 'ソアリン：ファンタスティック・フライト',
  'spaceship earth': 'スペースシップ・アース',
  'mission: space': 'ミッション：スペース',
  'the twilight zone tower of terror': 'タワー・オブ・テラー',
  'slinky dog dash': 'スリンキー・ドッグ・ダッシュ',
  'toy story mania!': 'トイ・ストーリー・マニア！',
  'toy story midway mania!': 'トイ・ストーリー・マニア！',
  'seven dwarfs mine train': '七人のこびとのマイントレイン',
  'expedition everest - legend of the forbidden mountain': 'エクスペディション・エベレスト',
  'avatar flight of passage': 'アバター：フライト・オブ・パッセージ',
  'kilimanjaro safaris': 'キリマンジャロ・サファリ',
  'frozen ever after': 'フローズン・エバーアフター',
  "remy's ratatouille adventure": 'レミーのおいしいレストラン',
  'ratatouille: the adventure': 'レミーのおいしいレストラン',
  "ratatouille : l'aventure totalement toquée de rémy": 'レミーのおいしいレストラン',
  "crush's coaster": 'クラッシュ・コースター',
  'radiator springs racers': 'レーシング・イン・ラジエーター・スプリングス',
  'guardians of the galaxy - mission: breakout!': 'ガーディアンズ・オブ・ギャラクシー：ミッション・ブレイクアウト！',
  'guardians of the galaxy: cosmic rewind': 'ガーディアンズ・オブ・ギャラクシー：コズミック・リワインド',
  'incredicoaster': 'インクレディコースター',
  "mickey & minnie's runaway railway": 'ミッキー＆ミニーのランナウェイ・レイルウェイ',
  "mickey's philharmagic": 'ミッキーのフィルハーマジック',
  'buzz lightyear astro blasters': 'バズ・ライトイヤーのアストロブラスター',
  "buzz lightyear's space ranger spin": 'バズ・ライトイヤーのスペース・レンジャー・スピン',
  'buzz lightyear laser blast': 'バズ・ライトイヤー・レーザーブラスト',
  'buzz lightyear planet rescue': 'バズ・ライトイヤー・プラネット・レスキュー',
  'finding nemo submarine voyage': 'ファインディング・ニモ・サブマリン・ボヤッジ',
  'big grizzly mountain runaway mine cars': 'ビッググリズリー・マウンテン',
  'casey jr. circus train': 'キャシー・ジュニア・サーカストレイン',
  "casey jr. - le petit train du cirque": 'キャシー・ジュニア・サーカストレイン'
};

function normKey(s) {
  return String(s || '')
    .replace(/[®™*​]/g, '')        // ® ™ * ゼロ幅
    .replace(/\s+single rider$/i, '')
    .replace(/\s*[–—-]\s*presented by.*$/i, '')
    .replace(/\s*presented by.*$/i, '')
    .replace(/,\s*presented by.*$/i, '')
    .replace(/[’‘']/g, "'")
    .replace(/["“”]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function jaName(name) {
  return JA_MAP[normKey(name)] || String(name || '').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker/1.0)',
        'Accept': 'application/json,text/plain,*/*'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAttractions() {
  const data = await fetchJson(QUEUE_TIMES_URL);
  const rides = [];
  if (Array.isArray(data?.lands)) {
    for (const land of data.lands) {
      if (Array.isArray(land?.rides)) rides.push(...land.rides);
    }
  }
  if (Array.isArray(data?.rides)) rides.push(...data.rides);

  const nowMs = Date.now();
  const seen = new Set();
  return rides
    .map((ride) => {
      const id = ride?.id;
      const name = String(ride?.name || '').replace(/\s+/g, ' ').trim();
      if (id == null || !name) return null;
      const updatedMs = Date.parse(ride?.last_updated);
      const fresh = Number.isFinite(updatedMs) && (nowMs - updatedMs) <= STALE_MS;
      const isOpen = ride?.is_open === true && fresh;
      const waitNum = Number(ride?.wait_time);
      const wait = isOpen && Number.isFinite(waitNum) && waitNum > 0 ? waitNum : null;
      return {
        id: `${ID_PREFIX}${id}`,
        name_en: name,
        name_ja: jaName(name),
        wait_minutes: wait,
        is_open: isOpen,
        status: isOpen ? 'OPERATING' : 'CLOSED',
        access_mode: 'STANDBY',
        official_status_cd: '',
        official_status_label: ''
      };
    })
    .filter((a) => {
      if (!a) return false;
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
}

function summarize(attractions) {
  const count = attractions.length;
  const openCount = attractions.filter((a) => a.is_open).length;
  const waitTimes = attractions
    .filter((a) => a.is_open && typeof a.wait_minutes === 'number')
    .map((a) => a.wait_minutes);
  const totalWait = waitTimes.reduce((sum, w) => sum + w, 0);
  const maxWait = waitTimes.length === 0 ? 0 : Math.max(...waitTimes);
  return {
    count,
    open_count: openCount,
    average_wait: waitTimes.length === 0 ? 0 : Math.round((totalWait / waitTimes.length) * 10) / 10,
    max_wait: maxWait
  };
}

function snapshotPath(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');
  return path.join(BASE_DIR, 'snapshots', `${year}-${month}-${day}`, `${hours}${minutes}.json`);
}

// 当日（収集機のローカルTZ）の既存スナップショットから「一度でも運営した」施設IDを集める。
function operatedTodayIds(now) {
  const ids = new Set();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dir = path.join(BASE_DIR, 'snapshots', `${year}-${month}-${day}`);
  let files = [];
  try {
    files = readdirSync(dir).filter((file) => /^\d{4}\.json$/.test(file));
  } catch {
    return ids;
  }
  for (const file of files) {
    try {
      const snap = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const list = Array.isArray(snap?.attractions) ? snap.attractions : [];
      for (const attr of list) {
        if (!attr || typeof attr.id !== 'string') continue;
        const operated = attr.is_open === true
          || attr.status === 'OPERATING'
          || (typeof attr.wait_minutes === 'number' && Number.isFinite(attr.wait_minutes));
        if (operated) ids.add(attr.id);
      }
    } catch {
      // 壊れたスナップショットはスキップ
    }
  }
  return ids;
}

function writeSnapshot(payload, now) {
  const latestPath = path.join(BASE_DIR, 'latest.json');
  const historyPath = snapshotPath(now);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  mkdirSync(path.dirname(latestPath), { recursive: true });
  mkdirSync(path.dirname(historyPath), { recursive: true });
  writeFileSync(latestPath, json, 'utf8');
  writeFileSync(historyPath, json, 'utf8');
  return { latestPath, historyPath };
}

// 1日分のスナップショットから series.json を再構築する。
function writeDailySeries(dateDir, date, daySnapshots) {
  const sorted = daySnapshots.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const points = [];
  const attractions = new Map();

  for (const { time, snapshot } of sorted) {
    const ms = Date.parse(snapshot?.fetched_at);
    if (!Number.isFinite(ms)) continue;

    points.push({
      ms,
      time,
      fetched_at: snapshot.fetched_at,
      source: snapshot.source ?? null,
      summary: snapshot.summary ?? null
    });
    const pointIndex = points.length - 1;

    const seenIds = new Set();
    const list = Array.isArray(snapshot.attractions) ? snapshot.attractions : [];
    for (const attr of list) {
      if (!attr) continue;
      const id = (typeof attr.id === 'string' && attr.id) ? attr.id : `${ID_PREFIX}${attr.name_en}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      if (!attractions.has(id)) {
        attractions.set(id, {
          name_en: attr.name_en,
          name_ja: attr.name_ja ?? null,
          waits: new Array(pointIndex).fill(null),
          opens: new Array(pointIndex).fill(false),
          statuses: new Array(pointIndex).fill('CLOSED'),
          access_modes: new Array(pointIndex).fill('STANDBY')
        });
      }
      const entry = attractions.get(id);
      entry.name_en = attr.name_en;
      if (attr.name_ja) entry.name_ja = attr.name_ja;

      const status = typeof attr.status === 'string' ? attr.status : (attr.is_open ? 'OPERATING' : 'CLOSED');
      const wait = typeof attr.wait_minutes === 'number' && Number.isFinite(attr.wait_minutes) && attr.wait_minutes >= 0
        ? attr.wait_minutes
        : null;
      entry.waits.push(wait);
      entry.opens.push(status === 'OPERATING');
      entry.statuses.push(status);
      entry.access_modes.push(typeof attr.access_mode === 'string' ? attr.access_mode : 'STANDBY');
    }

    for (const [, entry] of attractions) {
      if (entry.waits.length === pointIndex) {
        entry.waits.push(null);
        entry.opens.push(false);
        entry.statuses.push('CLOSED');
        entry.access_modes.push('STANDBY');
      }
    }
  }

  const series = {
    date,
    updated_at: new Date().toISOString(),
    points,
    attractions: Object.fromEntries(attractions),
    shows: []
  };
  writeFileSync(path.join(dateDir, 'series.json'), `${JSON.stringify(series, null, 2)}\n`, 'utf8');
}

function writeSnapshotIndex(now = new Date()) {
  const snapshotsDir = path.join(BASE_DIR, 'snapshots');
  const indexPath = path.join(snapshotsDir, 'index.json');
  const snapshots = [];

  mkdirSync(snapshotsDir, { recursive: true });

  const dateDirs = readdirSync(snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name);

  for (const date of dateDirs) {
    const dateDir = path.join(snapshotsDir, date);
    const files = readdirSync(dateDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    const daySnapshots = [];
    for (const file of files) {
      const time = path.basename(file, '.json');
      const snapshotFile = path.join(dateDir, file);
      const snapshotJsonPath = `${BASE_DIR}/snapshots/${date}/${file}`;
      try {
        const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
        snapshots.push({
          date,
          time,
          path: snapshotJsonPath,
          fetched_at: snapshot?.fetched_at ?? null,
          max_wait: snapshot?.summary?.max_wait ?? null,
          open_count: snapshot?.summary?.open_count ?? null
        });
        daySnapshots.push({ time, snapshot });
      } catch (error) {
        console.error(`warning: skipped invalid snapshot ${snapshotJsonPath}: ${error?.message || error}`);
      }
    }

    if (daySnapshots.length > 0) {
      writeDailySeries(dateDir, date, daySnapshots);
    }
  }

  snapshots.sort((a, b) => {
    const aTime = Date.parse(a.fetched_at);
    const bTime = Date.parse(b.fetched_at);
    return (Number.isNaN(bTime) ? -Infinity : bTime) - (Number.isNaN(aTime) ? -Infinity : aTime);
  });

  writeFileSync(indexPath, `${JSON.stringify({ updated_at: now.toISOString(), snapshots }, null, 2)}\n`, 'utf8');
  return { indexPath, count: snapshots.length };
}

try {
  const attractions = await fetchAttractions();
  if (attractions.length === 0) throw new Error(`queue-times park ${QT_PARK_ID} returned 0 attractions`);
  const now = new Date();
  // 休止中の施設を当日の運営実績に応じて DOWN（一時運営中止）/ NO_INFO（情報なし）へ分類する。
  const operated = operatedTodayIds(now);
  for (const attr of attractions) {
    if (attr.status === 'OPERATING') continue;
    attr.status = operated.has(attr.id) ? 'DOWN' : 'NO_INFO';
  }
  const payload = {
    fetched_at: now.toISOString(),
    source: 'queue-times',
    attractions,
    summary: summarize(attractions),
    closures: null,
    shows: { source_url: QUEUE_TIMES_URL, fetched_at: now.toISOString(), items: [] }
  };
  const paths = writeSnapshot(payload, now);
  const index = writeSnapshotIndex(now);
  console.log(`[${PARK_KEY}] source=${payload.source} count=${payload.summary.count} max_wait=${payload.summary.max_wait} open=${payload.summary.open_count}`);
  console.log(`[${PARK_KEY}] saved ${paths.latestPath}`);
  console.log(`[${PARK_KEY}] saved ${index.indexPath} (${index.count} entries)`);
} catch (error) {
  console.error(`[${PARK_KEY}] collect failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
}
