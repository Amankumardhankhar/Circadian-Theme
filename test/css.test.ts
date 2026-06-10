import { clampChroma, converter, parse, wcagContrast } from 'culori';
import { deriveTokens } from '../src/tokens.js';
import { toCss, tokensToCss } from '../src/css.js';
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

const toOklch = converter('oklch');
const toRgb = converter('rgb');

function hexToRgbChannels(hex: string) {
  const c = parse(hex);
  if (!c) return null;
  return toRgb(c);
}

// --- Test 1: round-trip a known in-gamut OKLCH ---
console.log('\nTest 1: round-trip in-gamut OKLCH preserves L and H within tolerance');
{
  const input = { L: 0.97, C: 0.03, H: 210, alpha: 1 };
  const css = toCss(input);
  check(`oklch string format`, css.oklch === 'oklch(0.97 0.03 210)', `got "${css.oklch}"`);
  check(`fallback is a hex (#xxxxxx)`, /^#[0-9a-f]{6}$/i.test(css.fallback), `got "${css.fallback}"`);

  const parsed = parse(css.fallback);
  check(`fallback parses as a color`, !!parsed);

  const reOklch = toOklch(parsed!);
  // 8-bit hex round-trip introduces tiny error in L/H; tolerance ~0.01 / ~1°
  check(
    `round-trip L within 0.01 (input 0.97, got ${reOklch.l?.toFixed(4)})`,
    Math.abs((reOklch.l ?? 0) - input.L) < 0.01,
  );
  // Hue precision degrades through 8-bit sRGB as chroma → 0 (hue is the angle
  // of a tiny vector, and the channel quantum is large relative to it).
  // 5° tolerance for C=0.03 — full-saturation samples are far tighter.
  if (reOklch.h !== undefined) {
    let dH = Math.abs(reOklch.h - input.H);
    if (dH > 180) dH = 360 - dH;
    check(`round-trip H within 5° (input 210, got ${reOklch.h.toFixed(4)})`, dH < 5);
  } else {
    check(`round-trip H undefined (near-greyscale) — accepted`, true);
  }
}

// --- Test 2: out-of-gamut gets gamut-mapped (L,H preserved, C reduced) ---
console.log('\nTest 2: out-of-gamut OKLCH is clamped — L,H preserved, C reduced');
{
  // 0.55/0.30 at H=30 is far outside sRGB — accent-style red-orange
  const input = { L: 0.55, C: 0.30, H: 30, alpha: 1 };
  const clampedDirect = clampChroma({ mode: 'oklch', l: input.L, c: input.C, h: input.H }, 'oklch');
  check(`clampChroma preserves L exactly`, Math.abs((clampedDirect.l ?? -1) - input.L) < 1e-12,
    `got ${clampedDirect.l}`);
  check(`clampChroma preserves H exactly`, Math.abs((clampedDirect.h ?? -1) - input.H) < 1e-12,
    `got ${clampedDirect.h}`);
  check(`clampChroma reduces C (${input.C} → ${(clampedDirect.c ?? 0).toFixed(5)})`,
    (clampedDirect.c ?? 99) < input.C);

  const css = toCss(input);
  const rgb = hexToRgbChannels(css.fallback);
  check(`fallback parses`, !!rgb);
  check(
    `fallback sRGB channels in [0,1] (r=${rgb!.r?.toFixed(3)} g=${rgb!.g?.toFixed(3)} b=${rgb!.b?.toFixed(3)})`,
    !!rgb && rgb.r! >= 0 && rgb.r! <= 1 && rgb.g! >= 0 && rgb.g! <= 1 && rgb.b! >= 0 && rgb.b! <= 1,
  );

  // The OKLCH string itself reflects the unclamped values (browsers handle clamp).
  check(
    `oklch string keeps original C (browsers clamp; fallback is for old browsers)`,
    css.oklch === 'oklch(0.55 0.3 30)',
    `got "${css.oklch}"`,
  );
}

// --- Test 3: alpha < 1 produces `/ a` in oklch and rgba(...) fallback ---
console.log('\nTest 3: alpha < 1 — oklch `/ a` and rgba(...,a) fallback');
{
  const shadow = { L: 0.37, C: 0.045, H: 210, alpha: 0.35 };
  const cssShadow = toCss(shadow);
  check(
    `shadow oklch has "/ 0.35"`,
    cssShadow.oklch === 'oklch(0.37 0.045 210 / 0.35)',
    `got "${cssShadow.oklch}"`,
  );
  check(
    `shadow fallback is rgba(...,0.35)`,
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.35\s*\)$/.test(cssShadow.fallback),
    `got "${cssShadow.fallback}"`,
  );

  const glow = { L: 0.85, C: 0.12, H: 0, alpha: 0.20 };
  const cssGlow = toCss(glow);
  check(
    `glow oklch has "/ 0.2"`,
    cssGlow.oklch === 'oklch(0.85 0.12 0 / 0.2)',
    `got "${cssGlow.oklch}"`,
  );
  check(
    `glow fallback is rgba(...,0.2)`,
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.2\s*\)$/.test(cssGlow.fallback),
    `got "${cssGlow.fallback}"`,
  );
}

// --- Test 4: full token set for three seeds is valid end-to-end ---
console.log('\nTest 4: full token set — every entry is a valid CSS pair, in-gamut fallback');
{
  const SEEDS: Record<string, Seeds> = {
    noon:      { L: 0.97, H: 210, C: 0.03 },
    midnight:  { L: 0.13, H: 265, C: 0.02 },
    crossover: { L: 0.50, H: 180, C: 0.05 },
  };

  for (const [label, seeds] of Object.entries(SEEDS)) {
    const tokens = deriveTokens(seeds);
    const css = tokensToCss(tokens);
    for (const name of Object.keys(css) as Array<keyof typeof css>) {
      const { oklch, fallback } = css[name];
      const ok =
        typeof oklch === 'string' && oklch.length > 0 && !oklch.includes('NaN') &&
        typeof fallback === 'string' && fallback.length > 0 && !fallback.includes('NaN');
      check(`[${label}] ${String(name)} CSS pair non-empty + no NaN`, ok,
        `oklch="${oklch}" fallback="${fallback}"`);

      // Validate the fallback parses + is in-gamut.
      const isHex = fallback.startsWith('#');
      const rgb = hexToRgbChannels(isHex ? fallback : fallback);
      const inGamut =
        !!rgb &&
        rgb.r! >= -1e-6 && rgb.r! <= 1 + 1e-6 &&
        rgb.g! >= -1e-6 && rgb.g! <= 1 + 1e-6 &&
        rgb.b! >= -1e-6 && rgb.b! <= 1 + 1e-6;
      check(`[${label}] ${String(name)} fallback in-gamut`, inGamut,
        `fallback="${fallback}" rgb=${JSON.stringify(rgb)}`);
    }
  }
}

// --- Test 5: contrast survives the conversion pipeline ---
console.log('\nTest 5: contrast survival — sRGB fallback contrast matches recorded OKLCH value');
{
  const SEEDS: Record<string, Seeds> = {
    noon:     { L: 0.97, H: 210, C: 0.03 },
    midnight: { L: 0.13, H: 265, C: 0.02 },
  };
  for (const [label, seeds] of Object.entries(SEEDS)) {
    const tokens = deriveTokens(seeds);
    const css = tokensToCss(tokens);
    const recorded = tokens.textPrimary.contrast!;
    // The fallbacks for textPrimary and background are hex strings (alpha=1).
    const measured = wcagContrast(css.textPrimary.fallback, css.background.fallback);
    console.log(`    ${label}: OKLCH recorded ${recorded.toFixed(4)} / sRGB fallback measured ${measured.toFixed(4)} (Δ ${Math.abs(measured - recorded).toFixed(4)})`);
    check(
      `[${label}] textPrimary vs background contrast survives to within 0.05`,
      Math.abs(measured - recorded) < 0.05,
      `recorded=${recorded} measured=${measured}`,
    );
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
