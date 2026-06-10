import { wcagContrast } from 'culori';
import { getSeeds, type Seeds } from './seeds.js';

export const TOKEN_NAMES = [
  'background',
  'surface',
  'surfaceElevated',
  'border',
  'bgGradientStop',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accent',
  'accentHover',
  'accentSecondary',
  'shadow',
  'glow',
  'ambientTint',
  'success',
  'warning',
  'error',
  'info',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

export type Token = {
  L: number;
  C: number;
  H: number;
  alpha: number;
  // Achieved WCAG contrast vs. background. Set only on contrast-driven text
  // tokens (textPrimary/textSecondary) so the validation sweep can report
  // minutes where the crossover makes 7:1 / 4.5:1 impossible.
  contrast?: number;
};

export type TokensMeta = {
  // 0 when text comfortably meets its contrast target; ramps to 1 at the
  // luminance-balanced bg where polarity flips. Emitted only — the
  // application layer renders a scrim from it.
  crossoverProximity: number;
};

export type Tokens = Record<TokenName, Token> & { meta: TokensMeta };

type Polarity = 'dark' | 'light';

const TEXT_CHROMA = 0.015;
const ACCENT_C = 0.15;
const SHADOW_ALPHA = 0.35;
const GLOW_ALPHA = 0.20;
const PRIMARY_TARGET = 7;
const SECONDARY_TARGET = 4.5;
const MUTED_MIX = 0.6;
const SEMANTIC_C = 0.13;
const SEMANTIC_HUE_HARMONY = 0.10;

const SEMANTIC_HUES: Record<'success' | 'warning' | 'error' | 'info', number> = {
  success: 145,
  warning: 75,
  error: 25,
  info: 240,
};

function wrapH(h: number): number {
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

// Vector-space angle lerp via cos/sin + atan2 — continuous across `a`'s
// antipodal. Shortest-arc lerp flips sign at the antipodal and steps the hue
// by ~2π·t in one minute (a discontinuity on semantic tokens). With vector
// lerp, vectors near antipodal cancel, so the nudge magnitude shrinks to zero
// and the hue smoothly returns to `a` — no flip.
function angleLerp(a: number, b: number, t: number): number {
  const rA = (a * Math.PI) / 180;
  const rB = (b * Math.PI) / 180;
  const x = Math.cos(rA) * (1 - t) + Math.cos(rB) * t;
  const y = Math.sin(rA) * (1 - t) + Math.sin(rB) * t;
  if (x === 0 && y === 0) return wrapH(a);
  return wrapH((Math.atan2(y, x) * 180) / Math.PI);
}

// Smooth signed polarity ramp for non-text tokens. Replaces the hard
// `dir = Lbg<0.5 ? +1 : -1` step: dir = +1 at Lbg ≤ 0.20, 0 at Lbg = 0.50,
// -1 at Lbg ≥ 0.80. The smoothstep s ∈ [0,1] is also returned so accent and
// semantic L can interpolate between dark-mode and light-mode anchors over
// the same band.
//
// Band width W = 0.60 is gated by the non-text smoothness target
// (ΔE ≤ 0.02 per minute): accentHover ΔE goes as 0.435/W · dLbg/dt, so W must
// scale with peak dLbg/dt around the polarity midpoint. Surfaces/borders
// /accent still collapse toward background near Lbg=0.5 (the cosmetic trade
// for continuity), but spread over a wider Lbg range so the per-minute
// movement stays gentle.
function smoothPolarity(Lbg: number): { dir: number; s: number } {
  const t = Math.min(1, Math.max(0, (Lbg - 0.20) / 0.60));
  const s = t * t * (3 - 2 * t);
  return { dir: 1 - 2 * s, s };
}

function oklch(L: number, C: number, H: number) {
  return { mode: 'oklch' as const, l: L, c: C, h: wrapH(H) };
}

function contrast(text: { L: number; C: number; H: number }, bg: { L: number; C: number; H: number }): number {
  return wcagContrast(oklch(text.L, text.C, text.H), oklch(bg.L, bg.C, bg.H));
}

// Binary-search the "comfort" text L: the largest L on the polarity side that
// still achieves `target` against bg. Used as one endpoint of solveTextL's
// blend; on its own it's not continuous across the achievability boundary.
function searchComfortL(
  bg: { L: number; C: number; H: number },
  C: number,
  H: number,
  target: number,
  polarity: Polarity,
): number {
  let lo: number, hi: number;
  if (polarity === 'light') {
    lo = 0.05;
    hi = bg.L;
  } else {
    lo = bg.L;
    hi = 0.99;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const c = contrast({ L: mid, C, H }, bg);
    if (polarity === 'light') {
      // contrast monotonically increases as L decreases; want largest L meeting target
      if (c >= target) lo = mid;
      else hi = mid;
    } else {
      // contrast monotonically increases as L increases; want smallest L meeting target
      if (c >= target) hi = mid;
      else lo = mid;
    }
  }
  return polarity === 'light' ? lo : hi;
}

// Headroom band over which the "comfort" L is smoothly blended toward the
// extreme. Inside this band, comfortL would otherwise drop fast (steep slope
// near the achievability boundary) and the per-minute Lbg movement could
// cross most of the transition in one sample — producing a small but visible
// L step. Both endpoints satisfy contrast ≥ target on the reachable side,
// so blending is safe; the achieved contrast varies but never falls below
// target until the extreme itself can't reach it. Width is gated by the
// textSecondary per-minute ΔE budget (≤ 0.05 stray).
const HEADROOM_BAND = 4.0;

// Resolve text L continuously across the achievability boundary:
//   reachable + extreme has headroom: comfortL (largest L meeting target).
//   reachable + low headroom:         smoothstep blend comfortL → extreme.
//   unreachable:                      extreme.
// Returns the achieved WCAG contrast — no faking, no clamping.
function solveTextL(
  bg: { L: number; C: number; H: number },
  C: number,
  H: number,
  target: number,
  polarity: Polarity,
): { L: number; achieved: number } {
  const extreme = polarity === 'light' ? 0.05 : 0.99;
  const extremeContrast = contrast({ L: extreme, C, H }, bg);

  // Unreachable side — the extreme is the best we can do.
  if (extremeContrast < target) {
    return { L: extreme, achieved: extremeContrast };
  }

  const comfortL = searchComfortL(bg, C, H, target, polarity);

  // Blend toward extreme as headroom approaches zero. w = 0 with plenty of
  // headroom (use comfortL), w = 1 at the boundary (use extreme).
  const headroom = extremeContrast - target;
  let w: number;
  if (headroom >= HEADROOM_BAND) {
    w = 0;
  } else {
    const t = headroom / HEADROOM_BAND; // 0..1
    w = 1 - t * t * (3 - 2 * t); // smoothstep, inverted
  }
  const finalL = comfortL + w * (extreme - comfortL);
  const finalContrast = contrast({ L: finalL, C, H }, bg);
  return { L: finalL, achieved: finalContrast };
}

// Solve the contrast-driven text family against an arbitrary background and
// emit crossoverProximity off the same cDark/cLight balance. Used by
// deriveTokens for the sky/brand palettes, and by the per-token OKLab blend
// (see hue.ts) to solve text against the BLENDED background — averaging
// black + white text gives unreadable grey, so text must be solved against
// the color actually displayed.
export function solveTextTokens(bg: { L: number; C: number; H: number }): {
  textPrimary: Token;
  textSecondary: Token;
  textMuted: Token;
  crossoverProximity: number;
} {
  const Lbg = bg.L;
  const Cbg = bg.C;
  const Hbg = wrapH(bg.H);
  const bgRef = { L: Lbg, C: Cbg, H: Hbg };

  const cDark = contrast({ L: 0.05, C: TEXT_CHROMA, H: Hbg }, bgRef);
  const cLight = contrast({ L: 0.99, C: TEXT_CHROMA, H: Hbg }, bgRef);
  const polarity: Polarity = cDark >= cLight ? 'light' : 'dark';

  const primarySolve = solveTextL(bgRef, TEXT_CHROMA, Hbg, PRIMARY_TARGET, polarity);
  const textPrimary: Token = {
    L: primarySolve.L,
    C: TEXT_CHROMA,
    H: Hbg,
    alpha: 1,
    contrast: primarySolve.achieved,
  };

  const secondarySolve = solveTextL(bgRef, TEXT_CHROMA, Hbg, SECONDARY_TARGET, polarity);
  const textSecondary: Token = {
    L: secondarySolve.L,
    C: TEXT_CHROMA,
    H: Hbg,
    alpha: 1,
    contrast: secondarySolve.achieved,
  };

  // 60% mix of textPrimary toward background. Inherits the text step.
  const textMuted: Token = {
    L: textPrimary.L + MUTED_MIX * (Lbg - textPrimary.L),
    C: TEXT_CHROMA + MUTED_MIX * (Cbg - TEXT_CHROMA),
    H: Hbg,
    alpha: 1,
  };

  // BALANCE_BAND=6 spans roughly Lbg ∈ [~0.5, ~0.8] around the balanced
  // point; the application layer ramps a scrim from this.
  const BALANCE_BAND = 6.0;
  const crossoverProximity = Math.max(0, 1 - Math.abs(cDark - cLight) / BALANCE_BAND);

  return { textPrimary, textSecondary, textMuted, crossoverProximity };
}

export function deriveTokens(seeds: Seeds): Tokens {
  const Lbg = seeds.L;
  const Cbg = seeds.C;
  const Hbg = seeds.H;

  // Non-text tokens use a smooth signed ramp through the perceptual-midpoint
  // band (Lbg=0.5). Cosmetic only; the cosmetic threshold is independent of
  // the text-polarity threshold and stays here intentionally.
  const { dir, s } = smoothPolarity(Lbg);

  const background: Token = { L: Lbg, C: Cbg, H: wrapH(Hbg), alpha: 1 };

  const surface: Token = { L: Lbg + dir * 0.04, C: Cbg * 1.1, H: wrapH(Hbg), alpha: 1 };
  const surfaceElevated: Token = { L: Lbg + dir * 0.08, C: Cbg * 1.1, H: wrapH(Hbg), alpha: 1 };
  const border: Token = { L: Lbg + dir * 0.14, C: Cbg * 0.8, H: wrapH(Hbg), alpha: 1 };
  const bgGradientStop: Token = { L: Lbg + dir * 0.02, C: Cbg, H: wrapH(Hbg + 15), alpha: 1 };

  // Text family + crossoverProximity — contrast-driven against background.
  // Polarity is chosen by max-contrast (not Lbg<0.5) so the flip lands at the
  // luminance-balanced bg, symmetric by construction.
  const { textPrimary, textSecondary, textMuted, crossoverProximity } =
    solveTextTokens(background);

  // Accent family — L ramps smoothly across the polarity band.
  const accentL = 0.72 - 0.17 * s; // dark: 0.72, light: 0.55
  const accent: Token = { L: accentL, C: ACCENT_C, H: wrapH(Hbg + 150), alpha: 1 };
  const accentHover: Token = {
    L: accentL + dir * 0.06,
    C: ACCENT_C + 0.02,
    H: wrapH(Hbg + 150),
    alpha: 1,
  };
  const accentSecondary: Token = { L: accentL, C: ACCENT_C, H: wrapH(Hbg + 190), alpha: 1 };

  // Depth.
  const shadow: Token = {
    L: Math.max(Lbg - 0.6, 0.05),
    C: Cbg * 1.5,
    H: wrapH(Hbg),
    alpha: SHADOW_ALPHA,
  };
  const glow: Token = { L: 0.85, C: ACCENT_C * 0.8, H: wrapH(Hbg + 150), alpha: GLOW_ALPHA };
  const ambientTint: Token = { L: Lbg, C: Cbg * 0.5, H: wrapH(Hbg), alpha: 1 };

  // Semantic — identity hue preserved, L ramps across the polarity band,
  // hue 10% toward Hbg.
  const semanticL = 0.72 - 0.27 * s; // dark: 0.72, light: 0.45
  const makeSemantic = (identityHue: number): Token => ({
    L: semanticL,
    C: SEMANTIC_C,
    H: angleLerp(identityHue, Hbg, SEMANTIC_HUE_HARMONY),
    alpha: 1,
  });

  return {
    background,
    surface,
    surfaceElevated,
    border,
    bgGradientStop,
    textPrimary,
    textSecondary,
    textMuted,
    accent,
    accentHover,
    accentSecondary,
    shadow,
    glow,
    ambientTint,
    success: makeSemantic(SEMANTIC_HUES.success),
    warning: makeSemantic(SEMANTIC_HUES.warning),
    error: makeSemantic(SEMANTIC_HUES.error),
    info: makeSemantic(SEMANTIC_HUES.info),
    meta: { crossoverProximity },
  };
}

export function getTokens(now: Date, location?: { lat: number; lng: number }): Tokens {
  return deriveTokens(getSeeds(now, location));
}
