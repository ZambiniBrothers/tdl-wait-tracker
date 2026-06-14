// ユニバーサル・スタジオ・ジャパン（USJ）の待ち時間を収集し data/usj/ に保存する独立スクリプト。
// データ源は queue-times.com（park 284）。TDR系（collect.mjs / collect-tds.mjs）とは分離してあり、
// 本スクリプトが失敗しても他パークの収集は影響を受けない。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_DIR = path.join('data', 'usj');
const USJ_QUEUE_TIMES_URL = 'https://queue-times.com/parks/284/queue_times.json';
const TIMEOUT_MS = 12_000;

// queue-times の英語名 → 日本語表示名。未掲載は元の名前をそのまま使う（新アトラクションは
// 既に日本語名のことが多い）。キーは ™ と前後空白を除去して照合する。
const USJ_JA_MAP = {
  'Despicable Me Minion Mayhem': 'ミニオン・ハチャメチャ・ライド',
  'Detective Conan: The World': '名探偵コナン・ザ・ワールド',
  'Flight of the Hippogriff': 'フライト・オブ・ザ・ヒッポグリフ',
  'Freeze Ray Sliders': 'フリーズ・レイ・スライダー',
  'Harry Potter and the Forbidden Journey': 'ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー',
  "Hello Kitty's Cupcake Dream": 'ハローキティのカップケーキ・ドリーム',
  "Hello Kitty's Ribbon Collection": 'ハローキティのリボン・コレクション',
  'Hollywood Dream - The Ride': 'ハリウッド・ドリーム・ザ・ライド',
  'Hollywood Dream -The Ride - Backdrop-': 'ハリウッド・ドリーム・ザ・ライド〜バックドロップ〜',
  'JAWS': 'ジョーズ',
  'Jurassic Park – The Ride': 'ジュラシック・パーク・ザ・ライド',
  "Mario Kart: Koopa's Challenge": 'マリオカート 〜クッパの挑戦状〜',
  'Mine Cart Madness': 'ドンキーコングのクレイジー・トロッコ',
  'Ollivanders': 'オリバンダーの店',
  'Playing with Curious George': 'おさるのジョージ',
  'Sesame Street 4-D Movie Magic': 'セサミストリート 4-D ムービーマジック',
  "Shrek's 4-D Adventure": 'シュレック 4-D アドベンチャー',
  'Shrek’s 4-D Adventure': 'シュレック 4-D アドベンチャー',
  'SING ON TOUR': 'シング・オン・ツアー',
  'Space Fantasy – The Ride': 'スペース・ファンタジー・ザ・ライド',
  'The Flying Dinosaur': 'ザ・フライング・ダイナソー',
  'The Flying Snoopy': 'フライング・スヌーピー',
  "Yoshi's Adventure": 'ヨッシー・アドベンチャー'
};

function jaName(rawName) {
  const trimmed = String(rawName || '').replace(/™/g, '').replace(/\s+/g, ' ').trim();
  return USJ_JA_MAP[trimmed] || String(rawName || '').replace(/\s+/g, ' ').trim();
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

async function fetchUsjAttractions() {
  const data = await fetchJson(USJ_QUEUE_TIMES_URL);
  const rides = [];
  if (Array.isArray(data?.lands)) {
    for (const land of data.lands) {
      if (Array.isArray(land?.rides)) rides.push(...land.rides);
    }
  }
  if (Array.isArray(data?.rides)) rides.push(...data.rides);

  const seen = new Set();
  return rides
    .map((ride) => {
      const id = ride?.id;
      const name = String(ride?.name || '').replace(/\s+/g, ' ').trim();
      if (id == null || !name) return null;
      const isOpen = ride?.is_open === true;
      const waitNum = Number(ride?.wait_time);
      const wait = isOpen && Number.isFinite(waitNum) && waitNum > 0 ? waitNum : null;
      return {
        id: `a-usj-${id}`,
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

// 1日分のスナップショットから series.json を再構築する。id は attr.id（USJ施設ID由来）を用いる。
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
      const id = (typeof attr.id === 'string' && attr.id) ? attr.id : `a-usj-${attr.name_en}`;
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
  const attractions = await fetchUsjAttractions();
  if (attractions.length === 0) throw new Error('USJ queue-times returned 0 attractions');
  const now = new Date();
  const payload = {
    fetched_at: now.toISOString(),
    source: 'queue-times',
    attractions,
    summary: summarize(attractions),
    closures: null,
    shows: { source_url: USJ_QUEUE_TIMES_URL, fetched_at: now.toISOString(), items: [] }
  };
  const paths = writeSnapshot(payload, now);
  const index = writeSnapshotIndex(now);
  console.log(`[usj] source=${payload.source} count=${payload.summary.count} max_wait=${payload.summary.max_wait} open=${payload.summary.open_count}`);
  console.log(`[usj] saved ${paths.latestPath}`);
  console.log(`[usj] saved ${index.indexPath} (${index.count} entries)`);
} catch (error) {
  console.error(`[usj] collect failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
}
