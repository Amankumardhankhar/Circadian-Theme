# Changelog

Notable changes to the circadian theme engine. Cross-references:
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for design, [`INTEGRATION.md`](./INTEGRATION.md)
for how to consume the engine from a real application.

## Engine

- **Solar phase** (`src/solar.ts`) — `getSolarAnchors(now, location?)` returns
  the ordered ring of sun-event timestamps for the day; IST fallback when
  geolocation is unavailable.
- **Seed curves** (`src/seeds.ts`) — `getSeeds(now, location?)` and
  `exportSeedsCsv(...)`. C1 Hermite spline over the closed solar ring.
  L anchors are placed outside the mid-grey legibility band (sunrise 0.70,
  sunset 0.42; dawn 0.42) so the bad band is only transited, never parked in.
- **Token derivation** (`src/tokens.ts`) — `deriveTokens`, `getTokens`,
  `solveTextTokens`, `TOKEN_NAMES`, `meta.crossoverProximity`.
  Polarity smoothstep band W = 0.60; text-headroom band = 4.0.
- **OKLCH → sRGB** (`src/css.ts`) — `toCss`, `tokensToCss` emit `oklch(...)`
  + a `clampChroma`-mapped hex/rgba fallback.
- **User hue override** (`src/hue.ts`) — `resolveHue`, `getThemedTokens`
  with sinusoidal sky-breath and per-token OKLab Cartesian blend
  (continuous across both hue antipodes).

## Validation

- `test/validate.test.ts` sweeps scenarios A–G across all 1440 minutes and
  enforces hard gates (non-text adjacent-minute ΔE ≤ 0.02, exactly 2 text
  flips per token per day, gamut/NaN cleanliness, sub-AAA window
  contiguity). Writes `out/validation-report.txt` + `out/filmstrip.html`.
- AA (4.5:1) is met every minute in every scenario (worst ≈ 4.50). Robust
  sub-AAA crossover windows are roughly 15–18 min morning / 17–24 min
  evening — the irreducible polarity band, documented, not a bug.

## Application layer

- **ThemeEngine** (`src/engine.ts`) — start/stop, setManual/clearManual,
  setUserHue/setBlend, setImmediate, and getters. Paints synchronously
  on `start()` with IST anchors and upgrades to real geolocation in the
  background.
- **ClockDial** (`src/dial.ts`) — self-contained scrub UI. Reads the engine's
  CSS vars so it re-themes with the host page.
- **theme.css registration** (`demo/theme.css`) — `@property` registration
  for every token plus the explicit non-text transition list. Text vars are
  deliberately not transitioned (the polarity flip is irreducible).

## Demo page

- Glass landing page (`demo/index.html`, `demo/demo.css`, `demo/demo.ts`):
  sticky glass nav, hero, "How it works" explainer with an inline SVG flow
  diagram themed off the engine's tokens, four feature cards, dial callout
  panel, crossover footnote, and footer.
- Theme controls: Sky / Custom mode toggle, 7 preset swatches, hue slider,
  hex-paste input, strength slider, live preview, and reset button. Slider
  drags wrap in `setImmediate(true/false)` so the page tracks the pointer
  instead of chasing the 2 s transition.
- esbuild bundle: `demo/demo.ts` → `demo/demo.js`. Static server on
  `http://localhost:5173` via `npm run demo:serve`.

## Scripts

- `npm test` — runs the solar / seeds / tokens / css / hue unit suites.
- `npm run validate` — full per-scenario sweep with hard gates.
- `npm run demo:build` / `demo:watch` / `demo:serve`.

## Output artifacts

- `out/seeds_delhi_2024-06-21.csv`, `out/seeds_ist_2024-03-15.csv` —
  written by `seeds.test.ts` via `exportSeedsCsv`.
- `out/validation-report.txt` — full per-scenario validation report.
- `out/filmstrip.html` — 1440-minute SVG day strip (scenario C).
