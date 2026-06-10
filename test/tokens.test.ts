import { wcagContrast } from 'culori';
import { deriveTokens, getTokens, TOKEN_NAMES, type Tokens } from '../src/tokens.js';
import type { Seeds } from '../src/seeds.js';

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

function approxEq(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function hDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

function wrap360(h: number): number {
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

const SEEDS: Record<string, Seeds> = {
  noon:      { L: 0.97, H: 210, C: 0.03 }, // solarNoon table value
  midnight:  { L: 0.13, H: 265, C: 0.02 }, // solarMidnight table value
  crossover: { L: 0.50, H: 180, C: 0.05 }, // forced mid-grey
};

function assertWellFormed(label: string, tokens: Tokens) {
  for (const name of TOKEN_NAMES) {
    const t = tokens[name];
    const ok =
      Number.isFinite(t.L) && Number.isFinite(t.C) && Number.isFinite(t.H) && Number.isFinite(t.alpha) &&
      t.L >= 0 && t.L <= 1 &&
      t.C >= 0 &&
      t.H >= 0 && t.H < 360 &&
      t.alpha >= 0 && t.alpha <= 1;
    check(
      `[${label}] ${name} well-formed (L=${t.L.toFixed(4)} C=${t.C.toFixed(4)} H=${t.H.toFixed(2)} α=${t.alpha.toFixed(2)})`,
      ok,
    );
  }
}

// Mirrors src/tokens.ts smoothPolarity(): the smooth signed ramp that
// replaced the hard polarity step. Identical formula; duplicated here so the
// test asserts against the same math the implementation uses.
function expectedSmoothPolarity(Lbg: number): { dir: number; s: number } {
  const t = Math.min(1, Math.max(0, (Lbg - 0.35) / 0.30));
  const s = t * t * (3 - 2 * t);
  return { dir: 1 - 2 * s, s };
}

// Compute expected text polarity the same way src/tokens.ts does: pick the
// extreme whose contrast against the actual bg is higher. The polarity
// threshold has moved from Lbg=0.5 (perceptual midpoint, asymmetric) to the
// luminance-balanced bg (where the two extremes give equal contrast).
function expectedLightText(seeds: Seeds): boolean {
  const Hbg = wrap360(seeds.H);
  const bg = { mode: 'oklch' as const, l: seeds.L, c: seeds.C, h: Hbg };
  const cDark = wcagContrast({ mode: 'oklch', l: 0.05, c: 0.015, h: Hbg }, bg);
  const cLight = wcagContrast({ mode: 'oklch', l: 0.99, c: 0.015, h: Hbg }, bg);
  return cLight > cDark;
}

function assertStructure(label: string, seeds: Seeds, tokens: Tokens) {
  const lightText = expectedLightText(seeds);
  const { dir, s } = expectedSmoothPolarity(seeds.L);
  const Hbg = wrap360(seeds.H);

  // Backgrounds / surfaces
  check(`[${label}] background L = Lbg`, approxEq(tokens.background.L, seeds.L));
  check(`[${label}] background C = Cbg`, approxEq(tokens.background.C, seeds.C));
  check(`[${label}] background H = Hbg`, approxEq(tokens.background.H, Hbg));

  check(`[${label}] surface L = Lbg + dir*0.04`, approxEq(tokens.surface.L, seeds.L + dir * 0.04));
  check(`[${label}] surface C = Cbg*1.1`, approxEq(tokens.surface.C, seeds.C * 1.1));
  check(`[${label}] surface H = Hbg`, approxEq(tokens.surface.H, Hbg));

  check(`[${label}] surfaceElevated L = Lbg + dir*0.08`, approxEq(tokens.surfaceElevated.L, seeds.L + dir * 0.08));
  check(`[${label}] border L = Lbg + dir*0.14`, approxEq(tokens.border.L, seeds.L + dir * 0.14));
  check(`[${label}] border C = Cbg*0.8`, approxEq(tokens.border.C, seeds.C * 0.8));
  check(`[${label}] bgGradientStop L = Lbg + dir*0.02`, approxEq(tokens.bgGradientStop.L, seeds.L + dir * 0.02));
  check(`[${label}] bgGradientStop H = Hbg + 15`, hDelta(tokens.bgGradientStop.H, Hbg + 15) < 1e-9);

  // Accent family — L ramps smoothly between dark anchor 0.72 and light anchor 0.55.
  const expectedAccentL = 0.72 - 0.17 * s;
  check(`[${label}] accent L = 0.72 - 0.17*s = ${expectedAccentL.toFixed(4)}`, approxEq(tokens.accent.L, expectedAccentL));
  check(`[${label}] accent C = 0.15`, approxEq(tokens.accent.C, 0.15));
  check(`[${label}] accent H = Hbg + 150`, hDelta(tokens.accent.H, Hbg + 150) < 1e-9);
  check(`[${label}] accentHover L = accent.L + dir*0.06`, approxEq(tokens.accentHover.L, expectedAccentL + dir * 0.06));
  check(`[${label}] accentHover C = accent.C + 0.02`, approxEq(tokens.accentHover.C, 0.15 + 0.02));
  check(`[${label}] accentSecondary H = Hbg + 190`, hDelta(tokens.accentSecondary.H, Hbg + 190) < 1e-9);

  // Depth
  check(`[${label}] shadow L = max(Lbg-0.6, 0.05)`, approxEq(tokens.shadow.L, Math.max(seeds.L - 0.6, 0.05)));
  check(`[${label}] shadow C = Cbg*1.5`, approxEq(tokens.shadow.C, seeds.C * 1.5));
  check(`[${label}] shadow alpha = 0.35`, approxEq(tokens.shadow.alpha, 0.35));
  check(`[${label}] glow L = 0.85`, approxEq(tokens.glow.L, 0.85));
  check(`[${label}] glow H = Hbg + 150`, hDelta(tokens.glow.H, Hbg + 150) < 1e-9);
  check(`[${label}] glow alpha = 0.20`, approxEq(tokens.glow.alpha, 0.20));
  check(`[${label}] ambientTint L = Lbg`, approxEq(tokens.ambientTint.L, seeds.L));
  check(`[${label}] ambientTint C = Cbg*0.5`, approxEq(tokens.ambientTint.C, seeds.C * 0.5));

  // Semantic identity preserved (within the 10% nudge tolerance toward Hbg)
  for (const [name, identity] of [
    ['success', 145], ['warning', 75], ['error', 25], ['info', 240],
  ] as const) {
    const t = tokens[name];
    // hue should be at most 10% of the angular distance from identity toward Hbg, plus rounding
    const idToHbg = hDelta(Hbg, identity); // max possible distance
    const tokToId = hDelta(t.H, identity);
    check(
      `[${label}] ${name} hue ≤ 10% of identity→Hbg shift (id ${identity}° → got ${t.H.toFixed(2)}°, shift ${tokToId.toFixed(2)}° vs cap ${(idToHbg * 0.1).toFixed(2)}°)`,
      tokToId <= idToHbg * 0.1 + 1e-6,
    );
  }

  // Text hue should follow Hbg, chroma 0.015
  check(`[${label}] textPrimary H = Hbg`, approxEq(tokens.textPrimary.H, Hbg));
  check(`[${label}] textPrimary C = 0.015`, approxEq(tokens.textPrimary.C, 0.015));
  check(`[${label}] textSecondary C = 0.015`, approxEq(tokens.textSecondary.C, 0.015));
  // Direction sanity: text L sits on whichever side gives higher contrast
  // against the actual bg (the contrast-balanced polarity choice).
  if (lightText) {
    check(`[${label}] textPrimary L > Lbg (light text — higher cLight vs bg)`, tokens.textPrimary.L > seeds.L);
  } else {
    check(`[${label}] textPrimary L < Lbg (dark text — higher cDark vs bg)`, tokens.textPrimary.L < seeds.L);
  }
}

// --- Test 1: every seed produces a well-formed, structurally correct token set ---
console.log('\nTest 1: well-formed tokens + structural relationships');
for (const [label, seeds] of Object.entries(SEEDS)) {
  const tokens = deriveTokens(seeds);
  assertWellFormed(label, tokens);
  assertStructure(label, seeds, tokens);
}

// --- Test 2: contrast targets ---
console.log('\nTest 2: contrast targets — 7:1 reachable at noon/midnight, NOT at crossover');

function reportContrast(label: string, tokens: Tokens, seeds: Seeds) {
  // Sanity: cross-check the reported `contrast` field against a fresh culori call.
  const bg = { mode: 'oklch' as const, l: seeds.L, c: seeds.C, h: seeds.H };
  const primary = { mode: 'oklch' as const, l: tokens.textPrimary.L, c: tokens.textPrimary.C, h: tokens.textPrimary.H };
  const independentPrimary = wcagContrast(primary, bg);
  const secondary = { mode: 'oklch' as const, l: tokens.textSecondary.L, c: tokens.textSecondary.C, h: tokens.textSecondary.H };
  const independentSecondary = wcagContrast(secondary, bg);
  return { independentPrimary, independentSecondary };
}

{
  const noonTokens = deriveTokens(SEEDS.noon);
  const noonCheck = reportContrast('noon', noonTokens, SEEDS.noon);
  console.log(`    noon textPrimary contrast: reported=${noonTokens.textPrimary.contrast?.toFixed(3)}, independent=${noonCheck.independentPrimary.toFixed(3)}`);
  check(
    `noon textPrimary records contrast`,
    typeof noonTokens.textPrimary.contrast === 'number',
  );
  check(
    `noon textPrimary achieves ≥ 7:1`,
    (noonTokens.textPrimary.contrast ?? 0) >= 7,
    `got ${noonTokens.textPrimary.contrast?.toFixed(3)}`,
  );
  check(
    `noon textPrimary contrast field matches an independent culori call`,
    Math.abs((noonTokens.textPrimary.contrast ?? -1) - noonCheck.independentPrimary) < 1e-9,
  );
  check(
    `noon textSecondary achieves ≥ 4.5:1`,
    (noonTokens.textSecondary.contrast ?? 0) >= 4.5,
    `got ${noonTokens.textSecondary.contrast?.toFixed(3)}`,
  );
}

{
  const midTokens = deriveTokens(SEEDS.midnight);
  const midCheck = reportContrast('midnight', midTokens, SEEDS.midnight);
  console.log(`    midnight textPrimary contrast: reported=${midTokens.textPrimary.contrast?.toFixed(3)}, independent=${midCheck.independentPrimary.toFixed(3)}`);
  check(
    `midnight textPrimary records contrast`,
    typeof midTokens.textPrimary.contrast === 'number',
  );
  check(
    `midnight textPrimary achieves ≥ 7:1`,
    (midTokens.textPrimary.contrast ?? 0) >= 7,
    `got ${midTokens.textPrimary.contrast?.toFixed(3)}`,
  );
  check(
    `midnight textSecondary achieves ≥ 4.5:1`,
    (midTokens.textSecondary.contrast ?? 0) >= 4.5,
    `got ${midTokens.textSecondary.contrast?.toFixed(3)}`,
  );
}

// Crossover — the spec-prescribed reveal: this MUST be below 7:1 and reported honestly.
{
  const crossTokens = deriveTokens(SEEDS.crossover);
  const crossCheck = reportContrast('crossover', crossTokens, SEEDS.crossover);
  const achievedPrimary = crossTokens.textPrimary.contrast ?? -1;
  const achievedSecondary = crossTokens.textSecondary.contrast ?? -1;
  console.log(`    crossover (Lbg=0.50) textPrimary L=${crossTokens.textPrimary.L.toFixed(4)} contrast=${achievedPrimary.toFixed(3)}`);
  console.log(`    crossover (Lbg=0.50) textSecondary L=${crossTokens.textSecondary.L.toFixed(4)} contrast=${achievedSecondary.toFixed(3)}`);
  check(
    `crossover textPrimary records achieved contrast`,
    typeof crossTokens.textPrimary.contrast === 'number',
  );
  check(
    `crossover textPrimary achieved < 7 (proving honest reporting, not clamped)`,
    achievedPrimary < 7,
    `got ${achievedPrimary.toFixed(3)}`,
  );
  check(
    `crossover reported field matches independent culori call`,
    Math.abs(achievedPrimary - crossCheck.independentPrimary) < 1e-9,
  );
  // Best achievable: text L is pinned at whichever extreme gives higher
  // contrast against the bg. At Lbg=0.5 the perceptual midpoint maps to
  // sRGB Y≈0.124, so contrast(L=0.99, bg) > contrast(L=0.05, bg) — light
  // text wins. Verify by probing both extremes and asserting the chosen one
  // matches the achieved contrast.
  const bg = { mode: 'oklch' as const, l: SEEDS.crossover.L, c: SEEDS.crossover.C, h: SEEDS.crossover.H };
  const cDark = wcagContrast({ mode: 'oklch' as const, l: 0.05, c: crossTokens.textPrimary.C, h: crossTokens.textPrimary.H }, bg);
  const cLight = wcagContrast({ mode: 'oklch' as const, l: 0.99, c: crossTokens.textPrimary.C, h: crossTokens.textPrimary.H }, bg);
  const probeL = cLight > cDark ? 0.99 : 0.05;
  const probeContrast = cLight > cDark ? cLight : cDark;
  check(
    `crossover textPrimary is at the higher-contrast extreme L=${probeL} (cDark=${cDark.toFixed(3)}, cLight=${cLight.toFixed(3)})`,
    Math.abs(crossTokens.textPrimary.L - probeL) < 1e-9,
    `got L=${crossTokens.textPrimary.L}`,
  );
  check(
    `no better L exists (extreme L=${probeL} gives ${probeContrast.toFixed(3)}, achieved ${achievedPrimary.toFixed(3)})`,
    Math.abs(probeContrast - achievedPrimary) < 1e-9,
  );
}

// --- Test 3: getTokens composes seeds + derivation ---
console.log('\nTest 3: getTokens(now, location?) wires through getSeeds');
{
  const now = new Date('2024-06-21T06:00:00Z');
  const t1 = getTokens(now, { lat: 28.6139, lng: 77.2090 });
  const t2 = getTokens(now);
  check(
    `getTokens with Delhi location produces well-formed background`,
    Number.isFinite(t1.background.L) && t1.background.L > 0 && t1.background.L < 1,
  );
  check(
    `getTokens with IST fallback produces well-formed background`,
    Number.isFinite(t2.background.L) && t2.background.L > 0 && t2.background.L < 1,
  );
  // textPrimary contrast field should be present (text is contrast-driven)
  check(`getTokens Delhi textPrimary has contrast field`, typeof t1.textPrimary.contrast === 'number');
  check(`getTokens IST textPrimary has contrast field`, typeof t2.textPrimary.contrast === 'number');
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
