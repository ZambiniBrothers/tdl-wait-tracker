// Probe: fetch /_/realtime/tdl_attraction.json and dump structure
const URL = 'https://www.tokyodisneyresort.jp/_/realtime/tdl_attraction.json';
const TIMEOUT_MS = 15_000;

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tdl-wait-tracker-probe/1.0)',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'ja,en;q=0.5',
        'Referer': 'https://www.tokyodisneyresort.jp/tdl/attraction.html'
      }
    });
    console.log(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(`size=${text.length} chars`);
    console.log(`first 200 chars: ${text.slice(0, 200)}`);

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log('JSON parse failed:', e.message);
      console.log('Saved as raw');
      return;
    }

    console.log(`\ntop-level type: ${Array.isArray(data) ? 'array' : typeof data}`);
    if (Array.isArray(data)) {
      console.log(`array length: ${data.length}`);
      console.log(`first entry keys: ${data[0] ? Object.keys(data[0]).join(', ') : '(none)'}`);
      console.log(`first 3 entries:`);
      for (const item of data.slice(0, 3)) {
        console.log(JSON.stringify(item, null, 2));
      }
      // Look for any status code 004 / 一時運営中止
      const halted = data.filter((item) => {
        const s = String(item.OperatingStatusCD || item.FacilityStatusCD || item.status || '');
        return ['004', '031', '032', '033'].includes(s);
      });
      console.log(`\nattractions with status 004/031/032/033 (一時運営中止): ${halted.length}`);
      halted.slice(0, 5).forEach((item) => console.log(JSON.stringify(item, null, 2)));
      // Status code distribution
      const dist = {};
      for (const item of data) {
        const s = String(item.OperatingStatusCD || '');
        dist[s] = (dist[s] || 0) + 1;
      }
      console.log(`\nOperatingStatusCD distribution: ${JSON.stringify(dist)}`);
    } else if (typeof data === 'object' && data) {
      console.log(`top-level keys: ${Object.keys(data).join(', ')}`);
      console.log(JSON.stringify(data, null, 2).slice(0, 3000));
    }
  } catch (e) {
    console.error('probe failed:', e?.message || e);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();
