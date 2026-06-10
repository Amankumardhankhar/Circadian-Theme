import { getSolarAnchors } from '../src/solar.js';

let failures = 0;
let passes = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  ok  - ${label}`);
  } else {
    failures++;
    console.log(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function fmtIST(d: Date): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  const ss = String(ist.getUTCSeconds()).padStart(2, '0');
  const Y = ist.getUTCFullYear();
  const M = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const D = String(ist.getUTCDate()).padStart(2, '0');
  return `${Y}-${M}-${D} ${hh}:${mm}:${ss} IST`;
}

const RING_NAMES = [
  'solarMidnight', 'dawn', 'sunrise', 'morning', 'solarNoon',
  'afternoon', 'goldenHour', 'sunset', 'dusk', 'night', 'solarMidnight',
];

// --- Test 1: Delhi 2024-06-21, published sunrise/sunset ---
console.log('\nTest 1: Delhi 2024-06-21 sunrise/sunset within 5 min of published');
{
  // Delhi: lat 28.6139, lng 77.2090
  // Published (timeanddate.com): sunrise 05:23 IST, sunset 19:21 IST
  const now = new Date('2024-06-21T06:00:00Z'); // 11:30 IST on 2024-06-21
  const anchors = getSolarAnchors(now, { lat: 28.6139, lng: 77.2090 });

  const sunrise = anchors.find((a, i) => a.name === 'sunrise' && i !== 0)!;
  const sunset = anchors.find((a) => a.name === 'sunset')!;

  const expectedSunrise = new Date(Date.UTC(2024, 5, 20, 23, 53)); // 05:23 IST on 21st = 23:53 UTC on 20th
  const expectedSunset = new Date(Date.UTC(2024, 5, 21, 13, 51));  // 19:21 IST = 13:51 UTC

  const sunriseDiffMin = Math.abs(sunrise.time.getTime() - expectedSunrise.getTime()) / 60000;
  const sunsetDiffMin = Math.abs(sunset.time.getTime() - expectedSunset.getTime()) / 60000;

  check(
    `sunrise within 5 min of published 05:23 IST (got ${fmtIST(sunrise.time)}, diff ${sunriseDiffMin.toFixed(2)} min)`,
    sunriseDiffMin <= 5,
  );
  check(
    `sunset within 5 min of published 19:21 IST (got ${fmtIST(sunset.time)}, diff ${sunsetDiffMin.toFixed(2)} min)`,
    sunsetDiffMin <= 5,
  );
}

// --- Test 2: IST fallback produces fixed anchors exactly ---
console.log('\nTest 2: IST fallback produces the fixed anchors exactly');
{
  // Use a `now` solidly inside an IST calendar day.
  // 2024-03-15T07:00:00Z -> 12:30 IST on 2024-03-15
  const now = new Date('2024-03-15T07:00:00Z');
  const anchors = getSolarAnchors(now);

  const expected: Array<[string, number, number]> = [
    ['solarMidnight', 0, 0],
    ['dawn', 5, 30],
    ['sunrise', 6, 0],
    ['morning', 8, 30],
    ['solarNoon', 12, 0],
    ['afternoon', 15, 0],
    ['goldenHour', 18, 0],
    ['sunset', 18, 45],
    ['dusk', 19, 15],
    ['night', 21, 0],
  ];

  check(`anchor count is 11 (10 + wrap)`, anchors.length === 11, `got ${anchors.length}`);

  for (let i = 0; i < expected.length; i++) {
    const [name, hh, mm] = expected[i];
    // Expected UTC: hh:mm IST on 2024-03-15 = (hh-5):(mm-30) UTC on 2024-03-15
    const expectedUtc = new Date(Date.UTC(2024, 2, 15, hh - 5, mm - 30));
    const got = anchors[i];
    check(
      `anchor[${i}] = ${name} @ ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} IST`,
      got.name === name && got.time.getTime() === expectedUtc.getTime(),
      `name=${got.name} time=${fmtIST(got.time)} expected=${fmtIST(expectedUtc)}`,
    );
  }

  const wrap = anchors[10];
  const expectedWrap = new Date(Date.UTC(2024, 2, 16, -5, -30)); // 00:00 IST on 2024-03-16
  check(
    `wrap anchor = solarMidnight @ 00:00 IST on next day`,
    wrap.name === 'solarMidnight' && wrap.time.getTime() === expectedWrap.getTime(),
    `name=${wrap.name} time=${fmtIST(wrap.time)} expected=${fmtIST(expectedWrap)}`,
  );
}

// --- Test 3: ring is strictly time-ordered, named correctly, spans ~24h ---
console.log('\nTest 3: ring is strictly ordered, complete, and spans ~24h (both modes)');
{
  const cases: Array<{ label: string; now: Date; location?: { lat: number; lng: number } }> = [
    { label: 'Delhi 2024-06-21 (solstice)', now: new Date('2024-06-21T06:00:00Z'), location: { lat: 28.6139, lng: 77.2090 } },
    { label: 'Delhi 2024-12-21 (winter solstice)', now: new Date('2024-12-21T06:00:00Z'), location: { lat: 28.6139, lng: 77.2090 } },
    { label: 'IST fallback (no location)', now: new Date('2024-03-15T07:00:00Z') },
    { label: 'IST fallback near boundary', now: new Date('2024-03-15T18:35:00Z') }, // 00:05 IST on 2024-03-16
  ];

  for (const c of cases) {
    const anchors = getSolarAnchors(c.now, c.location);

    check(
      `[${c.label}] length is 11`,
      anchors.length === 11,
      `got ${anchors.length}`,
    );

    let namesOk = true;
    for (let i = 0; i < RING_NAMES.length; i++) {
      if (anchors[i]?.name !== RING_NAMES[i]) {
        namesOk = false;
        break;
      }
    }
    check(`[${c.label}] names in expected order`, namesOk);

    let ordered = true;
    let badIdx = -1;
    for (let i = 1; i < anchors.length; i++) {
      if (!(anchors[i].time.getTime() > anchors[i - 1].time.getTime())) {
        ordered = false;
        badIdx = i;
        break;
      }
    }
    check(
      `[${c.label}] strictly ascending by time`,
      ordered,
      badIdx >= 0
        ? `bad at index ${badIdx}: ${anchors[badIdx - 1].name}=${fmtIST(anchors[badIdx - 1].time)} -> ${anchors[badIdx].name}=${fmtIST(anchors[badIdx].time)}`
        : undefined,
    );

    const spanMs = anchors[anchors.length - 1].time.getTime() - anchors[0].time.getTime();
    const spanHours = spanMs / (60 * 60 * 1000);
    check(
      `[${c.label}] span ~24h (got ${spanHours.toFixed(3)} h)`,
      spanHours >= 23.5 && spanHours <= 24.5,
    );

    check(
      `[${c.label}] now is bracketed by some pair of anchors`,
      c.now.getTime() >= anchors[0].time.getTime() &&
        c.now.getTime() <= anchors[anchors.length - 1].time.getTime(),
      `now=${fmtIST(c.now)} ring=${fmtIST(anchors[0].time)} .. ${fmtIST(anchors[anchors.length - 1].time)}`,
    );
  }
}

// --- Summary ---
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
