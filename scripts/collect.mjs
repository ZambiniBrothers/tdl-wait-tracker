import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TDR_OFFICIAL_URL = 'https://www.tokyodisneyresort.jp/_/realtime/tdl_attraction.json';
const TDL_SHOW_URL = 'https://www.tokyodisneyresort.jp/tdl/show.html';
const THEMEPARKS_URL = 'https://api.themeparks.wiki/v1/entity/3cc919f1-d16d-43e0-8c3f-1dd269bd1a42/live';
const QUEUE_TIMES_URL = 'https://queue-times.com/parks/274/queue_times.json';
const TDL_STOP_URL = 'https://www.tokyodisneyresort.jp/tdl/monthly/stop.html';
const TIMEOUT_MS = 10_000;
const TDR_TIMEOUT_MS = 15_000;
const TDL_SHOW_SCHEDULE_URL = (id) => `https://www.tokyodisneyresort.jp/tdl/show/schedule/${id}/`;

// Code mapping per the OperatingStatusCD dictionary embedded in tdl/attraction.html
// 004/031/032/033 → 一時運営中止 (DOWN, treated as system adjustment)
// 001/024/025/026/027/034〜038/040/041/045 → operating (with various access modes)
const DOWN_STATUS_CDS = new Set(['004', '031', '032', '033']);
const OPERATING_STATUS_CDS = new Set([
  '001', '024', '025', '026', '027',
  '034', '035', '036', '037', '038',
  '040', '041', '045', '047'
]);
// Pass / entry-only operating modes (no standby queue available).
// 045 / 047 = プライオリティ・アクセス（DPA）専用、PP のみで案内中
// 026 = スタンバイパス保持者のみ
// 034〜038 = エントリー予約済みのみ
const PP_ONLY_CDS = new Set(['045', '047']);
const STANDBY_PASS_ONLY_CDS = new Set(['026']);
const ENTRY_ONLY_CDS = new Set(['034', '035', '036', '037', '038']);
// Label-based fallbacks — if TDR adds a new code variant we still classify it correctly.
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
  'Westernland Shootin\' Gallery': 'ウエスタンランド・シューティングギャラリー',
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

function normalizeJaName(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    // Quote normalization: curly ' ' ' ' " " " " 」 「 → straight " (then we drop them in slug, but key stays consistent)
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″〝〞〟]/g, '"')
    // Full-width punctuation → half-width
    .replace(/＆/g, '&')   // ＆ → &
    .replace(/！/g, '!')   // ！ → !
    .replace(/？/g, '?')   // ？ → ?
    .replace(/：/g, ':')   // ： → :
    .replace(/（/g, '(')   // （ → (
    .replace(/）/g, ')')   // ） → )
    // Tilde normalization
    .replace(/[～~]/g, '〜');
}

const JA_TO_EN = (() => {
  const map = Object.create(null);
  for (const [en, ja] of Object.entries(NAME_MAP)) {
    if (!ja) continue;
    const key = normalizeJaName(ja);
    if (!(key in map)) map[key] = en;
  }
  return map;
})();

function waitMinutes(value) {
  const minutes = Number(value);
  // Return null when the source did not provide a positive wait — never default
  // to 0 since TDL never has a true 0-minute wait.
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchTdlClosures() {
  try {
    const html = await fetchText(TDL_STOP_URL, TDR_TIMEOUT_MS);
    const text = htmlToText(html);
    const closures = Object.create(null);
    // Matches "2026/5/22 - 2026/6/15", "2026/5/22～2026/6/15", "2026年5月22日 - 2026年6月15日"
    const datePattern = /(\d{4}[\/年]\d{1,2}[\/月]\d{1,2}日?\s*[～~\-－]\s*\d{4}[\/年]\d{1,2}[\/月]\d{1,2}日?)/;
    for (const [nameEn, nameJa] of Object.entries(NAME_MAP)) {
      const id = normalizeAttractionId(nameEn);
      if (!nameJa || closures[id]) continue;
      const idx = text.indexOf(nameJa);
      if (idx < 0) continue;
      // Search window: just after the name, up to next attraction match (approx 120 chars)
      const after = text.slice(idx + nameJa.length, idx + nameJa.length + 80);
      const dateMatch = after.match(datePattern);
      if (!dateMatch) continue;
      const period = normalizePeriodText(dateMatch[1]);
      closures[id] = {
        name_ja: nameJa,
        period,
        excerpt: `${nameJa} ${period}`
      };
    }
    return {
      source_url: TDL_STOP_URL,
      fetched_at: new Date().toISOString(),
      closures
    };
  } catch (error) {
    console.error(`warning: TDL closure scrape failed: ${error?.message || error}`);
    return null;
  }
}

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
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

// Today's day-of-month + weekday kanji in JST — used to match rows on the
// monthly schedule page, which list "13(土)" rather than a full YYYYMMDD.
function jstDayWeekday() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    day: 'numeric',
    weekday: 'short'
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

// Fallback: today's (JST) times from the list page's hidden date-YYYYMMDD block.
function extractListBlockTimes(region, today) {
  const times = [];
  const dateBlockRe = new RegExp(`date-${today}\\b`, 'g');
  const nextDateRe = /date-\d{8}\b/g;
  const liTimeRe = /<li>\s*([01]?\d|2[0-3])[:：]([0-5]\d)\s*<\/li>/g;
  let bm;
  while ((bm = dateBlockRe.exec(region))) {
    nextDateRe.lastIndex = bm.index + bm[0].length;
    const nm = nextDateRe.exec(region);
    // Bound the block at its time-list close (</ul>) so a heavy day's full list
    // is captured, while never bleeding past the next date sibling.
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

// Detect a requirement badge. On show.html each card marks entry/reservation
// with <div class="iconTag">エントリー受付対象</div> / <div class="iconTag">予約が必須</div>.
// We scope to that element so the bare keywords inside the page's trailing JSON
// (important_tag dictionaries, status-code labels) can't trigger false positives —
// the last show's region runs to EOF and would otherwise inherit every other
// show's badge text.
function hasIconTag(region, keyword) {
  const re = /<div class="iconTag">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(region))) {
    if (m[1].includes(keyword)) return true;
  }
  return false;
}

// Parse show.html into a list of shows: name, monthly-schedule id, and the
// エントリー受付 / 予約 badges so callers can exclude them.
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
    const schedMatch = region.match(/\/tdl\/show\/schedule\/(\d+)\//);
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

// Pull today's times from a monthly schedule page by matching the row whose
// day-of-month and weekday kanji equal today's (JST).
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

async function fetchTdlShows() {
  try {
    const html = await fetchText(TDL_SHOW_URL, TDR_TIMEOUT_MS);
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
          const scheduleHtml = await fetchText(TDL_SHOW_SCHEDULE_URL(show.scheduleId), TDR_TIMEOUT_MS);
          times = parseScheduleDayTimes(scheduleHtml, day, weekday);
        } catch (error) {
          console.error(`warning: schedule fetch failed (${show.scheduleId}): ${error?.message || error}`);
        }
      }
      if (times.length === 0) times = show.listTimes;
      for (const time of times) items.push({ time, label: show.name, name_ja: show.name });
    }
    const finalItems = dedupeAndSortShows(items);
    console.error(`[shows] shows=${shows.length} excluded=${excluded} parsed=${finalItems.length} sample=${JSON.stringify(finalItems.slice(0, 8))}`);
    if (finalItems.length > 0) {
      return {
        source_url: TDL_SHOW_URL,
        fetched_at: new Date().toISOString(),
        items: finalItems
      };
    }
  } catch (error) {
    console.error(`warning: TDL show scrape failed: ${error?.message || error}`);
  }

  return null;
}

function normalizePeriodText(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[～~]/g, '〜')
    .replace(/\s*[-－]\s*/g, ' 〜 ')
    .replace(/\s*〜\s*/g, ' 〜 ')
    .trim();
}

function normalizeStatus(rawStatus) {
  const s = String(rawStatus || '').toUpperCase();
  if (s === 'OPERATING') return 'OPERATING';
  if (s === 'DOWN') return 'DOWN';
  if (s === 'REFURBISHMENT') return 'REFURBISHMENT';
  if (s === 'CLOSED') return 'CLOSED';
  return 'CLOSED';
}

function classifyTdrStatusCd(cd, label) {
  const s = String(cd || '');
  if (DOWN_STATUS_CDS.has(s)) return 'DOWN';
  if (OPERATING_STATUS_CDS.has(s)) return 'OPERATING';
  // Label-based fallback for unknown codes (e.g., TDR adds a new variant).
  const l = String(label || '');
  if (SYSTEM_HALT_LABEL_RE.test(l)) return 'DOWN';
  if (PP_ONLY_LABEL_RE.test(l) || STANDBY_PASS_LABEL_RE.test(l) || ENTRY_ONLY_LABEL_RE.test(l)) return 'OPERATING';
  // 002/003/039 (案内終了/運営公演中止) and others => closed for now
  return 'CLOSED';
}

async function fetchTdrOfficial() {
  const data = await (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TDR_TIMEOUT_MS);
    try {
      const response = await fetch(TDR_OFFICIAL_URL, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker/1.0)',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'ja',
          'Referer': 'https://www.tokyodisneyresort.jp/tdl/attraction.html'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  })();

  if (!Array.isArray(data)) {
    throw new Error('TDR official response was not an array');
  }

  return data
    .map((item) => {
      const facilityName = String(item?.FacilityName || '').trim();
      if (!facilityName) return null;
      const nameJaKey = normalizeJaName(facilityName);
      const nameEn = JA_TO_EN[nameJaKey];
      if (!nameEn) {
        console.error(`warning: no NAME_MAP entry for FacilityName=${JSON.stringify(facilityName)} normalized=${JSON.stringify(nameJaKey)} - falling back to id=a-unknown`);
      }
      const resolvedEn = nameEn || facilityName;
      const cd = String(item?.OperatingStatusCD || '');
      const officialLabel = String(item?.OperatingStatus || '');
      const status = classifyTdrStatusCd(cd, officialLabel);
      const accessMode = status === 'OPERATING' ? deriveAccessMode(cd, officialLabel) : 'STANDBY';
      // TDR returns StandbyTime as a STRING ("5", "30") for queueable rides,
      // null for shows / 案内終了 / continuous-flow, "0" for 運営・公演中止 backend transient,
      // and `false` for non-queueable facilities (ペニーアーケード / トゥーンパーク).
      // Coerce via Number() and discard anything that is not a positive integer.
      const standbyNum = Number(item?.StandbyTime);
      const standby = Number.isFinite(standbyNum) && standbyNum > 0 ? standbyNum : null;
      return {
        id: normalizeAttractionId(resolvedEn),
        name_en: resolvedEn,
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

function normalizeThemeParks(data) {
  if (!Array.isArray(data?.liveData)) {
    throw new Error('ThemeParks response did not include liveData[]');
  }

  return data.liveData
    .filter((entity) => entity?.entityType === 'ATTRACTION')
    .map((entity) => {
      const name = String(entity?.name || '').trim();
      const status = normalizeStatus(entity?.status);
      return {
        id: normalizeAttractionId(name),
        name_en: name,
        name_ja: NAME_MAP[name] ?? null,
        wait_minutes: status === 'OPERATING' ? waitMinutes(entity?.queue?.STANDBY?.waitTime) : null,
        is_open: status === 'OPERATING',
        status
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
        is_open: isOpen,
        status: isOpen ? 'OPERATING' : 'CLOSED'
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
  const errors = [];

  // Primary: TDR official realtime JSON (the only source that surfaces 一時運営中止)
  try {
    const attractions = await fetchTdrOfficial();
    if (attractions.length === 0) throw new Error('TDR official returned 0 attractions');
    return { source: 'tdr-official', attractions };
  } catch (error) {
    errors.push(`tdr-official: ${error?.message || error}`);
  }

  // Fallback: themeparks.wiki -> queue-times.com
  const attempts = [
    { source: 'themeparks', url: THEMEPARKS_URL, normalize: normalizeThemeParks },
    { source: 'queue-times', url: QUEUE_TIMES_URL, normalize: normalizeQueueTimes }
  ];

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
      .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    const daySnapshots = [];
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

  const index = {
    updated_at: now.toISOString(),
    snapshots
  };

  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  return { indexPath, count: snapshots.length };
}

function writeDailySeries(dateDir, date, daySnapshots) {
  const sorted = daySnapshots.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));

  const points = [];
  const attractions = new Map();
  let latestShows = [];

  for (const { time, snapshot } of sorted) {
    const ms = Date.parse(snapshot?.fetched_at);
    if (!Number.isFinite(ms)) {
      continue;
    }

    points.push({
      ms,
      time,
      fetched_at: snapshot.fetched_at,
      source: snapshot.source ?? null,
      summary: snapshot.summary ?? null
    });
    const pointIndex = points.length - 1;
    const snapshotShows = Array.isArray(snapshot?.shows?.items) ? snapshot.shows.items : [];
    if (snapshotShows.length > 0) {
      latestShows = snapshotShows;
    }

    const seenIds = new Set();
    const list = Array.isArray(snapshot.attractions) ? snapshot.attractions : [];
    for (const attr of list) {
      if (!attr || !attr.name_en) {
        continue;
      }
      const id = normalizeAttractionId(attr.name_en);
      if (seenIds.has(id)) {
        continue;
      }
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
      if (attr.name_ja) {
        entry.name_ja = attr.name_ja;
      }
      // Re-derive status/access_mode from official_status_cd/label so historical snapshots
      // taken before a code/label was recognized get fixed on each rebuild.
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

  const seriesPath = path.join(dateDir, 'series.json');
  writeFileSync(seriesPath, `${JSON.stringify(series, null, 2)}\n`, 'utf8');
}

try {
  const result = await collect();
  const closureInfo = await fetchTdlClosures();
  const showInfo = await fetchTdlShows();
  const now = new Date();
  if (closureInfo && closureInfo.closures) {
    for (const attraction of result.attractions) {
      const info = closureInfo.closures[attraction.id];
      if (info) {
        attraction.closure_info = info;
      }
    }
  }
  const payload = {
    fetched_at: now.toISOString(),
    source: result.source,
    attractions: result.attractions,
    summary: summarize(result.attractions),
    closures: closureInfo,
    shows: showInfo
  };
  const paths = writeSnapshot(payload, now);
  const index = writeSnapshotIndex(now);

  console.log(`source=${payload.source} count=${payload.summary.count} max_wait=${payload.summary.max_wait} closures=${closureInfo ? Object.keys(closureInfo.closures).length : 'n/a'} shows=${showInfo ? showInfo.items.length : 'n/a'}`);
  console.log(`saved ${paths.latestPath}`);
  console.log(`saved ${paths.historyPath}`);
  console.log(`saved ${index.indexPath} (${index.count} entries)`);
} catch (error) {
  console.error(`collect failed: ${error?.message || error}`);
  process.exit(1);
}
