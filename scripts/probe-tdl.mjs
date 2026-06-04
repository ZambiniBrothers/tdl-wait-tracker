// Probe: dump raw TDR realtime JSON for analysis
const URL = 'https://www.tokyodisneyresort.jp/_/realtime/tdl_attraction.json';

const res = await fetch(URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; tdl-probe/1.0)',
    'Accept': 'application/json',
    'Accept-Language': 'ja',
    'Referer': 'https://www.tokyodisneyresort.jp/tdl/attraction.html'
  }
});
console.log(`HTTP ${res.status}`);
const text = await res.text();
console.log(`size=${text.length}`);
const data = JSON.parse(text);
console.log(`array length: ${data.length}`);

// Show all attractions with their key fields
console.log('\n=== ALL ATTRACTIONS ===');
for (const item of data) {
  const standby = item.StandbyTime;
  const cd = item.OperatingStatusCD;
  const label = item.OperatingStatus;
  const facStatus = item.FacilityStatusCD;
  const facLabel = item.FacilityStatus;
  console.log(`[${cd}|${label}] StandbyTime=${JSON.stringify(standby)} FacilityStatus=[${facStatus}|${facLabel}] ${item.FacilityName}`);
}

// Show Alice's raw entry
console.log('\n=== Alice raw ===');
const alice = data.find(d => /アリス/.test(d.FacilityName));
if (alice) console.log(JSON.stringify(alice, null, 2));
