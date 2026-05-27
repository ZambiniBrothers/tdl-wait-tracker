import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const THEMEPARKS_URL = 'https://api.themeparks.wiki/v1/entity/3cc919f1-d16d-43e0-8c3f-1dd269bd1a42/live';
const QUEUE_TIMES_URL = 'https://queue-times.com/parks/274/queue_times.json';
const TIMEOUT_MS = 10_000;

const NAME_MAP = {
  "Peter Pan's Flight": 'ピーターパン空の旅',
  'Splash Mountain': 'スプラッシュ・マウンテン',
  'Big Thunder Mountain': 'ビッグサンダー・マウンテン',
  'Space Mountain': 'スペース・マウンテン',
  'Haunted Mansion': 'ホーンテッドマンション',
  'Pirates of the Caribbean': 'カリブの海賊',
  "Pooh's Hunny Hunt": 'プーさんのハニーハント',
  'Monsters, Inc. Ride & Go Seek!': 'モンスターズ・インク "ライド&ゴーシーク!"',
  'The Happy Ride with Baymax': 'ベイマックスのハッピーライド',
  'Enchanted Tale of Beauty and the Beast': '美女と野獣"魔法のものがたり"',
  "it's a small world": 'イッツ・ア・スモールワールド',
  'it’s a small world': 'イッツ・ア・スモールワールド',
  '“it’s a small world with Groot”': 'イッツ・ア・スモールワールド with グルート',
  "Snow White's Adventures": '白雪姫と七人のこびと',
  "Roger Rabbit's Car Toon Spin": 'ロジャーラビットのカートゥーンスピン',
  "Alice's Tea Party": 'アリスのティーパーティー',
  'Dumbo The Flying Elephant': '空飛ぶダンボ',
  'Dumbo the Flying Elephant': '空飛ぶダンボ',
  'Castle Carrousel': 'キャッスルカルーセル',
  'Mark Twain Riverboat': '蒸気船マークトウェイン号',
  'Western River Railroad': 'ウエスタンリバー鉄道',
  'Country Bear Theater': 'カントリーベア・シアター',
  'Jungle Cruise: Wildlife Expeditions': 'ジャングルクルーズ:ワイルドライフ・エクスペディション',
  "The Enchanted Tiki Room: Stitch Presents 'Aloha E Komo Mai!'": '魅惑のチキルーム:スティッチ・プレゼンツ "アロハ・エ・コモ・マイ!"',
  'The Enchanted Tiki Room: Stitch Presents “Aloha E Komo Mai!”': '魅惑のチキルーム:スティッチ・プレゼンツ "アロハ・エ・コモ・マイ!"',
  "Buzz Lightyear's Astro Blasters": 'バズ・ライトイヤーのアストロブラスター',
  'Star Tours: The Adventures Continue': 'スター・ツアーズ:ザ・アドベンチャーズ・コンティニュー',
  'Tomorrowland Hall': 'トゥモローランド・ホール',
  Omnibus: 'オムニバス',
  'Penny Arcade': 'ペニーアーケード',
  'Swiss Family Treehouse': 'スイスファミリー・ツリーハウス',
  'Tom Sawyer Island Rafts': 'トムソーヤ島いかだ',
  'Beaver Brothers Explorer Canoes': 'ビーバーブラザーズのカヌー探険',
  "Cinderella's Fairy Tale Hall": 'シンデレラのフェアリーテイル・ホール',
  'Mickey’s PhilharMagic': 'ミッキーのフィルハーマジック',
  "Mickey's PhilharMagic": 'ミッキーのフィルハーマジック',
  "Pinocchio's Daring Journey": 'ピノキオの冒険旅行',
  'Gadget’s Go Coaster': 'ガジェットのゴーコースター',
  "Gadget's Go Coaster": 'ガジェットのゴーコースター',
  "Goofy's Paint 'n' Play House": 'グーフィーのペイント&プレイハウス',
  "Minnie's House": 'ミニーの家',
  "Donald's Boat": 'ドナルドのボート',
  "Chip 'n Dale's Treehouse": 'チップとデールのツリーハウス',
  'Toon Park': 'トゥーンパーク',
  'Stitch Encounter': 'スティッチ・エンカウンター'
};

function normalizeAttractionId(nameEn) {
  const slug = String(nameEn || '')
    .toLowerCase()
    .replace(/['’"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `a-${slug}` : 'a-unknown';
}

function waitMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`JSON parse failed: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeThemeParks(data) {
  if (!Array.isArray(data?.liveData)) {
    throw new Error('ThemeParks response did not include liveData[]');
  }

  return data.liveData
    .filter((entity) => entity?.entityType === 'ATTRACTION')
    .map((entity) => {
      const name = String(entity?.name || '').trim();
      const status = entity?.status;
      return {
        id: normalizeAttractionId(name),
        name_en: name,
        name_ja: NAME_MAP[name] ?? null,
        wait_minutes: status === 'OPERATING' ? waitMinutes(entity?.queue?.STANDBY?.waitTime) : null,
        is_open: status === 'OPERATING'
      };
    })
    .filter((attraction) => attraction.name_en);
}

function normalizeQueueTimes(data) {
  if (!Array.isArray(data?.lands)) {
    throw new Error('queue-times response did not include lands[]');
  }

  return data.lands
    .flatMap((land) => Array.isArray(land?.rides) ? land.rides : [])
    .map((ride) => {
      const name = String(ride?.name || '').trim();
      const isOpen = Boolean(ride?.is_open);
      return {
        id: normalizeAttractionId(name),
        name_en: name,
        name_ja: NAME_MAP[name] ?? null,
        wait_minutes: isOpen ? waitMinutes(ride?.wait_time) : null,
        is_open: isOpen
      };
    })
    .filter((attraction) => attraction.name_en);
}

function summarize(attractions) {
  const count = attractions.length;
  const openCount = attractions.filter((attraction) => attraction.is_open).length;
  const waitTimes = attractions
    .filter((attraction) => attraction.is_open && typeof attraction.wait_minutes === 'number')
    .map((attraction) => attraction.wait_minutes);
  const totalWait = waitTimes.reduce((sum, wait) => sum + wait, 0);
  const maxWait = waitTimes.length === 0 ? 0 : Math.max(...waitTimes);

  return {
    count,
    open_count: openCount,
    average_wait: waitTimes.length === 0 ? 0 : Math.round((totalWait / waitTimes.length) * 10) / 10,
    max_wait: maxWait
  };
}

async function collect() {
  const attempts = [
    {
      source: 'themeparks',
      url: THEMEPARKS_URL,
      normalize: normalizeThemeParks
    },
    {
      source: 'queue-times',
      url: QUEUE_TIMES_URL,
      normalize: normalizeQueueTimes
    }
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      const data = await fetchJson(attempt.url);
      const attractions = attempt.normalize(data);
      if (attractions.length === 0) {
        throw new Error('No attractions found after normalization');
      }
      return { source: attempt.source, attractions };
    } catch (error) {
      errors.push(`${attempt.source}: ${error?.message || error}`);
    }
  }

  throw new Error(errors.join(' / '));
}

function snapshotPath(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');

  return path.join('data', 'snapshots', `${year}-${month}-${day}`, `${hours}${minutes}.json`);
}

function writeSnapshot(payload, now) {
  const latestPath = path.join('data', 'latest.json');
  const historyPath = snapshotPath(now);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  mkdirSync(path.dirname(latestPath), { recursive: true });
  mkdirSync(path.dirname(historyPath), { recursive: true });
  writeFileSync(latestPath, json, 'utf8');
  writeFileSync(historyPath, json, 'utf8');

  return { latestPath, historyPath };
}

function writeSnapshotIndex(now = new Date()) {
  const snapshotsDir = path.join('data', 'snapshots');
  const indexPath = path.join(snapshotsDir, 'index.json');
  const snapshots = [];

  mkdirSync(snapshotsDir, { recursive: true });

  const dateDirs = readdirSync(snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name);

  for (const date of dateDirs) {
    const dateDir = path.join(snapshotsDir, date);
    const files = readdirSync(dateDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name) && entry.name !== 'index.json')
      .map((entry) => entry.name);

    for (const file of files) {
      const time = path.basename(file, '.json');
      const snapshotFile = path.join(dateDir, file);
      const snapshotJsonPath = `data/snapshots/${date}/${file}`;

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
      } catch (error) {
        console.error(`warning: skipped invalid snapshot ${snapshotJsonPath}: ${error?.message || error}`);
      }
    }
  }

  snapshots.sort((a, b) => {
    const aTime = Date.parse(a.fetched_at);
    const bTime = Date.parse(b.fetched_at);
    return (Number.isNaN(bTime) ? -Infinity : bTime) - (Number.isNaN(aTime) ? -Infinity : aTime);
  });

  const index = {
    updated_at: now.toISOString(),
    snapshots
  };

  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  return { indexPath, count: snapshots.length };
}

try {
  const result = await collect();
  const now = new Date();
  const payload = {
    fetched_at: now.toISOString(),
    source: result.source,
    attractions: result.attractions,
    summary: summarize(result.attractions)
  };
  const paths = writeSnapshot(payload, now);
  const index = writeSnapshotIndex(now);

  console.log(`source=${payload.source} count=${payload.summary.count} max_wait=${payload.summary.max_wait}`);
  console.log(`saved ${paths.latestPath}`);
  console.log(`saved ${paths.historyPath}`);
  console.log(`saved ${index.indexPath} (${index.count} entries)`);
} catch (error) {
  console.error(`collect failed: ${error?.message || error}`);
  process.exit(1);
}
