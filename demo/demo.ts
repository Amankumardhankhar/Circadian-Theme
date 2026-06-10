import { parse, oklch } from 'culori';
import { ThemeEngine } from '../src/engine.js';
import { ClockDial } from '../src/dial.js';

const engine = new ThemeEngine();
new ClockDial(engine);
engine.start();

// "Use my location" opt-in. The engine defaults to IST so this stays a click-
// only flow — no auto popup on page load. Returning visitors who already
// granted permission get an automatic re-request (the browser remembers the
// allow decision; localStorage just lets us skip showing the button).
const LOC_OPT_IN_KEY = 'circadian:loc-opt-in';
const locBtn = document.getElementById('use-my-location') as HTMLButtonElement | null;
if (locBtn) {
  const label = locBtn.querySelector<HTMLElement>('.btn-loc-label');
  const markActive = (): void => {
    locBtn.dataset.state = 'active';
    if (label) label.textContent = 'Using your location';
    locBtn.disabled = true;
    locBtn.hidden = true;
  };
  const attempt = async (persist: boolean): Promise<void> => {
    locBtn.disabled = true;
    if (label) label.textContent = 'Locating…';
    const ok = await engine.requestLocation();
    if (ok) {
      if (persist) {
        try { localStorage.setItem(LOC_OPT_IN_KEY, '1'); } catch { /* private mode */ }
      }
      markActive();
    } else {
      locBtn.disabled = false;
      if (label) label.textContent = 'Use my location';
    }
  };
  locBtn.addEventListener('click', () => { void attempt(true); });
  let previouslyOptedIn = false;
  try { previouslyOptedIn = localStorage.getItem(LOC_OPT_IN_KEY) === '1'; } catch { /* private mode */ }
  if (previouslyOptedIn) {
    void attempt(false);
  }
}

// Theme controls — Sky/Custom toggle + preset swatches + fine hue slider +
// strength slider, driving engine.setUserHue/setBlend. setImmediate(true)
// during slider drags so the page tracks the pointer instead of chasing a
// 2s transition.
type ThemeMode = 'sky' | 'custom';
const DEFAULT_HUE = 210;
const DEFAULT_BLEND = 0.7;

const controls = document.getElementById('theme-controls');
if (controls) {
  const modeBtns = controls.querySelectorAll<HTMLButtonElement>('[data-tc-mode]');
  const presetBtns = controls.querySelectorAll<HTMLButtonElement>('[data-tc-hue]');
  const hueSlider = controls.querySelector<HTMLInputElement>('#tc-hue')!;
  const strengthSlider = controls.querySelector<HTMLInputElement>('#tc-strength')!;
  const strengthReadout = controls.querySelector<HTMLElement>('#tc-strength-readout')!;
  const previewSwatch = controls.querySelector<HTMLElement>('#tc-preview-swatch')!;
  const previewTitle = controls.querySelector<HTMLElement>('#tc-preview-title')!;
  const previewMeta = controls.querySelector<HTMLElement>('#tc-preview-meta')!;

  let mode: ThemeMode = 'sky';
  let pendingHue = DEFAULT_HUE;
  let pendingBlend = DEFAULT_BLEND;

  const setActivePresetForHue = (hue: number | null): void => {
    presetBtns.forEach((b) => {
      const v = Number(b.dataset.tcHue);
      b.classList.toggle('is-active', hue !== null && v === hue);
    });
  };

  const setActiveMode = (m: ThemeMode): void => {
    modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.tcMode === m));
    controls.dataset.mode = m;
  };

  const updatePreview = (): void => {
    if (mode === 'sky') {
      previewSwatch.style.background = '';
      previewTitle.textContent = 'Sky';
      previewMeta.textContent = 'time-driven palette';
    } else {
      previewSwatch.style.background = `oklch(0.72 0.18 ${pendingHue})`;
      previewTitle.textContent = 'Custom';
      previewMeta.textContent = `h ${pendingHue}° · ${Math.round(pendingBlend * 100)}%`;
    }
  };

  const updateStrengthUI = (): void => {
    strengthSlider.disabled = mode === 'sky';
    strengthSlider.value = String(Math.round(pendingBlend * 100));
    strengthReadout.textContent = mode === 'sky' ? '—' : `${Math.round(pendingBlend * 100)}%`;
  };

  const applyToEngine = (): void => {
    if (mode === 'sky') {
      engine.setUserHue(null);
    } else {
      engine.setUserHue(pendingHue);
      engine.setBlend(pendingBlend);
    }
  };

  const enterSky = (): void => {
    mode = 'sky';
    setActiveMode('sky');
    setActivePresetForHue(null);
    updateStrengthUI();
    updatePreview();
    applyToEngine();
  };

  const enterCustom = (hue: number, blend?: number): void => {
    const wasInSky = mode === 'sky';
    mode = 'custom';
    pendingHue = hue;
    if (blend !== undefined) {
      pendingBlend = blend;
    } else if (wasInSky) {
      // First time picking Custom — start at the default strength so the
      // effect is visible without overwhelming the circadian palette.
      pendingBlend = DEFAULT_BLEND;
    }
    hueSlider.value = String(hue);
    setActiveMode('custom');
    setActivePresetForHue(hue);
    updateStrengthUI();
    updatePreview();
    applyToEngine();
  };

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.tcMode as ThemeMode;
      if (next === mode) return;
      if (next === 'sky') enterSky();
      else enterCustom(pendingHue);
    });
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const hue = Number(btn.dataset.tcHue);
      enterCustom(hue);
    });
  });

  // Hue slider — moving it from Sky mode is treated as "the user picked Custom".
  hueSlider.addEventListener('pointerdown', () => engine.setImmediate(true));
  const releaseHue = (): void => engine.setImmediate(false);
  hueSlider.addEventListener('pointerup', releaseHue);
  hueSlider.addEventListener('pointercancel', releaseHue);
  hueSlider.addEventListener('change', releaseHue);
  hueSlider.addEventListener('input', () => {
    const hue = Number(hueSlider.value);
    if (mode === 'sky') {
      enterCustom(hue);
    } else {
      pendingHue = hue;
      setActivePresetForHue(hue);
      updatePreview();
      applyToEngine();
    }
  });

  // Hex paste — culori parses any CSS color (hex, named, oklch(…), etc.).
  // Read the OKLCH hue and route through enterCustom so the first-time-from-
  // sky default strength (0.7) kicks in. Achromatic inputs have no hue —
  // surface a gentle inline note instead of guessing.
  const hexInput = controls.querySelector<HTMLInputElement>('#tc-hex')!;
  const hexMsg = controls.querySelector<HTMLElement>('#tc-hex-msg')!;
  const setHexMsg = (text: string, isError: boolean): void => {
    hexMsg.textContent = text;
    hexMsg.classList.toggle('is-error', isError);
  };
  const tryApplyHex = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setHexMsg('', false);
      return;
    }
    const parsed = parse(trimmed);
    if (!parsed) {
      setHexMsg('Not a valid color — try #3B82F6', true);
      return;
    }
    const lch = oklch(parsed);
    const h = lch && typeof lch.h === 'number' ? lch.h : null;
    if (h === null) {
      setHexMsg('That color has no hue — try a less grey one', true);
      return;
    }
    const hue = Math.round(((h % 360) + 360) % 360);
    setHexMsg('', false);
    enterCustom(hue);
  };
  hexInput.addEventListener('input', () => tryApplyHex(hexInput.value));

  // Strength slider — only meaningful in Custom mode (disabled in Sky).
  strengthSlider.addEventListener('pointerdown', () => engine.setImmediate(true));
  const releaseStrength = (): void => engine.setImmediate(false);
  strengthSlider.addEventListener('pointerup', releaseStrength);
  strengthSlider.addEventListener('pointercancel', releaseStrength);
  strengthSlider.addEventListener('change', releaseStrength);
  strengthSlider.addEventListener('input', () => {
    if (mode === 'sky') return;
    pendingBlend = Number(strengthSlider.value) / 100;
    strengthReadout.textContent = `${Math.round(pendingBlend * 100)}%`;
    updatePreview();
    applyToEngine();
  });

  // Reset wipes any user overrides and returns to live Sky.
  const resetBtn = controls.querySelector<HTMLButtonElement>('#tc-reset');
  resetBtn?.addEventListener('click', () => {
    engine.clearManual();
    pendingHue = DEFAULT_HUE;
    pendingBlend = DEFAULT_BLEND;
    hueSlider.value = String(DEFAULT_HUE);
    hexInput.value = '';
    setHexMsg('', false);
    enterSky();
  });

  // Initial paint (Sky mode — engine already has userHue=null).
  setActiveMode('sky');
  updateStrengthUI();
  updatePreview();
}

// Scroll/load reveal — demo.css sets [data-reveal] to opacity:0 +
// translateY(16px); this observer flips them into view as they enter the
// viewport.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion && typeof IntersectionObserver !== 'undefined') {
  const reveal = (el: Element) => el.classList.add('is-visible');

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
  );

  const targets = document.querySelectorAll('[data-reveal]');
  // Hero is above the fold — reveal on first paint so the page doesn't open
  // empty waiting for the observer.
  const heroSelector = '.hero[data-reveal]';
  targets.forEach((el) => {
    if (el.matches(heroSelector)) {
      requestAnimationFrame(() => requestAnimationFrame(() => reveal(el)));
    } else {
      io.observe(el);
    }
  });
} else {
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-visible'));
}
