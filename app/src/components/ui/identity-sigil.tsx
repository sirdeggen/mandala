import { SIGIL_SYMBOLS } from "@/components/ui/sigil-symbols";
import type { ReactNode } from "react";

/**
 * Deterministic identity sigil built from the real @urbit/sigil-js symbols
 * (base shape + detail linework). Four full-cell urbit glyphs are chosen from
 * a hash of the key and laid out in a 2×2 grid - bright shapes on a soft
 * tinted ground. Pure + SSR-safe (no @p needed; hashes the full key).
 */

// 16 harmonious palette colors (Tailwind ~600) used for the sigil shapes.
const PALETTE = [
  "#4f46e5", "#7c3aed", "#9333ea", "#c026d3",
  "#db2777", "#e11d48", "#dc2626", "#ea580c",
  "#d97706", "#ca8a04", "#16a34a", "#059669",
  "#0d9488", "#0891b2", "#0ea5e9", "#2563eb",
];

/** FNV-1a 32-bit hash - deterministic, no impurity. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mix a hex color toward white by `amount` (0–1) for a soft tinted ground. */
function tintToWhite(hex: string, amount: number): string {
  const channel = (start: number): number => {
    const c = parseInt(hex.slice(start, start + 2), 16);
    return Math.round(c + (255 - c) * amount);
  };
  return `rgb(${channel(1)} ${channel(3)} ${channel(5)})`;
}

/** Fill a symbol's placeholders and wrap it in a positioned cell group. */
function cell(symbol: string, transform: string, fg: string, bg: string): string {
  const body = symbol
    .replaceAll("@FG", fg)
    .replaceAll("@BG", bg)
    .replaceAll("@SW", "3");
  return `<g transform="${transform}">${body}</g>`;
}

export function IdentitySigil({
  value,
  size = 28,
  className = "",
}: {
  value: string;
  size?: number;
  className?: string;
}): ReactNode {
  // Four independent hashes → four cells of the 2×2 sigil.
  const h = [
    fnv1a(value),
    fnv1a(`s1:${value}`),
    fnv1a(`s2:${value}`),
    fnv1a(`s3:${value}`),
  ];
  const fg = PALETTE[h[0]! % PALETTE.length]!;
  const ground = tintToWhite(fg, 0.86);
  const sym = (n: number): string =>
    SIGIL_SYMBOLS[(n >>> 4) % SIGIL_SYMBOLS.length]!;

  const cells =
    cell(sym(h[0]!), "translate(0 0)", fg, ground) +
    cell(sym(h[1]!), "translate(128 0)", fg, ground) +
    cell(sym(h[2]!), "translate(0 128)", fg, ground) +
    cell(sym(h[3]!), "translate(128 128)", fg, ground);
  const inner = `<rect width="256" height="256" fill="${ground}"/>` + cells;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
