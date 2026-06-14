// 東京ディズニーシー（TDS）の待ち時間を収集し data/tds/ に保存する独立スクリプト。
// TDL 用 collect.mjs とは分離してあり、本スクリプトが失敗しても TDL の収集は影響を受けない。
// 施設IDベースの id（a-{FacilityID}）を用いるため、英名マップは不要。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_DIR = path.join('data', 'tds');
const TDS_OFFICIAL_URL = 'https://www.tokyodisneyresort.jp/_/realtime/tds_attraction.json';
const TDS_SHOW_URL = 'https://www.tokyodisneyresort.jp/tds/show.html';
const TDS_SHOW_SCHEDULE_URL = (id) => `https://www.tokyodisneyresort.jp/tds/show/schedule/${id}/`;
const TIMEOUT_MS = 10_000;
const TDR_TIMEOUT_MS = 15_000;

// OperatingStatusCD の分類（collect.mjs と同一）。
const DOWN_STATUS_CDS = new Set(['004', '031', '032', '033']);
const OPERATING_STATUS_CDS = new Set([
  '001', '024', '025', '026', '027',
  '034', '035', '036', '037', '038',
  '040', '041', '045', '047'
]);
const PP_ONLY_CDS = new Set(['045', '047']);
const STANDBY_PASS_ONLY_CDS = new Set(['026']);
const ENTRY_ONLY_CDS = new Set(['034', '035', '036', '037', '038']);
const PP_ONLY_LABEL_RE = /プライオリティ[・･]?アクセス/;
const SYSTEM_HALT_LABEL_RE = /一時運営中止/;
const STANDBY_PASS_LABEL_RE = /スタンバイパス.*のみ/;
const ENTRY_ONLY_LABEL_RE = /エントリー.*予約済み/;

function deriveAccessMode(cd, label) {
  const s = String(cd || '');
  if (PP_ONLY_CDS.has(s)) return 'PP_ONLY';
  if (STANDBY_PASS_ONLY_CDS.has(s)) return 'STANDBY_PASS_ONLY';
  if (ENTRY_ONLY_CDS.has(s)) return 'ENTRY_ONLY';
  const l = String(label || '');
  if (PP_ONLY_LABEL_RE.test(l)) return 'PP_ONLY';
  if (STANDBY_PASS_LABEL_RE.test(l)) return 'STANDBY_PASS_ONLY';
  if (ENTRY_ONLY_LABEL_RE.test(l)) return 'ENTRY_ONLY';
  return 'STANDBY';
}

function classifyTdrStatusCd(cd, label) {
  const s = String(cd || '');
  if (DOWN_STATUS_CDS.has(s)) return 'DOWN';
  if (OPERATING_STATUS_CDS.has(s)) return 'OPERATING';
  const l = String(label || '');
  if (SYSTEM_HALT_LABEL_RE.test(l)) return 'DOWN';
  if (PP_ONLY_LABEL_RE.test(l) || STANDBY_PASS_LABEL_RE.test(l) || ENTRY_ONLY_LABEL_RE.test(l)) return 'OPERATING';
  return 'CLOSED';
}

function normalizeAttractionId(nameEn) {
  const slug = String(nameEn || '')
    .toLowerCase()
    .replace(/['’"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `a-${slug}` : 'a-unknown';
}

async function fetchTdsOfficial() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TDR_TIMEOUT_MS);
  let data;
  try {
    const response = await fetch(TDS_OFFICIAL_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker/1.0)',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'ja',
        'Referer': 'https://www.tokyodisneyresort.jp/tds/attraction.html'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    data = await response.json();
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(data)) {
    throw new Error('TDS official response was not an array');
  }

  return data
    .map((item) => {
      const facilityName = String(item?.FacilityName || '').trim();
      const facilityId = String(item?.FacilityID || '').trim();
      if (!facilityName || !facilityId) return null;
      const cd = String(item?.OperatingStatusCD || '');
      const officialLabel = String(item?.OperatingStatus || '');
      const status = classifyTdrStatusCd(cd, officialLabel);
      const accessMode = status === 'OPERATING' ? deriveAccessMode(cd, officialLabel) : 'STANDBY';
      const standbyNum = Number(item?.StandbyTime);
      const standby = Number.isFinite(standbyNum) && standbyNum > 0 ? standbyNum : null;
      return {
        id: `a-${facilityId}`,
        name_en: facilityName,
        name_ja: facilityName,
        wait_minutes: status === 'OPERATING' ? standby : null,
        is_open: status === 'OPERATING',
        status,
        access_mode: accessMode,
        official_status_cd: cd,
        official_status_label: officialLabel
      };
    })
    .filter((attraction) => attraction);
}

async function fetchText(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// ===== ショー/パレード時刻の取得（collect.mjs のTDL用ロジックと同一・URLのみTDS） =====
function dedupeAndSortShows(items) {
  const seen = new Set();
  return items
    .filter((item) => item && typeof item.time === 'string')
    .map((item) => ({
      time: item.time,
      label: String(item.label || '').replace(/\s+/g, ' ').trim(),
      name_ja: String(item.name_ja || item.label || '').replace(/\s+/g, ' ').trim()
    }))
    .filter((item) => item.label)
    .filter((item) => {
      const key = `${item.time}\u0000${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 40);
}

function jstTodayYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

function jstDayWeekday() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', day: 'numeric', weekday: 'short'
  }).formatToParts(new Date());
  const day = (parts.find((p) => p.type === 'day') || {}).value || '';
  const weekday = ((parts.find((p) => p.type === 'weekday') || {}).value || '').replace(/[曜日]/g, '');
  return { day: String(Number(day)), weekday };
}

function cleanShowName(rawHeading) {
  return String(rawHeading || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:NEW|New)\s*$/, '')
    .trim();
}

function extractListBlockTimes(region, today) {
  const times = [];
  const dateBlockRe = new RegExp(`date-${today}\\b`, 'g');
  const nextDateRe = /date-\d{8}\b/g;
  const liTimeRe = /<li>\s*([01]?\d|2[0-3])[:：]([0-5]\d)\s*<\/li>/g;
  let bm;
  while ((bm = dateBlockRe.exec(region))) {
    nextDateRe.lastIndex = bm.index + bm[0].length;
    const nm = nextDateRe.exec(region);
    const ulEnd = region.indexOf('</ul>', bm.index);
    const candidates = [nm ? nm.index : region.length];
    if (ulEnd >= 0) candidates.push(ulEnd + 5);
    const blockEnd = Math.min(...candidates);
    const window = region.slice(bm.index, blockEnd);
    let tm;
    liTimeRe.lastIndex = 0;
    while ((tm = liTimeRe.exec(window))) {
      times.push(`${tm[1].padStart(2, '0')}:${tm[2]}`);
    }
  }
  return times;
}

function hasIconTag(region, keyword) {
  const re = /<div class="iconTag">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(region))) {
    if (m[1].includes(keyword)) return true;
  }
  return false;
}

function parseShowList(html) {
  const source = String(html || '');
  const today = jstTodayYmd();
  const headingRe = /<h3 class="heading3">([\s\S]*?)<\/h3>/g;
  const heads = [];
  let hm;
  while ((hm = headingRe.exec(source))) {
    heads.push({ index: hm.index, name: cleanShowName(hm[1]) });
  }
  const shows = [];
  for (let i = 0; i < heads.length; i++) {
    const { index, name } = heads[i];
    if (!name || name.includes('{{')) continue;
    const end = i + 1 < heads.length ? heads[i + 1].index : source.length;
    const region = source.slice(index, end);
    const schedMatch = region.match(/\/tds\/show\/schedule\/(\d+)\//);
    shows.push({
      name,
      scheduleId: schedMatch ? schedMatch[1] : null,
      requiresEntry: hasIconTag(region, 'エントリー受付'),
      requiresReservation: hasIconTag(region, '予約'),
      listTimes: extractListBlockTimes(region, today)
    });
  }
  return shows;
}

function parseScheduleDayTimes(scheduleHtml, day, weekday) {
  const rowRe = /<th[^>]*>\s*(\d{1,2})\s*[（(]\s*([日月火水木金土])\s*[）)]\s*<\/th>\s*<td>([\s\S]*?)<\/td>/g;
  const timeRe = /([01]?\d|2[0-3])[:：]([0-5]\d)/g;
  let m;
  while ((m = rowRe.exec(scheduleHtml))) {
    if (Number(m[1]) !== Number(day) || m[2] !== weekday) continue;
    const times = new Set();
    let t;
    timeRe.lastIndex = 0;
    while ((t = timeRe.exec(m[3]))) times.add(`${t[1].padStart(2, '0')}:${t[2]}`);
    return [...times];
  }
  return [];
}

async function fetchTdsShows() {
  try {
    const html = await fetchText(TDS_SHOW_URL, TDR_TIMEOUT_MS);
    const shows = parseShowList(html);
    const { day, weekday } = jstDayWeekday();
    const items = [];
    let excluded = 0;
    for (const show of shows) {
      if (show.requiresEntry || show.requiresReservation) {
        excluded++;
        continue;
      }
      let times = [];
      if (show.scheduleId) {
        try {
          const scheduleHtml = await fetchText(TDS_SHOW_SCHEDULE_URL(show.scheduleId), TDR_TIMEOUT_MS);
          times = parseScheduleDayTimes(scheduleHtml, day, weekday);
        } catch (error) {
          console.error(`[tds] warning: schedule fetch failed (${show.scheduleId}): ${error?.message || error}`);
        }
      }
      if (times.length === 0) times = show.listTimes;
      for (const time of times) items.push({ time, label: show.name, name_ja: show.name });
    }
    const finalItems = dedupeAndSortShows(items);
    console.error(`[tds] shows=${shows.length} excluded=${excluded} parsed=${finalItems.length} sample=${JSON.stringify(finalItems.slice(0, 6))}`);
    if (finalItems.length > 0) {
      return { source_url: TDS_SHOW_URL, fetched_at: new Date().toISOString(), items: finalItems };
    }
  } catch (error) {
    console.error(`[tds] warning: show scrape failed: ${error?.message || error}`);
  }
  return null;
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

// 1日分のスナップショットから series.json を再構築する。
// TDS は name_en が日本語のため id は attr.id（施設IDベース）を優先する。
function writeDailySeries(dateDir, date, daySnapshots) {
  const sorted = daySnapshots.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const points = [];
  const attractions = new Map();
  let latestShows = [];

  for (const { time, snapshot } of sorted) {
    const ms = Date.parse(snapshot?.fetched_at);
    if (!Number.isFinite(ms)) continue;

    const snapshotShows = Array.isArray(snapshot?.shows?.items) ? snapshot.shows.items : [];
    if (snapshotShows.length > 0) latestShows = snapshotShows;

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
      const id = (typeof attr.id === 'string' && attr.id) ? attr.id : normalizeAttractionId(attr.name_en);
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

      const hasOfficialCd = typeof attr.official_status_cd === 'string' && attr.official_status_cd !== '';
      const derivedStatus = hasOfficialCd
        ? classifyTdrStatusCd(attr.official_status_cd, attr.official_status_label)
        : (typeof attr.status === 'string' ? attr.status : (attr.is_open ? 'OPERATING' : 'CLOSED'));
      const derivedAccessMode = hasOfficialCd && derivedStatus === 'OPERATING'
        ? deriveAccessMode(attr.official_status_cd, attr.official_status_label)
        : (typeof attr.access_mode === 'string' ? attr.access_mode : 'STANDBY');
      const wait = typeof attr.wait_minutes === 'number' && Number.isFinite(attr.wait_minutes) && attr.wait_minutes >= 0
        ? attr.wait_minutes
        : null;
      entry.waits.push(wait);
      entry.opens.push(derivedStatus === 'OPERATING');
      entry.statuses.push(derivedStatus);
      entry.access_modes.push(derivedAccessMode);
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
    shows: latestShows
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
  const attractions = await fetchTdsOfficial();
  if (attractions.length === 0) throw new Error('TDS official returned 0 attractions');
  const showInfo = await fetchTdsShows();
  const now = new Date();
  const payload = {
    fetched_at: now.toISOString(),
    source: 'tdr-official',
    attractions,
    summary: summarize(attractions),
    closures: null,
    shows: showInfo || { source_url: TDS_SHOW_URL, fetched_at: now.toISOString(), items: [] }
  };
  const paths = writeSnapshot(payload, now);
  const index = writeSnapshotIndex(now);
  console.log(`[tds] source=${payload.source} count=${payload.summary.count} max_wait=${payload.summary.max_wait} open=${payload.summary.open_count} shows=${payload.shows.items.length}`);
  console.log(`[tds] saved ${paths.latestPath}`);
  console.log(`[tds] saved ${index.indexPath} (${index.count} entries)`);
} catch (error) {
  console.error(`[tds] collect failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
}
