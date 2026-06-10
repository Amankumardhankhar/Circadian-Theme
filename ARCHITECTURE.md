# Circadian Color Theme Engine — Architecture

A continuous, time-driven theme system. Not a list of colors — a pure function
`f(time, location, userHue, blend) → tokens` that generates the entire palette
for any instant of the day, smoothly.

---

## Core principles (do not violate)

1. **One function, two modes.** Auto mode and the clock toggle feed the *same*
   pipeline. The toggle just sets the time input by hand.
2. **All color math in OKLCH.** Never interpolate in RGB or HSL — you get grey
   mush. OKLCH gives perceptually uniform lightness and stable hue. Convert to
   sRGB only at the final output step.
3. **Comfort is decoupled from color.** Eye-comfort lives in *lightness +
   chroma + the warm/cool direction*, which are locked to the solar clock. Hue
   is the only thing the user can touch. This is why a user can pick any color
   and never break readability or night comfort.
4. **Everything is derived.** You author ~3 scalar curves (L, H, C) at ~10
   anchors plus a set of derivation rules. You never hand-pick the full token
   set. Adding a new token costs nothing.
5. **Robustness is earned, not assumed.** The engine *can* emit ugly/illegible
   frames at bad phases. Module 6 (validation) makes it mathematically
   incapable of doing so. No module ships without its acceptance test passing.

---

## Data flow

```
time + location ─▶ [M1] solar phase ─▶ [M2] (L,H,C) seeds ─▶ [M3] token set (OKLCH)
                                              ▲                        │
                            userHue, blend ─▶ [M5] hue override        ▼
                                                            [M4] OKLCH → sRGB + clamp
                                                                        │
                                                                        ▼
                                                  [M7] apply CSS vars + clock UI
                                                                        │
                                              [M6] validation harness (offline, all 1440 states)
```

## Locked design decisions

- **Full day/night inversion** (bright by day, dark by night).
- **Hue travels the full wheel**, oriented so warm lands in the evening and cool
  at bright midday (matches the real sky).
- **Solar-accurate** via geolocation; **IST fallback** when permission denied.
- **Default = sky mode; user can override hue** via a `userHue` + `blend` knob,
  with comfort (L/C) always locked.

## Recommended dependencies

- `suncalc` — sunrise/sunset/solar-noon/golden-hour times. Don't reimplement
  solar mechanics.
- `culori` — OKLCH parsing, conversion to sRGB, and gamut clamping
  (`clampChroma`). Tiny, well-maintained.

---

# Modules

Build in order. Each is a small, independently testable unit. When something
looks wrong later, you'll know exactly which module owns the bug.

## M1 — Solar phase

**Purpose:** turn a clock time + location into the set of anchor moments for
today, so the curves can be anchored to real sun events (not fixed clock hours).

**Input:** `now: Date`, `location?: {lat, lng}`
**Output:** an ordered ring of anchor timestamps for today:
`solarMidnight, dawn, sunrise, morning, solarNoon, afternoon, goldenHour,
sunset, dusk, night` → wraps back to next `solarMidnight`.

**Notes:**
- Use suncalc for `nadir` (solar midnight), `dawn`, `sunrise`, `solarNoon`,
  `goldenHour`, `sunset`, `dusk`. Derive `morning = sunrise + 2.5h`,
  `afternoon = solarNoon + 3h`, `night = sunset + 2.5h` if you want evenly felt
  spacing.
- Because anchors track the sun, daytime stretches in summer / compresses in
  winter automatically. 18:00 is bright in June, dark in December — correct.
- **IST fallback** (no location): fixed anchors —
  `midnight 00:00, dawn 05:30, sunrise 06:00, morning 08:30, noon 12:00,
  afternoon 15:00, goldenHour 18:00, sunset 18:45, dusk 19:15, night 21:00`.

**Acceptance test:** feed known dates/locations; assert sunrise/sunset match
published times within a few minutes. With no location, assert the IST anchors.
No color involved yet.

## M2 — Seed curves (L, H, C)

**Purpose:** at any instant, produce three scalars by smoothly interpolating
between the anchor values defined below.

**Interpolation:** Catmull-Rom spline on the *closed* ring (so 23:59→00:00 is
continuous and smooth, not just connected). Interpolate **hue along the shortest
angular path** — unwrap before splining, re-wrap after. Linear interpolation is
banned (visible kinks at anchors).

**Anchor values** (OKLCH; the L column was retuned to move sunrise/sunset OUT of the mid-grey legibility bad band — see "L retune" note below the table):

| anchor        | L (lightness) | H (hue°) | C (bg chroma) |
|---------------|---------------|----------|----------------|
| solarMidnight | 0.13          | 265      | 0.02           |
| dawn          | 0.42          | 320      | 0.04           |
| sunrise       | 0.70          | 25       | 0.06           |
| morning       | 0.90          | 60       | 0.04           |
| solarNoon     | 0.97          | 210      | 0.03           |
| afternoon     | 0.93          | 160      | 0.04           |
| goldenHour    | 0.75          | 40       | 0.07           |
| sunset        | 0.42          | 15       | 0.08           |
| dusk          | 0.28          | 330      | 0.05           |
| night         | 0.16          | 285      | 0.03           |

**L retune (vs earlier prototype anchors).** Earlier values were
`dawn 0.30, sunrise 0.55, sunset 0.50`. Both sunrise and sunset sat inside
the mid-grey legibility bad band (Lbg ∈ ~[0.47, 0.67] — the true sub-AAA
crossover region, NOT 0.5; see M3 polarity note). With anchors parked
there the spline loitered, producing ~47-min morning / ~25-min evening
sub-AAA windows. New anchors put sunrise at the band-edge top and sunset
below the band so the curve only TRANSITS the bad band between anchors.
`dawn` was raised 0.30→0.42 to keep the dawn→sunrise chord small enough
that peak dL/dt stays under the non-text adjacent-ΔE ceiling 0.02/min
(background's ΔE = ΔL, hard-capped). Windows shortened to ~14-18 min
morning / ~17-24 min evening. M3's `smoothPolarity` band and
`HEADROOM_BAND` were both widened in lockstep to absorb the steeper L
transit (see M3 note).

Hue journey: indigo night → pink dawn → orange sunrise → gold morning → cyan
noon → teal afternoon → amber golden hour → red-orange sunset → magenta dusk →
violet night. Travels the wheel, sky-plausible.

**Comfort rationale (so you don't "fix" it later):** the critical eye-comfort
window is golden hour → dusk — luminance is still significant, so hue shifts
warm and chroma stays modest there. *Deep night relies on low luminance itself*
— a near-black pixel emits almost nothing, so the cool indigo hue is fine and
reads as a premium dark. The lightness curve passes through the ambiguous
mid-zone (≈0.45–0.6) **fast**, at sunrise and sunset only, so text legibility is
never stuck in limbo.

**Acceptance test:** plot all three curves across 24h. Assert smooth (C1
continuous), wraps cleanly, and hits each anchor value. Still no full palette.

## M3 — Token derivation

**Purpose:** turn `(Lbg, Hbg, Cbg)` for the moment into the full token set, by
rule. `polarity = Lbg < 0.5 ? 'dark' : 'light'`; `dir = dark ? +1 : -1`.

Backgrounds / surfaces:
- `background     = oklch(Lbg, Cbg, Hbg)`
- `surface        = oklch(Lbg + dir*0.04, Cbg*1.1, Hbg)`
- `surfaceElevated= oklch(Lbg + dir*0.08, Cbg*1.1, Hbg)`
- `border         = oklch(Lbg + dir*0.14, Cbg*0.8, Hbg)`
- `bgGradientStop = oklch(Lbg + dir*0.02, Cbg, Hbg + 15)`  (subtle two-tone)

Text (**contrast-driven, not authored**):
- `textPrimary`: pick L so contrast vs background meets target (WCAG ≥ 7:1, or
  APCA ≥ 60). Keep chroma ~0.015 and hue = Hbg → tinted near-black/white, not
  pure (premium). Iterate L until the target is met.
- `textSecondary`: target ~4.5:1 (mix ~35% toward background).
- `textMuted`: ~60% toward background.

Accent family (chroma reserved higher, `accentC ≈ 0.15`):
- `accent      = oklch(dark ? 0.72 : 0.55, accentC, Hbg + 150)`  (offset for pop)
- `accentHover = accent with L nudged +dir*0.06, C +0.02`
- `accentSecondary = oklch(..., accentC, Hbg + 190)`

Depth (the premium touch — **never pure black/white**):
- `shadow = oklch(max(Lbg-0.6, 0.05), Cbg*1.5, Hbg)` applied at ~35% alpha →
  ambient-tinted shadow (warm at sunset, cool at noon).
- `glow   = oklch(0.85, accentC*0.8, Hbg+150)` applied at ~20% alpha.
- `ambientTint = oklch(Lbg, Cbg*0.5, Hbg)`

Semantic (success 145, warning 75, error 25, info 240): keep the identity hue,
but pull L toward polarity and nudge hue ~10% toward Hbg so they harmonize with
the time of day instead of clashing.

**Acceptance test:** for a few moments (noon, sunset, midnight), print all
tokens and assert the relationships hold and contrast targets are met.

## M4 — OKLCH → sRGB + gamut clamp

**Purpose:** safe output. Either emit `oklch()` strings directly (modern
browsers clamp), or convert via culori `clampChroma(color, 'oklch')` then
`formatHex`. Provide a hex fallback for older browsers.

**Acceptance test:** known colors round-trip; every emitted color is in-gamut;
no `NaN`.

## M5 — User hue override

**Purpose:** let the user bias toward a chosen color without touching comfort.

- `userHue` null → **sky mode**, use `Hsky(t)` directly.
- Otherwise **brand mode**: sky contributes only a *relative* warm/cool breath:
  `skyDelta = unwrap(Hsky(t) - HskyDailyMean)`
  `Hbrand   = userHue + clamp(skyDelta * 0.15, -40, +40)`
- `Hfinal(t) = angleLerp(Hsky(t), Hbrand(t), blend)`  — `blend` 0..1, default 0.
- **L and C curves are unchanged by the override.** Accent chroma in brand mode
  still clamped to `accentC(t)`. Comfort stays locked no matter the hue.

**Acceptance test:** `blend=0` exactly reproduces sky mode; `blend=1` locks hue
near `userHue` (±40° sky breathing); legibility/contrast still pass at all times.

## M6 — Validation harness (offline)

**Purpose:** the robustness guarantee. Run before every release.

Loop `t` over all 1440 minutes (× a few `userHue`/`blend` samples) and assert:
- `contrast(textPrimary, background) ≥ target` for every minute
- `contrast(textSecondary, surface) ≥ 4.5` for every minute
- every color in-gamut after clamp, no `NaN`
- adjacent-minute OKLab ΔE below a smoothness ceiling (no visible jumps)

Also render a **filmstrip** (all states as one image/HTML strip) for eyeball QA.
Build fails if any assertion fails.

**Acceptance test:** harness runs green; filmstrip shows a smooth loop with no
muddy or unreadable frames.

## M7 — Application + clock UI

**Purpose:** wire the engine into the DOM and give the user the dial.

- `ThemeEngine.apply()` computes tokens for the current input and sets CSS custom
  properties on `:root` (`--bg`, `--surface`, `--text`, `--accent`, …) as
  color strings. Re-run on an interval (~30s) or throttled rAF.
- **Register the props with `@property` as `<color>`** so CSS `transition` can
  animate them — plain custom properties don't animate. This gives buttery
  interpolation between updates for free.
- **Clock toggle:** circular control. State `{ mode: 'auto' | 'manual',
  manualMinutes }`. Dragging sets `manualMinutes` (0–1439) → feeds the same
  pipeline. "Auto" returns to live time. Same `f(t)`, no separate path.

**Acceptance test:** rotating the dial sweeps the whole palette smoothly; toggling
auto snaps back to current time; transitions don't flash or jump.

---

## Dependency order

`M1 → M2 → M3 → M4 → M5 → M6 → M7`. Each module is independently testable;
later modules consume earlier ones. The dial UI (M7) is meaningless until the
engine underneath is sound, so every module's acceptance test must pass before
the next one is built on top of it.

See `INTEGRATION.md` for how to consume the engine from a real application —
both the DOM/CSS path and the WebGL/R3F path — plus the load-bearing
invariants any wrapper must preserve.
