// Self-contained "day ring" clock dial. Mounts to the host (default:
// document.body), reads everything it needs from a ThemeEngine, and styles
// itself with the engine's CSS vars (--bg/--surface/--border/--text-primary/
// --accent/--glow/--shadow) so it re-themes with the site it controls.
//
// Assumes the host page has @property-registered the engine's color vars
// (see demo/theme.css for the canonical registration list).

import { getThemedTokens } from './hue.js';
import { getSolarAnchors } from './solar.js';
import { toCss } from './css.js';
import type { ThemeEngine, Mode } from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'clock-dial-styles';

const DIAL_CSS = `
.clock-dial {
  --dial-size: 280px;
  --dial-ring-w: 28px;
  position: fixed;
  right: 2rem;
  top: 50%;
  margin-top: calc(var(--dial-size) / -2);
  width: var(--dial-size);
  height: var(--dial-size);
  z-index: 100;
  user-select: none;
  touch-action: none;
  outline: none;
  border-radius: 50%;
  /* Softer dormant baseline — the dial is now a centerpiece, not a hint,
   * so it stays clearly recognizable at rest. Wake still sharpens + lifts. */
  opacity: 0.72;
  filter: blur(1.2px) saturate(1);
  transform: scale(0.96);
  transform-origin: center;
  transition:
    opacity 280ms cubic-bezier(.2,.7,.2,1),
    filter 280ms cubic-bezier(.2,.7,.2,1),
    transform 280ms cubic-bezier(.2,.7,.2,1),
    box-shadow 280ms cubic-bezier(.2,.7,.2,1);
  box-shadow:
    0 14px 40px -6px var(--shadow),
    0 0 32px -4px var(--glow);
}
.clock-dial:hover,
.clock-dial:focus-within,
.clock-dial.is-active {
  opacity: 1;
  filter: blur(0) saturate(1.05);
  transform: scale(1.04);
  box-shadow:
    0 28px 70px -10px var(--shadow),
    0 0 80px -8px var(--glow);
}
@media (max-width: 960px) {
  .clock-dial {
    --dial-size: 180px;
    --dial-ring-w: 18px;
    top: auto;
    bottom: 1.5rem;
    right: 1.25rem;
    margin-top: 0;
    opacity: 0.6;
  }
}
.clock-dial__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, oklch(0.5 0 0), oklch(0.5 0 0));
  -webkit-mask: radial-gradient(circle closest-side,
    transparent calc(100% - var(--dial-ring-w)),
    #000 calc(100% - var(--dial-ring-w) + 1px),
    #000 100%,
    transparent calc(100% + 1px));
          mask: radial-gradient(circle closest-side,
    transparent calc(100% - var(--dial-ring-w)),
    #000 calc(100% - var(--dial-ring-w) + 1px),
    #000 100%,
    transparent calc(100% + 1px));
}
.clock-dial__overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.clock-dial__notch {
  stroke: var(--text-primary);
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.6;
  vector-effect: non-scaling-stroke;
}
.clock-dial__handle {
  fill: var(--accent);
  stroke: var(--bg);
  stroke-width: 2;
  filter: drop-shadow(0 0 6px var(--glow));
  transition: filter 250ms cubic-bezier(.2,.7,.2,1);
}
.clock-dial:hover .clock-dial__handle,
.clock-dial.is-active .clock-dial__handle,
.clock-dial:focus-within .clock-dial__handle {
  filter: drop-shadow(0 0 14px var(--glow));
}
.clock-dial__handle-g {
  transition: transform 220ms cubic-bezier(.2,.7,.2,1);
}
.clock-dial.is-dragging .clock-dial__handle-g {
  transition: none;
}
.clock-dial__center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(var(--dial-size) - var(--dial-ring-w) * 2 - 14px);
  height: calc(var(--dial-size) - var(--dial-ring-w) * 2 - 14px);
  border-radius: 50%;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  font: inherit;
  font-variant-numeric: tabular-nums;
  transition: background-color 200ms linear, border-color 200ms linear;
}
.clock-dial__center:hover { background: var(--surface); }
.clock-dial__center:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.clock-dial__time {
  font-size: calc(var(--dial-size) * 0.17);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
}
.clock-dial__state {
  font-size: calc(var(--dial-size) * 0.058);
  letter-spacing: 0.22em;
  color: var(--text-muted);
  line-height: 1;
}
.clock-dial[data-mode="manual"] .clock-dial__state {
  color: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .clock-dial { transition: opacity 0ms, filter 0ms, transform 0ms, box-shadow 0ms; }
  .clock-dial__handle-g { transition: none; }
}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = DIAL_CSS;
  document.head.appendChild(s);
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function dateLocalMinuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Noon (720) at the TOP, midnight (0/1440) at the BOTTOM, time CW. The CSS
// conic-gradient defaults `from 0deg` to the top going CW, so the same angle
// formula drives both the handle rotation and the gradient stops.
function minuteToAngleDeg(minute: number): number {
  return ((minute - 720) / 1440) * 360;
}

function angleToMinute(angleDeg: number): number {
  let m = 720 + angleDeg * 4;
  m = ((m % 1440) + 1440) % 1440;
  return m;
}

export type DialOptions = {
  host?: HTMLElement;
  size?: number;
  ringWidth?: number;
  // Color samples around the ring. 360 → one stop every 4 min, smooth enough
  // that you can't see the steps and cheap enough to recompute once a day.
  samples?: number;
};

export class ClockDial {
  private engine: ThemeEngine;
  private host: HTMLElement;
  private size: number;
  private ringWidth: number;
  private samples: number;
  // When callers explicitly pass opts.size / opts.ringWidth we want to honor
  // them via inline style; otherwise we leave the CSS class (and its @media
  // mobile-shrink rule) in charge of the values.
  private sizeOverridden: boolean;
  private ringWidthOverridden: boolean;

  private root!: HTMLElement;
  private ringEl!: HTMLElement;
  private overlay!: SVGSVGElement;
  private handleG!: SVGGElement;
  private sunriseNotch!: SVGLineElement;
  private sunsetNotch!: SVGLineElement;
  private centerBtn!: HTMLButtonElement;
  private timeLabel!: HTMLElement;
  private stateLabel!: HTMLElement;

  private dailyKey = '';
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private dragging = false;
  private pointerId: number | null = null;
  private outsideHandler: ((e: PointerEvent) => void) | null = null;

  constructor(engine: ThemeEngine, opts: DialOptions = {}) {
    ensureStyles();
    this.engine = engine;
    this.host = opts.host ?? document.body;
    this.size = opts.size ?? 280;
    this.ringWidth = opts.ringWidth ?? 28;
    this.samples = opts.samples ?? 360;
    this.sizeOverridden = opts.size != null;
    this.ringWidthOverridden = opts.ringWidth != null;
    this.build();
    this.rebuild();
    this.tick();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  // Public so the demo (or real site) can force a repaint after changing
  // userHue / blend / location on the engine. Otherwise the dial picks up
  // those changes on the next 1s tick via dailyKey.
  rebuild(): void {
    this.repaintRing();
    this.repaintNotches();
    this.dailyKey = this.computeDailyKey();
  }

  destroy(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.outsideHandler) {
      document.removeEventListener('pointerdown', this.outsideHandler, true);
      this.outsideHandler = null;
    }
    this.root.remove();
  }

  // ---- DOM build -----------------------------------------------------

  private build(): void {
    const root = document.createElement('div');
    root.className = 'clock-dial';
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Clock dial. Drag around the ring to scrub time; tap the centre to return to now.');
    // Only push inline overrides when the caller diverged from defaults —
    // otherwise leave CSS (including the responsive @media rule) in charge.
    if (this.sizeOverridden) root.style.setProperty('--dial-size', `${this.size}px`);
    if (this.ringWidthOverridden) root.style.setProperty('--dial-ring-w', `${this.ringWidth}px`);

    const ringEl = document.createElement('div');
    ringEl.className = 'clock-dial__ring';

    const overlay = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    overlay.setAttribute('class', 'clock-dial__overlay');
    overlay.setAttribute('viewBox', `0 0 ${this.size} ${this.size}`);
    overlay.setAttribute('aria-hidden', 'true');

    const cx = this.size / 2;
    const cy = this.size / 2;
    const rOuter = this.size / 2;
    const rInner = this.size / 2 - this.ringWidth;
    const rMid = (rOuter + rInner) / 2;

    const sunriseNotch = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
    sunriseNotch.setAttribute('class', 'clock-dial__notch');
    sunriseNotch.setAttribute('x1', String(cx));
    sunriseNotch.setAttribute('y1', String(cy - rOuter - 3));
    sunriseNotch.setAttribute('x2', String(cx));
    sunriseNotch.setAttribute('y2', String(cy - rInner + 3));

    const sunsetNotch = document.createElementNS(SVG_NS, 'line') as SVGLineElement;
    sunsetNotch.setAttribute('class', 'clock-dial__notch');
    sunsetNotch.setAttribute('x1', String(cx));
    sunsetNotch.setAttribute('y1', String(cy - rOuter - 3));
    sunsetNotch.setAttribute('x2', String(cx));
    sunsetNotch.setAttribute('y2', String(cy - rInner + 3));

    overlay.appendChild(sunriseNotch);
    overlay.appendChild(sunsetNotch);

    const handleG = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    handleG.setAttribute('class', 'clock-dial__handle-g');
    const handleCircle = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    handleCircle.setAttribute('class', 'clock-dial__handle');
    handleCircle.setAttribute('cx', String(cx));
    handleCircle.setAttribute('cy', String(cy - rMid));
    handleCircle.setAttribute('r', String(this.ringWidth * 0.55));
    handleG.appendChild(handleCircle);
    overlay.appendChild(handleG);

    const center = document.createElement('button');
    center.className = 'clock-dial__center';
    center.type = 'button';

    const timeLabel = document.createElement('div');
    timeLabel.className = 'clock-dial__time';
    timeLabel.textContent = '--:--';

    const stateLabel = document.createElement('div');
    stateLabel.className = 'clock-dial__state';
    stateLabel.textContent = 'LIVE';

    center.appendChild(timeLabel);
    center.appendChild(stateLabel);

    root.appendChild(ringEl);
    root.appendChild(overlay);
    root.appendChild(center);

    this.host.appendChild(root);

    this.root = root;
    this.ringEl = ringEl;
    this.overlay = overlay;
    this.handleG = handleG;
    this.sunriseNotch = sunriseNotch;
    this.sunsetNotch = sunsetNotch;
    this.centerBtn = center;
    this.timeLabel = timeLabel;
    this.stateLabel = stateLabel;

    this.bindInteractions();
  }

  // ---- ring repaint --------------------------------------------------

  private computeDailyKey(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const loc = this.engine.getLocation();
    return [
      d.getTime(),
      loc ? `${loc.lat.toFixed(3)},${loc.lng.toFixed(3)}` : 'ist',
      this.engine.getUserHue(),
      this.engine.getBlend(),
    ].join('|');
  }

  private repaintRing(): void {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const loc = this.engine.getLocation();
    const userHue = this.engine.getUserHue();
    const blend = this.engine.getBlend();
    const N = this.samples;
    const stops: string[] = [];
    for (let i = 0; i <= N; i++) {
      // i=0 → noon (top), i=N/2 → midnight (bottom), i=N → noon (closes the ring).
      const m = ((720 + (i / N) * 1440) % 1440 + 1440) % 1440;
      const t = new Date(midnight.getTime() + m * 60_000);
      const themed = getThemedTokens(t, loc, { userHue, blend });
      stops.push(`${toCss(themed.background).oklch} ${((i / N) * 100).toFixed(3)}%`);
    }
    this.ringEl.style.background = `conic-gradient(from 0deg, ${stops.join(', ')})`;
  }

  private repaintNotches(): void {
    // Midday reference keeps us safely past today's nadir so getSolarAnchors
    // returns today's ring, not yesterday's wrap-around.
    const ref = new Date();
    ref.setHours(12, 0, 0, 0);
    const loc = this.engine.getLocation();
    const anchors = getSolarAnchors(ref, loc);
    const sunrise = anchors.find((a) => a.name === 'sunrise');
    const sunset = anchors.find((a) => a.name === 'sunset');
    if (sunrise) this.placeNotch(this.sunriseNotch, dateLocalMinuteOfDay(sunrise.time));
    if (sunset) this.placeNotch(this.sunsetNotch, dateLocalMinuteOfDay(sunset.time));
  }

  private placeNotch(line: SVGLineElement, minute: number): void {
    const angle = minuteToAngleDeg(minute);
    const cx = this.size / 2;
    const cy = this.size / 2;
    line.setAttribute('transform', `rotate(${angle.toFixed(3)} ${cx} ${cy})`);
  }

  // ---- interaction ---------------------------------------------------

  private bindInteractions(): void {
    const onDown = (e: PointerEvent) => {
      // The center button has its own click handler; pointerdown there just
      // wakes the dial (touch path) without starting a scrub.
      if ((e.target as Element).closest('.clock-dial__center')) {
        this.wake();
        return;
      }
      e.preventDefault();
      try { this.root.setPointerCapture(e.pointerId); } catch { /* unsupported in some test envs */ }
      this.pointerId = e.pointerId;
      this.dragging = true;
      this.root.classList.add('is-dragging');
      this.engine.setImmediate(true);
      this.wake();
      this.applyPointer(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      this.applyPointer(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = null;
      this.root.classList.remove('is-dragging');
      this.engine.setImmediate(false);
      try { this.root.releasePointerCapture(e.pointerId); } catch { /* */ }
    };
    this.root.addEventListener('pointerdown', onDown);
    this.root.addEventListener('pointermove', onMove);
    this.root.addEventListener('pointerup', onUp);
    this.root.addEventListener('pointercancel', onUp);

    this.centerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.engine.clearManual();
      this.tick();
    });

    this.root.addEventListener('focusin', () => this.wake());
    this.root.addEventListener('focusout', () => {
      // Defer one tick: if focus is moving to a child, or the pointer is still
      // hovering, don't put us back to sleep.
      setTimeout(() => {
        if (this.dragging) return;
        if (this.root.matches(':hover')) return;
        if (this.root.contains(document.activeElement)) return;
        this.sleep();
      }, 0);
    });

    // Touch path: outside-tap sleeps the dial. Capture phase so it fires
    // before any other handler that might re-wake it.
    this.outsideHandler = (e) => {
      if (this.root.contains(e.target as Node)) return;
      this.sleep();
    };
    document.addEventListener('pointerdown', this.outsideHandler, true);
  }

  private wake(): void {
    this.root.classList.add('is-active');
  }

  private sleep(): void {
    if (this.dragging) return;
    this.root.classList.remove('is-active');
  }

  private applyPointer(e: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx === 0 && dy === 0) return;
    // atan2(x, -y) → 0 at the top going CW: +90° right, 180° bottom, -90° left.
    const angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const minute = angleToMinute(angleDeg);
    this.engine.setManual(minute);
    this.setHandleAngle(angleDeg);
    this.updateLabels(minute, 'manual');
  }

  // ---- tick ----------------------------------------------------------

  private tick(): void {
    const key = this.computeDailyKey();
    if (key !== this.dailyKey) this.rebuild();

    const mode = this.engine.getMode();
    let minute: number;
    if (mode === 'manual') {
      minute = this.engine.getManualMinutes();
    } else {
      const now = new Date();
      minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    }
    if (!this.dragging) {
      this.setHandleAngle(minuteToAngleDeg(minute));
    }
    this.updateLabels(minute, mode);
  }

  private setHandleAngle(angleDeg: number): void {
    const cx = this.size / 2;
    const cy = this.size / 2;
    this.handleG.setAttribute('transform', `rotate(${angleDeg.toFixed(3)} ${cx} ${cy})`);
  }

  private updateLabels(minute: number, mode: Mode): void {
    const total = Math.floor(minute);
    const hh = pad2(Math.floor(total / 60) % 24);
    const mm = pad2(total % 60);
    this.timeLabel.textContent = `${hh}:${mm}`;
    this.stateLabel.textContent = mode === 'auto' ? 'LIVE' : 'MANUAL';
    this.root.dataset.mode = mode;
  }
}
