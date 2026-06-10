// Validation harness.
// Sweeps the full solar day (1440 minutes) for each scenario, measures
// contrast, gamut, NaN, and OKLab smoothness; enforces hard gates; writes
// out/validation-report.txt and out/filmstrip.html.

import { converter, parse, wcagContrast } from 'culori';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getThemedTokens } from '../src/hue.js';
import { tokensToCss, type CssToken } from '../src/css.js';
import { TOKEN_NAMES, type Token, type TokenName, type Tokens } from '../src/tokens.js';

// -------------------- scenarios --------------------

type Scenario = {
  id: string;
  label: string;
  location?: { lat: number; lng: number };
  options?: { userHue?: number | null; blend?: number };
  startUTC: Date;
};

const DELHI = { lat: 28.6139, lng: 77.2090 };

// 00:00 IST = UTC (y, m, d-1, 18, 30). Use the calendar-day-in-IST starting
// at IST midnight so reported clock times align with what a Delhi/IST user
// would read off the wall.
function istMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, -5, -30));
}

const IST_REF_DATE = istMidnight(2024, 2, 15); // 2024-03-15 IST equinox-ish

const SCENARIOS: Scenario[] = [
  { id: 'A', label: 'sky mode — Delhi 2024-06-21 (summer solstice)',
    location: DELHI, startUTC: istMidnight(2024, 5, 21) },
  { id: 'B', label: 'sky mode — Delhi 2024-12-21 (winter solstice)',
    location: DELHI, startUTC: istMidnight(2024, 11, 21) },
  { id: 'C', label: 'sky mode — IST fallback (2024-03-15)',
    startUTC: IST_REF_DATE },
  { id: 'D', label: 'brand mode — userHue=120, blend=1, IST (2024-03-15)',
    options: { userHue: 120, blend: 1 }, startUTC: IST_REF_DATE },
  { id: 'E', label: 'brand mode — userHue=280, blend=1, IST (2024-03-15)',
    options: { userHue: 280, blend: 1 }, startUTC: IST_REF_DATE },
  // F/G — blend=0.5 antipode safety. With blend=1 only the breath antipode
  // (Hsky vs HskyDailyMean) is exercised; at blend=0.5 the blend antipode
  // (Hsky vs Hbrand) also fires through the vector lerp. Both must remain
  // continuous; ΔE ≤ 0.02 is hard-gated.
  { id: 'F', label: 'brand mode — userHue=120, blend=0.5, IST (2024-03-15)',
    options: { userHue: 120, blend: 0.5 }, startUTC: IST_REF_DATE },
  { id: 'G', label: 'brand mode — userHue=280, blend=0.5, IST (2024-03-15)',
    options: { userHue: 280, blend: 0.5 }, startUTC: IST_REF_DATE },
];

// -------------------- color helpers --------------------

const toRgb = converter('rgb');

function tokenToOklab(t: Token): { L: number; a: number; b: number } {
  const r = (t.H * Math.PI) / 180;
  return { L: t.L, a: t.C * Math.cos(r), b: t.C * Math.sin(r) };
}

function deltaE(p: { L: number; a: number; b: number }, q: { L: number; a: number; b: number }): number {
  const dL = p.L - q.L;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function hasNaN(s: string): boolean { return /NaN/.test(s); }

function inGamut(fallback: string): boolean {
  const parsed = parse(fallback);
  if (!parsed) return false;
  const rgb = toRgb(parsed);
  if (!rgb) return false;
  const eps = 1e-6;
  return (
    Number.isFinite(rgb.r) && rgb.r! >= -eps && rgb.r! <= 1 + eps &&
    Number.isFinite(rgb.g) && rgb.g! >= -eps && rgb.g! <= 1 + eps &&
    Number.isFinite(rgb.b) && rgb.b! >= -eps && rgb.b! <= 1 + eps
  );
}

function clockTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// -------------------- contiguous windows (cyclic) --------------------

type Window = { start: number; end: number; len: number };

function findWindows(flags: boolean[]): Window[] {
  const N = flags.length;
  if (!flags.some(Boolean)) return [];
  const runs: Array<[number, number]> = [];
  let inRun = false;
  let runStart = 0;
  for (let i = 0; i < N; i++) {
    if (flags[i] && !inRun) { inRun = true; runStart = i; }
    else if (!flags[i] && inRun) { inRun = false; runs.push([runStart, i - 1]); }
  }
  if (inRun) runs.push([runStart, N - 1]);
  // Cyclic merge: if both ends are runs, they're really one window crossing midnight.
  if (runs.length >= 2 && runs[0][0] === 0 && runs[runs.length - 1][1] === N - 1) {
    const last = runs.pop()!;
    const first = runs.shift()!;
    runs.unshift([last[0], first[1] + N]); // end is logical (≥ N)
  }
  return runs.map(([s, e]) => ({ start: s % N, end: e % N, len: e - s + 1 }));
}

function formatWindow(w: Window): string {
  return `${clockTime(w.start)}–${clockTime(w.end)} (${w.len} min)`;
}

// -------------------- sweep + analyze --------------------

type MinuteSample = {
  m: number;
  tokens: Tokens;
  css: Record<TokenName, CssToken>;
  contrastPrimary: number;
  contrastSecondary: number;
};

function sweep(s: Scenario): MinuteSample[] {
  const samples: MinuteSample[] = [];
  for (let m = 0; m < 1440; m++) {
    const when = new Date(s.startUTC.getTime() + m * 60 * 1000);
    const tokens = getThemedTokens(when, s.location, s.options);
    const css = tokensToCss(tokens);
    const cp = wcagContrast(css.textPrimary.fallback, css.background.fallback);
    const cs = wcagContrast(css.textSecondary.fallback, css.background.fallback);
    samples.push({ m, tokens, css, contrastPrimary: cp, contrastSecondary: cs });
  }
  return samples;
}

type TokenSmoothness = { name: TokenName; max: number; minute: number };
type TextStep = { minute: number; deltaE: number; matchedCrossing: number | null };
type TextSymmetryFail = { minute: number; before: number; after: number; diff: number };
type TextCheck = {
  token: TokenName;
  steps: TextStep[];
  symmetryFails: TextSymmetryFail[];
  passed: boolean;
  failReason: string | null;
};

type ScenarioReport = {
  scenario: Scenario;
  samples: MinuteSample[];
  nanFailures: string[];
  gamutFailures: string[];
  // Per-token max adjacent ΔE, sorted worst-first.
  tokenSmoothness: TokenSmoothness[];
  // Non-text tokens exceeding SMOOTHNESS_CEILING. The text tokens are
  // intentionally stepped at the L-crossings (irreducible — see textChecks).
  nonTextSmoothnessFailures: TokenSmoothness[];
  // L-crossing minutes (where seeds.L crosses 0.5).
  crossings: number[];
  // Per-text-token step audit: exactly one step per crossing, located at the
  // crossing minute, and contrast symmetric either side.
  textChecks: TextCheck[];
  // Max crossoverProximity across the day and the minute it occurs.
  proximityPeak: { value: number; minute: number };
  // Strict (literal): every minute with hex contrast < 7. Includes
  // sub-perceptual hex-quantization noise (~±0.05 below the OKLCH-targeted 7).
  sub7Windows: Window[];
  sub45Windows: Window[];
  // Robust: only minutes where contrast falls outside the hex-quantization
  // budget — the genuine crossover windows. Used for the contiguity gate.
  robustSub7Windows: Window[];
  robustSub45Windows: Window[];
  worstContrast: { value: number; minute: number };
  contiguityPassed: boolean;
  contiguityIsolated: number[];
};

const SMOOTHNESS_CEILING = 0.02;
// Text tokens are excluded from SMOOTHNESS_CEILING. The polarity flip swaps
// solveTextL's extreme bound (~0.05 ↔ ~0.99) and is irreducible. Audited
// separately by `textChecks`: exactly one step per L-crossing, at the
// crossing minute, with symmetric contrast.
const TEXT_TOKENS: ReadonlySet<TokenName> = new Set<TokenName>(['textPrimary', 'textSecondary', 'textMuted']);
// Adjacent-minute ΔE above which we treat a text-token movement as the
// intentional polarity flip (vs the small per-minute drift that the binary
// search still produces). The flip itself is ~0.94 / 0.84 / 0.37; the drift
// is well under 0.01 — 0.05 cleanly separates them.
const TEXT_STEP_THRESHOLD = 0.05;
// A detected text-step minute must lie within this many minutes of a
// text-polarity-crossing minute to be considered "located at" the crossing.
const TEXT_CROSSING_TOLERANCE_MIN = 1;
// Symmetric-flip tolerance: at the crossing minute the two extremes
// (contrast(L=0.05, bg) and contrast(L=0.99, bg)) should give nearly equal
// contrast — that is the *definition* of the crossing now (polarity is
// chosen by max-contrast against the actual bg). Discrete-minute sampling
// means the crossing minute will be within ΔLbg/min of the exact balanced
// point, so a small residual asymmetry is expected; 0.5 contrast units is
// well above the per-minute slope at the balanced point across all sky
// scenarios. Hard gate.
const TEXT_SYMMETRY_TOLERANCE = 0.5;
// Non-text smoothness is hard-gated on every scenario. (Earlier work used a
// brand-mode exemption to tolerate a sawtooth breath at the Hsky-vs-mean
// antipode; the model now uses a sinusoidal breath + vector-space blend lerp
// that is continuous across both antipodes, so brand mode meets the same
// adjacent-minute ΔE budget as sky mode.)
//
// Hex round-trip shifts WCAG contrast by ≤0.05 vs the OKLCH target the text
// solver produced. The contiguity intent ("two L-crossings") is robust to
// this noise; gate on a 0.1 budget so hex jitter doesn't fragment the
// windows.
const HEX_QUANT_BUDGET = 0.1;
const ROBUST_PRIMARY_TARGET = 7 - HEX_QUANT_BUDGET; // 6.9
const ROBUST_SECONDARY_TARGET = 4.5 - HEX_QUANT_BUDGET; // 4.4

// Detect text-polarity crossings: minutes where the side of textPrimary
// relative to bg flips. With contrast-driven polarity selection, this lands
// at the luminance-balanced bg, not at perceptual Lbg=0.5.
function findCrossings(samples: MinuteSample[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const j = (i - 1 + samples.length) % samples.length;
    const prevLight = samples[j].tokens.textPrimary.L > samples[j].tokens.background.L;
    const curLight = samples[i].tokens.textPrimary.L > samples[i].tokens.background.L;
    if (prevLight !== curLight) out.push(i);
  }
  return out;
}

function nearestCrossing(minute: number, crossings: number[], N: number): { c: number; dist: number } | null {
  if (crossings.length === 0) return null;
  let best = { c: crossings[0], dist: Infinity };
  for (const c of crossings) {
    let d = Math.abs(minute - c);
    d = Math.min(d, N - d);
    if (d < best.dist) best = { c, dist: d };
  }
  return best;
}

function analyze(scenario: Scenario): ScenarioReport {
  const samples = sweep(scenario);

  const nanFailures: string[] = [];
  const gamutFailures: string[] = [];
  for (const s of samples) {
    for (const name of TOKEN_NAMES) {
      const css = s.css[name];
      if (hasNaN(css.oklch) || hasNaN(css.fallback)) {
        nanFailures.push(`m=${s.m} ${name}: oklch="${css.oklch}" fallback="${css.fallback}"`);
      }
      if (!inGamut(css.fallback)) {
        gamutFailures.push(`m=${s.m} ${name}: fallback="${css.fallback}"`);
      }
    }
  }

  // All-tokens smoothness sweep — record max adjacent-minute OKLab ΔE per token.
  const tokenMax = new Map<TokenName, { value: number; minute: number }>();
  for (const name of TOKEN_NAMES) tokenMax.set(name, { value: 0, minute: 0 });
  for (let i = 0; i < samples.length; i++) {
    const j = (i - 1 + samples.length) % samples.length;
    for (const name of TOKEN_NAMES) {
      const d = deltaE(
        tokenToOklab(samples[j].tokens[name]),
        tokenToOklab(samples[i].tokens[name]),
      );
      const cur = tokenMax.get(name)!;
      if (d > cur.value) tokenMax.set(name, { value: d, minute: i });
    }
  }
  const tokenSmoothness: TokenSmoothness[] = TOKEN_NAMES.map((name) => {
    const m = tokenMax.get(name)!;
    return { name, max: m.value, minute: m.minute };
  }).sort((a, b) => b.max - a.max);
  const nonTextSmoothnessFailures = tokenSmoothness.filter(
    (t) => !TEXT_TOKENS.has(t.name) && t.max > SMOOTHNESS_CEILING,
  );

  // Text-token flip audit — irreducible step at each L-crossing.
  const crossings = findCrossings(samples);
  const textChecks: TextCheck[] = [];
  for (const name of ['textPrimary', 'textSecondary', 'textMuted'] as const) {
    const steps: TextStep[] = [];
    for (let i = 0; i < samples.length; i++) {
      const j = (i - 1 + samples.length) % samples.length;
      const d = deltaE(
        tokenToOklab(samples[j].tokens[name]),
        tokenToOklab(samples[i].tokens[name]),
      );
      if (d > TEXT_STEP_THRESHOLD) {
        const nc = nearestCrossing(i, crossings, samples.length);
        steps.push({
          minute: i,
          deltaE: d,
          matchedCrossing: nc && nc.dist <= TEXT_CROSSING_TOLERANCE_MIN ? nc.c : null,
        });
      }
    }
    // Symmetry probe — at the crossing minute, compute the contrast that
    // BOTH polarity extremes would have against the same bg. Polarity is
    // now chosen by max-contrast, so the crossing happens where the two
    // become equal; |cDark - cLight| at the crossing minute is the residual
    // discrete-sampling slip. Hard-gated below.
    const symmetryFails: TextSymmetryFail[] = [];
    if (name !== 'textMuted') {
      for (const step of steps) {
        const s = samples[step.minute];
        const bg = s.tokens.background;
        const text = s.tokens[name];
        const cDark = wcagContrast(
          { mode: 'oklch', l: 0.05, c: text.C, h: text.H },
          { mode: 'oklch', l: bg.L, c: bg.C, h: bg.H },
        ) ?? 0;
        const cLight = wcagContrast(
          { mode: 'oklch', l: 0.99, c: text.C, h: text.H },
          { mode: 'oklch', l: bg.L, c: bg.C, h: bg.H },
        ) ?? 0;
        const diff = Math.abs(cDark - cLight);
        symmetryFails.push({ minute: step.minute, before: cDark, after: cLight, diff });
      }
    }
    let failReason: string | null = null;
    if (steps.length !== crossings.length) {
      failReason = `expected ${crossings.length} step(s) (one per polarity-crossing), got ${steps.length}`;
    } else if (steps.some((s) => s.matchedCrossing === null)) {
      const stray = steps.filter((s) => s.matchedCrossing === null).length;
      failReason = `${stray} step(s) not located at any polarity-crossing (tol ±${TEXT_CROSSING_TOLERANCE_MIN} min)`;
    } else if (name !== 'textMuted') {
      const worstSym = symmetryFails.reduce(
        (m, s) => (s.diff > m.diff ? s : m),
        { minute: 0, before: 0, after: 0, diff: 0 },
      );
      if (worstSym.diff > TEXT_SYMMETRY_TOLERANCE) {
        failReason = `asymmetry Δ=${worstSym.diff.toFixed(3)} > ${TEXT_SYMMETRY_TOLERANCE} at ${clockTime(worstSym.minute)} (cDark=${worstSym.before.toFixed(3)}, cLight=${worstSym.after.toFixed(3)})`;
      }
    }
    textChecks.push({ token: name, steps, symmetryFails, passed: failReason === null, failReason });
  }

  // crossoverProximity peak across the day.
  let proximityPeak = { value: 0, minute: 0 };
  for (const s of samples) {
    const p = s.tokens.meta.crossoverProximity;
    if (p > proximityPeak.value) proximityPeak = { value: p, minute: s.m };
  }

  const sub7Flags = samples.map((s) => s.contrastPrimary < 7);
  const sub45Flags = samples.map((s) => s.contrastSecondary < 4.5);
  const sub7Windows = findWindows(sub7Flags);
  const sub45Windows = findWindows(sub45Flags);
  const robustSub7Flags = samples.map((s) => s.contrastPrimary < ROBUST_PRIMARY_TARGET);
  const robustSub45Flags = samples.map((s) => s.contrastSecondary < ROBUST_SECONDARY_TARGET);
  const robustSub7Windows = findWindows(robustSub7Flags);
  const robustSub45Windows = findWindows(robustSub45Flags);

  let worst = { value: Infinity, minute: 0 };
  for (const s of samples) {
    if (s.contrastPrimary < worst.value) worst = { value: s.contrastPrimary, minute: s.m };
  }

  const contiguityIsolated: number[] = [];
  if (robustSub7Windows.length > 2) {
    const sorted = [...robustSub7Windows].sort((a, b) => b.len - a.len);
    const extras = sorted.slice(2);
    for (const w of extras) {
      let i = w.start;
      for (let k = 0; k < w.len; k++) {
        contiguityIsolated.push(i);
        i = (i + 1) % 1440;
      }
    }
  }

  return {
    scenario, samples,
    nanFailures, gamutFailures,
    tokenSmoothness, nonTextSmoothnessFailures,
    crossings, textChecks, proximityPeak,
    sub7Windows, sub45Windows,
    robustSub7Windows, robustSub45Windows,
    worstContrast: worst,
    contiguityPassed: robustSub7Windows.length <= 2,
    contiguityIsolated,
  };
}

// -------------------- text report --------------------

function reportScenario(r: ScenarioReport): string {
  const out: string[] = [];
  out.push(`Scenario ${r.scenario.id}: ${r.scenario.label}`);
  out.push(`  NaN-free:         ${r.nanFailures.length === 0 ? 'OK' : `FAIL (${r.nanFailures.length} sightings)`}`);
  out.push(`  Gamut-clamped:    ${r.gamutFailures.length === 0 ? 'OK' : `FAIL (${r.gamutFailures.length} out-of-gamut)`}`);
  out.push(`  Polarity crossings (luminance-balanced bg): ${r.crossings.length === 0 ? 'none' : r.crossings.map(clockTime).join(', ')}`);
  out.push(`  crossoverProximity peak: ${r.proximityPeak.value.toFixed(4)} at ${clockTime(r.proximityPeak.minute)}`);
  out.push(`  Non-text smoothness (15 tokens; ceiling ΔE ${SMOOTHNESS_CEILING}): ${r.nonTextSmoothnessFailures.length} fail`);
  out.push(`    Per-token max adjacent ΔE (worst-first; * = text token, step expected at polarity-crossings):`);
  for (const t of r.tokenSmoothness) {
    const isText = TEXT_TOKENS.has(t.name);
    const mark = isText
      ? '  step'
      : t.max > SMOOTHNESS_CEILING
        ? '  FAIL'
        : '    ok';
    const star = isText ? '*' : ' ';
    out.push(`      ${(t.name + star).padEnd(19)} ${t.max.toFixed(4).padStart(8)}   at ${clockTime(t.minute)}${mark}`);
  }
  out.push(`  Text-flip integrity (1 step per polarity-crossing, located at the crossing minute, symmetric Δ ≤ ${TEXT_SYMMETRY_TOLERANCE}):`);
  for (const tc of r.textChecks) {
    const located = tc.steps.filter((s) => s.matchedCrossing !== null).length;
    const stepMins = tc.steps.map((s) => `${clockTime(s.minute)} (ΔE ${s.deltaE.toFixed(3)})`).join(', ');
    out.push(`    ${tc.token.padEnd(14)} ${tc.passed ? 'OK' : 'FAIL'} — ${tc.steps.length}/${r.crossings.length} steps (${located} located)${stepMins ? `: ${stepMins}` : ''}${tc.failReason ? `  [${tc.failReason}]` : ''}`);
  }
  const sym = r.textChecks.filter((tc) => tc.symmetryFails.length > 0);
  if (sym.length > 0) {
    out.push(`  Flip symmetry probe (both extremes vs same bg at crossing minute):`);
    for (const tc of sym) {
      const line = tc.symmetryFails.map((s) => `${clockTime(s.minute)} cDark=${s.before.toFixed(3)} cLight=${s.after.toFixed(3)} Δ=${s.diff.toFixed(3)}`).join('; ');
      out.push(`    ${tc.token.padEnd(14)} ${line}`);
    }
  }
  out.push(`  worst contrast (textPrimary/bg): ${r.worstContrast.value.toFixed(3)} at ${clockTime(r.worstContrast.minute)}`);
  const sub7Total = r.sub7Windows.reduce((s, w) => s + w.len, 0);
  out.push(`  below 7:1 (strict): ${sub7Total} min in ${r.sub7Windows.length} window(s)`);
  const robustSub7Total = r.robustSub7Windows.reduce((s, w) => s + w.len, 0);
  if (r.robustSub7Windows.length === 0) {
    out.push(`  below ${ROBUST_PRIMARY_TARGET}:1 (robust, true crossover): 0 min`);
  } else {
    out.push(`  below ${ROBUST_PRIMARY_TARGET}:1 (robust, true crossover): ${robustSub7Total} min in ${r.robustSub7Windows.length} window(s) — ${r.robustSub7Windows.map(formatWindow).join(', ')}`);
  }
  const sub45Total = r.sub45Windows.reduce((s, w) => s + w.len, 0);
  out.push(`  below 4.5:1 (strict): ${sub45Total} min in ${r.sub45Windows.length} window(s)`);
  const robustSub45Total = r.robustSub45Windows.reduce((s, w) => s + w.len, 0);
  if (r.robustSub45Windows.length === 0) {
    out.push(`  below ${ROBUST_SECONDARY_TARGET}:1 (robust): 0 min`);
  } else {
    out.push(`  below ${ROBUST_SECONDARY_TARGET}:1 (robust): ${robustSub45Total} min in ${r.robustSub45Windows.length} window(s) — ${r.robustSub45Windows.map(formatWindow).join(', ')}`);
  }
  out.push(`  contiguity (robust): ${r.contiguityPassed ? 'OK' : `FAIL — ${r.contiguityIsolated.length} isolated minutes`}`);
  return out.join('\n');
}

// -------------------- filmstrip --------------------

function emitFilmstrip(r: ScenarioReport, outPath: string): void {
  const W = 1440;
  const BG_H = 160;
  const TEXT_H = 40;
  const ACCENT_H = 60;
  const STRIP_H = BG_H + TEXT_H + ACCENT_H; // 260
  const SVG_H = STRIP_H + 24; // room for hour labels

  const rects: string[] = [];
  for (const s of r.samples) {
    rects.push(`<rect x="${s.m}" y="0" width="1" height="${BG_H}" fill="${s.css.background.fallback}"/>`);
  }
  for (const s of r.samples) {
    rects.push(`<rect x="${s.m}" y="${BG_H}" width="1" height="${TEXT_H}" fill="${s.css.textPrimary.fallback}"/>`);
  }
  for (const s of r.samples) {
    rects.push(`<rect x="${s.m}" y="${BG_H + TEXT_H}" width="1" height="${ACCENT_H}" fill="${s.css.accent.fallback}"/>`);
  }

  const gridlines: string[] = [];
  const labels: string[] = [];
  for (let h = 0; h <= 24; h++) {
    const x = h * 60;
    gridlines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${STRIP_H}" stroke="rgba(255,255,255,0.18)" stroke-width="0.5"/>`);
    if (h < 24) labels.push(`<text x="${x + 2}" y="${STRIP_H + 14}" fill="#ddd" font-size="10" font-family="monospace">${String(h).padStart(2, '0')}:00</text>`);
  }

  const markers: string[] = [];
  for (const w of r.robustSub7Windows) {
    markers.push(`<line x1="${w.start}" y1="0" x2="${w.start}" y2="${STRIP_H}" stroke="#ff4" stroke-width="1" opacity="0.85"/>`);
    const endX = (w.end + 1) % 1440;
    markers.push(`<line x1="${endX}" y1="0" x2="${endX}" y2="${STRIP_H}" stroke="#ff4" stroke-width="1" opacity="0.85"/>`);
  }

  const html = [
    `<!DOCTYPE html>`,
    `<html><head><meta charset="utf-8"><title>Validation filmstrip — ${r.scenario.label}</title>`,
    `<style>`,
    `  body{font-family:monospace;background:#111;color:#eee;padding:24px;margin:0;}`,
    `  h1{font-size:14px;margin:0 0 6px;}`,
    `  .meta{font-size:11px;color:#bbb;margin-bottom:14px;}`,
    `  svg{display:block;}`,
    `  .legend{font-size:11px;color:#bbb;margin-top:10px;}`,
    `</style></head><body>`,
    `<h1>Validation filmstrip — ${r.scenario.label}</h1>`,
    `<div class="meta">Rows top → bottom: background (160px), textPrimary (40px), accent (60px). Yellow vertical bars mark sub-7:1 crossover boundaries.</div>`,
    `<svg width="${W}" height="${SVG_H}" viewBox="0 0 ${W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg">`,
    rects.join(''),
    gridlines.join(''),
    markers.join(''),
    labels.join(''),
    `</svg>`,
    `<div class="legend">`,
    `  Robust crossover windows (sub-${ROBUST_PRIMARY_TARGET}:1): ${r.robustSub7Windows.length === 0 ? 'none' : r.robustSub7Windows.map(formatWindow).join(', ')}<br>`,
    `  Worst contrast: ${r.worstContrast.value.toFixed(3)} at ${clockTime(r.worstContrast.minute)} &nbsp;|&nbsp; non-text smoothness fails: ${r.nonTextSmoothnessFailures.length}/15 &nbsp;|&nbsp; L-crossings: ${r.crossings.map(clockTime).join(', ')} &nbsp;|&nbsp; crossoverProximity peak: ${r.proximityPeak.value.toFixed(3)} at ${clockTime(r.proximityPeak.minute)}`,
    `</div>`,
    `</body></html>`,
  ].join('\n');

  writeFileSync(outPath, html);
}

// -------------------- main --------------------

mkdirSync('out', { recursive: true });

console.log('Running validation harness across all scenarios…');
const reports: ScenarioReport[] = SCENARIOS.map(analyze);

const text: string[] = [];
text.push('Validation harness report');
text.push('='.repeat(72));
text.push('');
text.push('Methodology');
text.push('-'.repeat(72));
text.push('Contrast is measured on the gamut-mapped sRGB hex fallbacks.');
text.push('The text solver targets OKLCH contrast 7.0; hex round-trip shifts WCAG contrast by');
text.push(`up to ~±0.05. We report two contrast counts per scenario:`);
text.push(`  - "strict" (literal < 7): includes hex-quantization noise.`);
text.push(`  - "robust" (< ${ROBUST_PRIMARY_TARGET}, 0.1 budget): the genuine L-crossover windows.`);
text.push('Contiguity gate uses the robust threshold (otherwise hex jitter fragments');
text.push('the windows). Smoothness ceiling for adjacent-minute OKLab ΔE = 0.02.');
for (const r of reports) {
  text.push('');
  text.push(reportScenario(r));
}

text.push('');
text.push('Summary');
text.push('-'.repeat(72));
text.push(`${'Scn'.padEnd(4)}${'sub-7 str'.padStart(11)}${'sub-7 rob'.padStart(11)}${'sub-4.5 s'.padStart(11)}${'non-text fails'.padStart(16)}${'text flips'.padStart(12)}${'worst'.padStart(10)}`);
for (const r of reports) {
  const sub7 = r.sub7Windows.reduce((s, w) => s + w.len, 0);
  const robust = r.robustSub7Windows.reduce((s, w) => s + w.len, 0);
  const sub45 = r.sub45Windows.reduce((s, w) => s + w.len, 0);
  const textOk = r.textChecks.every((tc) => tc.passed);
  const textStr = `${textOk ? 'OK' : 'FAIL'} (${r.crossings.length}/tok)`;
  text.push(
    `${r.scenario.id.padEnd(4)}${String(sub7).padStart(11)}${String(robust).padStart(11)}${String(sub45).padStart(11)}${`${r.nonTextSmoothnessFailures.length}/15`.padStart(16)}${textStr.padStart(12)}${r.worstContrast.value.toFixed(3).padStart(10)}`,
  );
}

text.push('');
text.push('Crossover windows (robust, true L-crossing) per scenario');
text.push('-'.repeat(72));
for (const r of reports) {
  text.push(`${r.scenario.id}: ${r.robustSub7Windows.length === 0 ? 'none' : r.robustSub7Windows.map(formatWindow).join(', ')}`);
}

text.push('');
text.push('Hard gates');
text.push('-'.repeat(72));
text.push('Non-text smoothness (15 tokens) and text-flip integrity are gated on');
text.push('every scenario. The sky/brand blend uses a sinusoidal breath +');
text.push('vector-space lerp that is continuous across both antipodes (breath');
text.push('antipode: Hsky vs daily-mean; blend antipode: Hsky vs Hbrand).');
let gatesPassed = true;
for (const r of reports) {
  const textFails = r.textChecks.filter((tc) => !tc.passed);
  const gates: Array<{ name: string; pass: boolean; note?: string }> = [
    { name: 'no NaN', pass: r.nanFailures.length === 0 },
    { name: 'gamut [0,1]', pass: r.gamutFailures.length === 0 },
    {
      name: `non-text ΔE ≤ ${SMOOTHNESS_CEILING}`,
      pass: r.nonTextSmoothnessFailures.length === 0,
      note: r.nonTextSmoothnessFailures.length === 0
        ? undefined
        : `${r.nonTextSmoothnessFailures.length}/15 fail; worst ${r.nonTextSmoothnessFailures[0].name}=${r.nonTextSmoothnessFailures[0].max.toFixed(4)} at ${clockTime(r.nonTextSmoothnessFailures[0].minute)}`,
    },
    {
      name: 'text flips = polarity-crossings, located, symmetric',
      pass: textFails.length === 0,
      note: textFails.length === 0
        ? `${r.crossings.length} crossing(s) × 3 tokens`
        : textFails.map((tc) => `${tc.token}: ${tc.failReason}`).join('; '),
    },
    { name: 'sub-7 contiguity', pass: r.contiguityPassed, note: `${r.robustSub7Windows.length} windows` },
  ];
  const fails = gates.filter((g) => !g.pass);
  if (fails.length === 0) text.push(`${r.scenario.id}: ALL PASS`);
  else {
    gatesPassed = false;
    text.push(`${r.scenario.id}: FAIL — ${fails.map((g) => `${g.name}${g.note ? ` (${g.note})` : ''}`).join('; ')}`);
  }
}

const reportText = text.join('\n') + '\n';
console.log('\n' + reportText);
writeFileSync(join('out', 'validation-report.txt'), reportText);

const scC = reports.find((r) => r.scenario.id === 'C')!;
emitFilmstrip(scC, join('out', 'filmstrip.html'));
console.log(`Filmstrip written to out/filmstrip.html (scenario C).`);
console.log(`Report written to out/validation-report.txt.`);

if (!gatesPassed) {
  console.error('\nHARD GATES FAILED. See out/validation-report.txt for details.');
  process.exit(1);
}
