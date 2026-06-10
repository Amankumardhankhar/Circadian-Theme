# INTEGRATION

How to consume the circadian theme engine from a real application — both the
DOM/CSS path and the WebGL/3D path — plus the load-bearing invariants that
must be preserved by any wrapper.

## Consuming the engine — two paths

### 1. DOM / CSS elements

Use the CSS custom properties that `ThemeEngine` writes on `:root`:

```
--bg               --surface           --surface-elevated   --border
--bg-gradient-stop --text-primary      --text-secondary     --text-muted
--accent           --accent-hover      --accent-secondary
--shadow           --glow              --ambient-tint
--success          --warning           --error              --info
--crossover-proximity   (number, 0..1)
```

They are registered via `@property` (see `demo/theme.css`) as `<color>` /
`<number>`, so CSS `transition` actually animates them. Without that
registration, custom-property transitions are no-ops. This is how the whole
demo page is themed.

### 2. WebGL / `<canvas>` / Three.js / React Three Fiber

CSS variables do not reach a WebGL context — shaders and materials need raw
color values, not `var(...)` references. Bridge the **values** instead:

```ts
import { getThemedTokens } from './src/hue.js';
import { rgb } from 'culori';

const tokens = getThemedTokens(now, location, { userHue, blend });
// tokens.accent is an OKLCH token { L, C, H, alpha }
const sRGB = rgb({ mode: 'oklch', l: t.L, c: t.C, h: t.H });
material.color.setRGB(sRGB.r, sRGB.g, sRGB.b);
```

Three's color management: mark materials/colors as sRGB (`SRGBColorSpace`) so
the renderer converts them to linear on upload. Skipping that step is the
classic source of "the colors look right in CSS but washed out in WebGL".

## Wiring the particle lion hero (R3F)

- **Single source of truth:** call the same `getThemedTokens` the page uses.
  The lion then stays in lockstep with the page and the dial automatically —
  no separate clock, no risk of drift.
- **Mapping (suggested starting point):**
  - dot core → `accent`
  - halo / bloom → `glow`
  - scene background → `bg`
  - secondary accent → `accentSecondary` (variation without a hue collision)
- **Update cadence:**
  - Setting one material color or shader uniform per engine tick (~2 s) or per
    dial scrub is essentially free.
  - Rewriting per-point color attributes across thousands of dots is **not**.
    Do it on a token change only, never every frame. A `prevTokenKey` cache
    keyed off `(round(L,3), round(C,3), round(H,2))` is enough.
- **`meta.crossoverProximity` (0..1)** rises in the dawn/dusk legibility band
  and can drive lion shimmer / scatter / dim — a way to make the irreducible
  crossover feel intentional rather than awkward.

## Putting the engine on the real site (Next.js 15 + R3F + Tailwind + GSAP + Framer Motion)

- The engine core is framework-agnostic TS: `solar.ts`, `seeds.ts`,
  `tokens.ts`, `css.ts`, `hue.ts`, `engine.ts`. Import `ThemeEngine`; it
  writes the CSS vars on `:root`.
- **Carry over `theme.css`** — the `@property` block is load-bearing. Without
  it, custom-property transitions don't animate and every minute looks like a
  step instead of a slide.
- `--text-primary` / `--text-secondary` / `--text-muted` must **not** have a
  CSS transition (see the explicit transition list in `demo/theme.css`). The
  dawn/dusk polarity flip is an irreducible black↔white snap; any continuous
  text-L path through the crossover passes through invisible mid-grey.
- **No-flash on load (SSR):** add an inline `<head>` script that computes
  initial tokens (IST fallback if geolocation hasn't resolved) and sets the
  CSS vars on `:root` before first paint. Otherwise there is a one-frame
  flash of default colors before the engine boots. `ThemeEngine.start()`
  already paints synchronously and upgrades to real geolocation in the
  background once permission resolves.
- **Never override text lightness manually.** The engine solves text contrast
  against the live background; overriding breaks the readability guarantee
  (see `solveTextTokens` in `src/tokens.ts`).

## Invariants — load-bearing, never break

1. **All color math in OKLCH.** Convert to sRGB only at the output edge.
   `culori` `clampChroma` is the gamut-map: preserves L and H, reduces C into
   gamut. Anything other than OKLCH for interpolation reintroduces the muddy
   mid-greys this engine exists to avoid.
2. **User override touches HUE ONLY.** Lightness and chroma stay locked to
   the solar curve — that is the comfort guarantee. A pasted hex adopts the
   hue, not the exact shade. (`src/hue.ts` → `getThemedTokens` per-token
   OKLab blend.)
3. **The text crossover flip is mathematically irreducible.** It happens
   once per dawn and once per dusk, snaps from black to white (or vice
   versa), and must **never be smoothed**. Any continuous text-L path
   through the crossover crosses zero-contrast grey.
4. **Blending hues that can be antipodal happens in OKLab Cartesian.**
   Per-token palette blend (`blendInOklab` in `src/hue.ts`) — never by
   interpolating the hue angle. Angle interpolation flips sign at the
   antipode and produces a one-frame ~0.34 ΔE jump.
5. **After any change to `src/*.ts`, run `npm run validate`.** All 7
   scenarios (A–G) must stay green. The hard gates are non-text smoothness
   (≤ 0.02 adjacent-minute ΔE on 15 tokens) and text-flip integrity (exactly
   2 flips per token per day). The full `npm test` suite must also stay
   green.
6. **Don't casually widen the surface / elevation deltas in `tokens.ts`.**
   A larger constant amplifies the per-minute change inside the polarity
   crossover band and can break the 0.02 smoothness gate enforced by
   `npm run validate`. If you must widen them, widen the polarity
   `smoothstep` band to match and re-run validation.
7. **Contrast targets.** AA (4.5:1) is met at every minute in every
   scenario (worst ~4.50). AAA (7:1) is missed only inside the ~15–25 minute
   dawn / dusk crossover windows — the irreducible day-side collision, not a
   bug. The engine emits `meta.crossoverProximity` so the application can
   render a scrim / scrim-like UI affordance during those windows; the demo
   does this in the `.crossover` section.

## File map (one line each)

- `src/solar.ts` — `getSolarAnchors(now, location?)`; sun-event ring.
- `src/seeds.ts` — `getSeeds(now, location?)`; (L, C, H) seeds along the day.
- `src/tokens.ts` — `deriveTokens`, `getTokens`, `solveTextTokens`,
  `TOKEN_NAMES`, `meta.crossoverProximity`.
- `src/hue.ts` — `resolveHue`, `getThemedTokens` (sky + user-hue blend).
- `src/css.ts` — `toCss`, `tokensToCss` (OKLCH string + sRGB fallback).
- `src/engine.ts` — `ThemeEngine` (start/stop, setManual/clearManual,
  setUserHue/setBlend, setImmediate, getters).
- `src/dial.ts` — `ClockDial(engine, opts?)` — self-contained scrub UI.
- `demo/theme.css` — `@property` registration + the explicit transition
  list. Copy this file when integrating.
- `test/validate.test.ts` — scenarios A–G + hard gates.

## Test commands

- `npm test` — solar → seeds → tokens → css → hue (unit suites).
- `npm run validate` — full per-scenario sweep with hard gates.
- `npm run demo:build` / `demo:watch` / `demo:serve` — esbuild bundle +
  static server for `demo/`.
