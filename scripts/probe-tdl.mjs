// One-off probe: fetch tdl/attraction.html and dump structure around '一時運営中止' badges
const URL = 'https://www.tokyodisneyresort.jp/tdl/attraction.html';
const TIMEOUT_MS = 15_000;

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker-probe/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5'
      }
    });
    console.log(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    console.log(`size=${html.length} chars`);

    // 1) Does the page contain the phrase?
    const phrase = '一時運営中止';
    const idx = html.indexOf(phrase);
    console.log(`contains '${phrase}': ${idx >= 0} (first idx=${idx})`);

    // 2) Look around every occurrence
    let p = 0;
    let hits = 0;
    while (p < html.length) {
      const i = html.indexOf(phrase, p);
      if (i < 0) break;
      hits += 1;
      const slice = html.slice(Math.max(0, i - 600), i + 200);
      console.log(`\n--- hit #${hits} @ ${i} ---`);
      console.log(slice);
      p = i + phrase.length;
      if (hits >= 5) break;
    }
    console.log(`\nTotal hits: ${hits}`);

    // 3) Also check related phrases
    for (const alt of ['運営中止', '休止', 'closed', 'down', 'standby', 'wait']) {
      const c = (html.match(new RegExp(alt, 'gi')) || []).length;
      console.log(`occurrences of '${alt}': ${c}`);
    }

    // 4) Find any JSON-like embedded data
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
    console.log(`\n<script> blocks: ${scriptMatch.length}`);
    const jsonish = scriptMatch.filter((s) => /attraction|status|operation/i.test(s)).slice(0, 3);
    jsonish.forEach((s, i) => {
      console.log(`\n--- script block ${i+1} (truncated 800ch) ---`);
      console.log(s.slice(0, 800));
    });
  } catch (e) {
    console.error('probe failed:', e?.message || e);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();
