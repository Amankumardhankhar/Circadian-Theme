import { getSeeds } from './seeds.js';
import { getSolarAnchors } from './solar.js';
import {
  deriveTokens,
  solveTextTokens,
  TOKEN_NAMES,
  type Token,
  type TokenName,
  type Tokens,
} from './tokens.js';

function wrapHue(h: number): number {
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Peak amplitude of the sky-breath bias (degrees). Modulates Hbrand around
// userHue as a sinusoid in (Hsky − HskyDailyMean): zero at the mean, peaks at
// ±90°, and ZERO at the antipode. Smooth (C^∞) everywhere and "no bias at
// antipode" is also more correct: warmer vs cooler is genuinely undefined
// when Hsky is opposite the daily mean.
const BREATH_AMPLITUDE = 25;

// Returns the background hue that the per-token blend produces. Exported as a
// pure unit-testable surface; the actual palette work happens per-token in
// getThemedTokens.
export function resolveHue(
  Hsky: number,
  HskyDailyMean: number,
  userHue: number | null | undefined,
  blend: number,
): number {
  if (userHue === null || userHue === undefined) return wrapHue(Hsky);
  const b = clamp(blend, 0, 1);
  if (b === 0) return wrapHue(Hsky);
  const uh = wrapHue(userHue);
  const phase = ((Hsky - HskyDailyMean) * Math.PI) / 180;
  const bias = BREATH_AMPLITUDE * Math.sin(phase);
  const Hbrand = wrapHue(uh + bias);
  // Unit-vector lerp of the two hue angles. Equivalent to the OKLab Cartesian
  // blend's H when C_sky == C_brand, which holds for every non-text token.
  const rA = (Hsky * Math.PI) / 180;
  const rB = (Hbrand * Math.PI) / 180;
  const x = Math.cos(rA) * (1 - b) + Math.cos(rB) * b;
  const y = Math.sin(rA) * (1 - b) + Math.sin(rB) * b;
  if (x === 0 && y === 0) return wrapHue(Hsky);
  return wrapHue((Math.atan2(y, x) * 180) / Math.PI);
}

// Circular mean of angles (degrees) → degrees in [0, 360).
function circularMean(hues: number[]): number {
  let sumS = 0;
  let sumC = 0;
  for (const h of hues) {
    const r = (h * Math.PI) / 180;
    sumS += Math.sin(r);
    sumC += Math.cos(r);
  }
  return wrapHue((Math.atan2(sumS, sumC) * 180) / Math.PI);
}

const meanCache = new Map<string, number>();

function meanCacheKey(ringStart: number, ringEnd: number, location?: { lat: number; lng: number }): string {
  return location
    ? `${ringStart}|${ringEnd}|${location.lat}|${location.lng}`
    : `${ringStart}|${ringEnd}|ist`;
}

function computeDailyMean(now: Date, location?: { lat: number; lng: number }): number {
  const ring = getSolarAnchors(now, location);
  const times = ring
    .map((a) => a.time.getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length < 2) {
    const fallbackStart = now.getTime() - 12 * 60 * 60 * 1000;
    const fallbackEnd = now.getTime() + 12 * 60 * 60 * 1000;
    const key = meanCacheKey(fallbackStart, fallbackEnd, location);
    const cached = meanCache.get(key);
    if (cached !== undefined) return cached;
    const samples: number[] = [];
    for (let t = fallbackStart; t < fallbackEnd; t += 60 * 1000) {
      samples.push(getSeeds(new Date(t), location).H);
    }
    const mean = circularMean(samples);
    meanCache.set(key, mean);
    return mean;
  }
  const start = times[0];
  const end = times[times.length - 1];
  const key = meanCacheKey(start, end, location);
  const cached = meanCache.get(key);
  if (cached !== undefined) return cached;

  const samples: number[] = [];
  for (let t = start; t < end; t += 60 * 1000) {
    samples.push(getSeeds(new Date(t), location).H);
  }
  const mean = circularMean(samples);
  meanCache.set(key, mean);
  return mean;
}

// OKLab-Cartesian per-token lerp. C and H come from the magnitude / angle of
// the blended (a, b): at antipodal token hues the two vectors cancel and
// C → 0 instead of the hue flipping. L is straight-averaged (invariant across
// modes for non-text tokens, so both sides match; the average is just
// completeness).
function blendInOklab(sky: Token, brand: Token, t: number): Token {
  const rSky = (sky.H * Math.PI) / 180;
  const rBrand = (brand.H * Math.PI) / 180;
  const aSky = sky.C * Math.cos(rSky);
  const bSky = sky.C * Math.sin(rSky);
  const aBrand = brand.C * Math.cos(rBrand);
  const bBrand = brand.C * Math.sin(rBrand);
  const L = sky.L * (1 - t) + brand.L * t;
  const a = aSky * (1 - t) + aBrand * t;
  const b = bSky * (1 - t) + bBrand * t;
  const C = Math.hypot(a, b);
  // C ≈ 0 → H is undefined; preserve sky.H for hue continuity at antipodal
  // crossings (token is grey there anyway, so H is cosmetic).
  const H = a === 0 && b === 0 ? wrapHue(sky.H) : wrapHue((Math.atan2(b, a) * 180) / Math.PI);
  const alpha = sky.alpha * (1 - t) + brand.alpha * t;
  return { L, C, H, alpha };
}

const TEXT_TOKEN_NAMES: ReadonlySet<TokenName> = new Set<TokenName>([
  'textPrimary',
  'textSecondary',
  'textMuted',
]);

export type ThemedTokensOptions = {
  userHue?: number | null;
  blend?: number;
};

// Per-token sky/brand blend.
//
// Interpolating hue ANGLES across Hsky↔Hbrand fails at the t=0.5 antipodal:
// both arcs are equal length, one must win, and the result is a ~0.34 ΔE
// one-minute flip on every Hbg-derived non-text token. Instead:
//   - Derive both full palettes (sky at Hsky; brand at Hbrand with sinusoidal
//     breath).
//   - Non-text tokens: blend in OKLab Cartesian — at antipodal hues the
//     chroma vector passes through C≈0 grey instead of flipping. L stays
//     byte-identical (same on both sides for non-text); C never exceeds the
//     seed-curve ceiling.
//   - Text tokens: re-solve against the BLENDED background. Averaging black
//     and white text gives unreadable grey, and solving against the actual
//     displayed bg also yields exactly two textMuted polarity steps per day.
export function getThemedTokens(
  now: Date,
  location?: { lat: number; lng: number },
  options?: ThemedTokensOptions,
): Tokens {
  const seeds = getSeeds(now, location);
  const userHue = options?.userHue ?? null;
  const blend = options?.blend ?? 0;

  // Sky mode: userHue absent → pass seeds straight through (blend irrelevant).
  if (userHue === null || userHue === undefined) {
    return deriveTokens(seeds);
  }

  const b = clamp(blend, 0, 1);

  // Edge short-circuits: skip double derivation + OKLab round-trip noise.
  if (b === 0) {
    return deriveTokens(seeds);
  }

  const HskyDailyMean = computeDailyMean(now, location);
  const phase = ((seeds.H - HskyDailyMean) * Math.PI) / 180;
  const bias = BREATH_AMPLITUDE * Math.sin(phase);
  const Hbrand = wrapHue(wrapHue(userHue) + bias);
  const brandSeeds = { L: seeds.L, C: seeds.C, H: Hbrand };

  if (b === 1) {
    return deriveTokens(brandSeeds);
  }

  // Intermediate blend: derive both palettes, lerp non-text in OKLab, solve
  // text against the blended background.
  const sky = deriveTokens(seeds);
  const brand = deriveTokens(brandSeeds);

  const blended: Partial<Record<TokenName, Token>> = {};
  for (const name of TOKEN_NAMES) {
    if (TEXT_TOKEN_NAMES.has(name)) continue;
    blended[name] = blendInOklab(sky[name], brand[name], b);
  }

  const blendedBg = blended.background!;
  const { textPrimary, textSecondary, textMuted, crossoverProximity } =
    solveTextTokens({ L: blendedBg.L, C: blendedBg.C, H: blendedBg.H });

  return {
    background: blended.background!,
    surface: blended.surface!,
    surfaceElevated: blended.surfaceElevated!,
    border: blended.border!,
    bgGradientStop: blended.bgGradientStop!,
    textPrimary,
    textSecondary,
    textMuted,
    accent: blended.accent!,
    accentHover: blended.accentHover!,
    accentSecondary: blended.accentSecondary!,
    shadow: blended.shadow!,
    glow: blended.glow!,
    ambientTint: blended.ambientTint!,
    success: blended.success!,
    warning: blended.warning!,
    error: blended.error!,
    info: blended.info!,
    meta: { crossoverProximity },
  };
}
