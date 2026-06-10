import { clampChroma, formatHex, formatRgb } from 'culori';
import { TOKEN_NAMES, type Token, type Tokens, type TokenName } from './tokens.js';

export type CssToken = { oklch: string; fallback: string };

function fmt(n: number): string {
  // 4 decimals, trim trailing zeros and a trailing dot.
  const s = n.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
}

function wrapH(h: number): number {
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

export function toCss(token: Token): CssToken {
  const L = token.L;
  const C = token.C;
  const H = wrapH(token.H);
  const alpha = token.alpha;

  const oklch =
    alpha < 1
      ? `oklch(${fmt(L)} ${fmt(C)} ${fmt(H)} / ${fmt(alpha)})`
      : `oklch(${fmt(L)} ${fmt(C)} ${fmt(H)})`;

  // Gamut-map into sRGB by reducing chroma while preserving L and H.
  const clamped = clampChroma({ mode: 'oklch', l: L, c: C, h: H }, 'oklch');

  const fallback =
    alpha < 1
      ? formatRgb({ ...clamped, alpha })
      : formatHex(clamped);

  return { oklch, fallback };
}

export function tokensToCss(tokens: Tokens): Record<TokenName, CssToken> {
  const out = {} as Record<TokenName, CssToken>;
  for (const name of TOKEN_NAMES) {
    out[name] = toCss(tokens[name]);
  }
  return out;
}
