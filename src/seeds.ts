import { getSolarAnchors, type SolarAnchor } from './solar.js';

export type Seeds = { L: number; H: number; C: number };

// L anchors chosen for fast traversal of the mid-grey legibility bad band
// Lbg ∈ [0.45, 0.70] (text polarity balances at Lbg≈0.66, not 0.5; see
// ARCHITECTURE.md). Anchors sit OUT of that band so the spline only transits
// it between anchors. Transit speed is gated by the non-text smoothness
// budget ΔE ≤ 0.02 per minute: background.ΔE = ΔL, so peak dL/dt hard-caps
// at ~0.02/min. Winter Delhi's ~22 min dawn→sunrise span is the binding
// constraint — sunrise 0.70 + dawn 0.40 → peak ~0.0194/min. The widened
// polarity smoothstep band in tokens.ts (W = 0.60) absorbs the steeper
// non-text rates.
const SEED_TABLE: Record<string, { L: number; H: number; C: number }> = {
  solarMidnight: { L: 0.13, H: 265, C: 0.02 },
  dawn:          { L: 0.42, H: 320, C: 0.04 },
  sunrise:       { L: 0.70, H:  25, C: 0.06 },
  morning:       { L: 0.90, H:  60, C: 0.04 },
  solarNoon:     { L: 0.97, H: 210, C: 0.03 },
  afternoon:     { L: 0.93, H: 160, C: 0.04 },
  goldenHour:    { L: 0.75, H:  40, C: 0.07 },
  sunset:        { L: 0.42, H:  15, C: 0.08 },
  dusk:          { L: 0.28, H: 330, C: 0.05 },
  night:         { L: 0.16, H: 285, C: 0.03 },
};

const L_MIN = 0.05;
const L_MAX = 0.99;
const C_MIN = 0;
const C_MAX = 0.12;

function repairTimes(ring: SolarAnchor[]): number[] {
  const times = ring.map((a) => a.time.getTime());
  const valid: number[] = [];
  for (let i = 0; i < times.length; i++) if (Number.isFinite(times[i])) valid.push(i);

  if (valid.length === times.length) return times;

  if (valid.length === 0) {
    throw new Error('getSeeds: all anchor times invalid; cannot interpolate');
  }

  for (let i = 0; i < times.length; i++) {
    if (Number.isFinite(times[i])) continue;
    let prev = -1;
    for (let k = valid.length - 1; k >= 0; k--) {
      if (valid[k] < i) { prev = valid[k]; break; }
    }
    let next = -1;
    for (let k = 0; k < valid.length; k++) {
      if (valid[k] > i) { next = valid[k]; break; }
    }
    if (prev >= 0 && next >= 0) {
      const frac = (i - prev) / (next - prev);
      times[i] = times[prev] + frac * (times[next] - times[prev]);
    } else if (prev >= 0) {
      // Extrapolate forward from prev using average spacing
      const span = times[prev] - times[valid[0]];
      const step = valid.length > 1 ? span / (prev - valid[0]) : 24 * 3600 * 1000 / 10;
      times[i] = times[prev] + step * (i - prev);
    } else {
      const span = times[valid[valid.length - 1]] - times[next];
      const step = valid.length > 1 ? span / (valid[valid.length - 1] - next) : 24 * 3600 * 1000 / 10;
      times[i] = times[next] - step * (next - i);
    }
    console.warn(
      `getSeeds: anchor[${i}] (${ring[i].name}) time invalid; substituted fallback`,
    );
  }
  return times;
}

function unwrapHue(raw: number[]): number[] {
  const out = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    let v = raw[i];
    const prev = out[i - 1];
    while (v - prev > 180) v -= 360;
    while (v - prev < -180) v += 360;
    out.push(v);
  }
  return out;
}

function wrapHue(h: number): number {
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

// Cyclic accessor: for an N-entry ring where entry 0 and entry N-1 are
// the same anchor in different cycles, index -1 maps to entry N-2 shifted
// back by one day, and index N maps to entry 1 shifted forward by one day.
function cyclic(
  values: number[],
  times: number[],
  idx: number,
): { v: number; t: number } {
  const N = times.length;
  const dayspan = times[N - 1] - times[0];
  if (idx >= 0 && idx < N) return { v: values[idx], t: times[idx] };
  if (idx < 0) {
    const real = N - 1 + idx;
    return { v: values[real], t: times[real] - dayspan };
  }
  const real = idx - (N - 1);
  return { v: values[real], t: times[real] + dayspan };
}

function tangent(values: number[], times: number[], idx: number): number {
  const prev = cyclic(values, times, idx - 1);
  const next = cyclic(values, times, idx + 1);
  return (next.v - prev.v) / (next.t - prev.t);
}

function evalSegment(
  values: number[],
  times: number[],
  i: number,
  t: number,
): number {
  const t0 = times[i];
  const t1 = times[i + 1];
  const h = t1 - t0;
  const s = (t - t0) / h;
  const m0 = tangent(values, times, i);
  const m1 = tangent(values, times, i + 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * values[i] + h10 * h * m0 + h01 * values[i + 1] + h11 * h * m1;
}

function findSegment(times: number[], t: number): number {
  if (t <= times[0]) return 0;
  if (t >= times[times.length - 1]) return times.length - 2;
  // linear scan is fine for N=11
  for (let i = 0; i < times.length - 1; i++) {
    if (t >= times[i] && t <= times[i + 1]) return i;
  }
  return times.length - 2;
}

export function getSeeds(
  now: Date,
  location?: { lat: number; lng: number },
): Seeds {
  const ring = getSolarAnchors(now, location);
  const times = repairTimes(ring);

  const Lraw = ring.map((a) => SEED_TABLE[a.name].L);
  const Hraw = ring.map((a) => SEED_TABLE[a.name].H);
  const Craw = ring.map((a) => SEED_TABLE[a.name].C);
  const Hunwrap = unwrapHue(Hraw);

  let t = now.getTime();
  if (t < times[0]) t = times[0];
  if (t > times[times.length - 1]) t = times[times.length - 1];
  const i = findSegment(times, t);

  const Lspline = evalSegment(Lraw, times, i, t);
  const Hspline = evalSegment(Hunwrap, times, i, t);
  const Cspline = evalSegment(Craw, times, i, t);

  return {
    L: Math.min(L_MAX, Math.max(L_MIN, Lspline)),
    H: wrapHue(Hspline),
    C: Math.min(C_MAX, Math.max(C_MIN, Cspline)),
  };
}

export function exportSeedsCsv(
  startOfDay: Date,
  location?: { lat: number; lng: number },
  minutes: number = 1440,
): string {
  const rows: string[] = ['minute,t_iso,L,H,C'];
  for (let m = 0; m < minutes; m++) {
    const when = new Date(startOfDay.getTime() + m * 60 * 1000);
    const s = getSeeds(when, location);
    rows.push(`${m},${when.toISOString()},${s.L.toFixed(6)},${s.H.toFixed(4)},${s.C.toFixed(6)}`);
  }
  return rows.join('\n') + '\n';
}
