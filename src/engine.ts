import { getThemedTokens } from './hue.js';
import { tokensToCss } from './css.js';
import { TOKEN_NAMES, type TokenName } from './tokens.js';

// Token → CSS custom-prop name. Kept here (not in tokens.ts) because the
// kebab-case strings are an application-layer concern; tokens.ts deals in
// camelCase identifiers.
const TOKEN_CSS_VAR: Record<TokenName, string> = {
  background: '--bg',
  surface: '--surface',
  surfaceElevated: '--surface-elevated',
  border: '--border',
  bgGradientStop: '--bg-gradient-stop',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentSecondary: '--accent-secondary',
  shadow: '--shadow',
  glow: '--glow',
  ambientTint: '--ambient-tint',
  success: '--success',
  warning: '--warning',
  error: '--error',
  info: '--info',
};

export const CROSSOVER_VAR = '--crossover-proximity';

export type Location = { lat: number; lng: number };
export type Mode = 'auto' | 'manual';

export type EngineOptions = {
  root?: HTMLElement;
  // How often to recompute f(t) in auto mode. Tiny correct OKLCH steps + a
  // CSS transition smooths between them — DO NOT widen this and lean on the
  // browser to lerp colors across minutes (sRGB interpolation is the mush
  // OKLCH was built to avoid).
  intervalMs?: number;
  location?: Location;
  userHue?: number | null;
  blend?: number;
};

export class ThemeEngine {
  private root: HTMLElement;
  private intervalMs: number;
  private location: Location | undefined;
  private userHue: number | null;
  private blend: number;
  private mode: Mode = 'auto';
  private manualMinutes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: EngineOptions = {}) {
    this.root = opts.root ?? document.documentElement;
    this.intervalMs = opts.intervalMs ?? 2000;
    this.location = opts.location;
    this.userHue = opts.userHue ?? null;
    this.blend = opts.blend ?? 0;
  }

  // First paint runs IMMEDIATELY with the IST fallback (location undefined).
  // Location is opt-in via requestLocation() — the engine never prompts the
  // browser for geolocation on its own, so a public visitor sees no popup.
  start(): void {
    this.apply();
    this.timer = setInterval(() => {
      if (this.mode === 'auto') this.apply();
    }, this.intervalMs);
  }

  // Explicit location request. Triggers the browser's geolocation prompt;
  // on success, updates the location and recomputes. On denial / timeout /
  // unsupported browser, resolves to false and the IST fallback stays in
  // place — callers should reflect both outcomes in their UI.
  async requestLocation(): Promise<boolean> {
    const loc = await tryGeolocation();
    if (!loc) return false;
    this.setLocation(loc);
    return true;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setManual(minuteOfDay: number): void {
    this.mode = 'manual';
    this.manualMinutes = Math.max(0, Math.min(1439, Math.round(minuteOfDay)));
    this.apply();
  }

  clearManual(): void {
    this.mode = 'auto';
    this.apply();
  }

  getMode(): Mode {
    return this.mode;
  }

  getManualMinutes(): number {
    return this.manualMinutes;
  }

  getLocation(): Location | undefined {
    return this.location;
  }

  getUserHue(): number | null {
    return this.userHue;
  }

  getBlend(): number {
    return this.blend;
  }

  setUserHue(hue: number | null): void {
    this.userHue = hue;
    this.apply();
  }

  setBlend(blend: number): void {
    this.blend = Math.max(0, Math.min(1, blend));
    this.apply();
  }

  setLocation(loc: Location | undefined): void {
    this.location = loc;
    this.apply();
  }

  // Toggle transitions OFF for the next apply()s — used by interactive scrubs
  // (dial drag, slider drag) so updates feel instant rather than chasing a 2s
  // transition.
  setImmediate(on: boolean): void {
    if (on) this.root.setAttribute('data-immediate', '');
    else this.root.removeAttribute('data-immediate');
  }

  // Public so callers (e.g. the dial) can re-trigger after an external change.
  apply(): void {
    const when = this.currentTime();
    const tokens = getThemedTokens(when, this.location, {
      userHue: this.userHue,
      blend: this.blend,
    });
    const cssTokens = tokensToCss(tokens);
    const style = this.root.style;
    for (const name of TOKEN_NAMES) {
      style.setProperty(TOKEN_CSS_VAR[name], cssTokens[name].oklch);
    }
    style.setProperty(CROSSOVER_VAR, String(tokens.meta.crossoverProximity));
  }

  private currentTime(): Date {
    if (this.mode === 'manual') {
      const d = new Date();
      d.setHours(0, this.manualMinutes, 0, 0);
      return d;
    }
    return new Date();
  }
}

function tryGeolocation(): Promise<Location | undefined> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const timeoutMs = 4000;
    let done = false;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(undefined);
    }, timeoutMs + 200);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        resolve(undefined);
      },
      { timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    );
  });
}
