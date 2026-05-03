// Central theme system — single source of truth for all palette values.
// UI components never compute colours directly; they call applyTheme() or
// read from NAMED_THEMES for display purposes only.

export type ThemeName = 'warm' | 'cool' | 'forest' | 'violet' | 'custom';

export interface ThemeConfig {
  label: string;
  /** Six background lightness levels (bg-0 ... bg-5) */
  L: [number, number, number, number, number, number];
  /** Chroma for background and border tints */
  c: number;
  /** Default hue angle (0-360, oklch H) */
  hue: number;
}

export const NAMED_THEMES: Record<Exclude<ThemeName, 'custom'>, ThemeConfig> = {
  warm:   { label: 'Warm',   L: [0.09, 0.12, 0.15, 0.18, 0.21, 0.25], c: 0.025, hue: 28  },
  cool:   { label: 'Cool',   L: [0.09, 0.12, 0.15, 0.18, 0.21, 0.25], c: 0.018, hue: 220 },
  forest: { label: 'Forest', L: [0.08, 0.11, 0.14, 0.17, 0.20, 0.24], c: 0.015, hue: 140 },
  violet: { label: 'Violet', L: [0.08, 0.11, 0.14, 0.17, 0.20, 0.24], c: 0.015, hue: 280 },
};

// Mutable custom slot — seeded from 'warm', updated by writeCustomHue().
const _custom: ThemeConfig = { ...NAMED_THEMES.warm, label: 'Custom' };

/**
 * Update the CUSTOM slot. Pass `base` to re-derive L/c from a named theme
 * (used when the user first moves the slider while a named theme is active).
 * Omit `base` to keep the existing L/c and only update the hue.
 */
export function writeCustomHue(hue: number, base?: Exclude<ThemeName, 'custom'>): void {
  if (base) {
    Object.assign(_custom, { ...NAMED_THEMES[base], label: 'Custom', hue });
  } else {
    _custom.hue = hue;
  }
}

/** Apply a theme palette to the document's CSS custom properties. */
export function applyTheme(name: ThemeName, hue?: number): void {
  const cfg  = name === 'custom' ? _custom : NAMED_THEMES[name];
  const h    = hue ?? cfg.hue;
  const root = document.documentElement;

  // Use DaisyUI v5's built-in dark theme as structural base; we override
  // all colour vars below so the exact base doesn't matter visually.
  root.setAttribute('data-theme', 'dark');

  // Our own CSS vars — used by mm-* Tailwind utilities and inline styles
  for (let i = 0; i < 6; i++) {
    root.style.setProperty(`--bg-${i}`, `oklch(${cfg.L[i]} ${i === 0 ? 0.02 : cfg.c} ${h})`);
  }
  root.style.setProperty('--accent',       `oklch(0.62 0.15 ${h})`);
  root.style.setProperty('--accent-light', `oklch(0.72 0.14 ${h})`);
  root.style.setProperty('--accent-dim',   `oklch(0.38 0.10 ${h})`);
  root.style.setProperty('--border-0',     `oklch(0.18 0.025 ${h})`);
  root.style.setProperty('--border-1',     `oklch(0.22 0.03  ${h})`);
  root.style.setProperty('--border-2',     `oklch(0.30 0.04  ${h})`);
  root.style.setProperty('--text-0',       `oklch(0.90 0.02  ${h})`);
  root.style.setProperty('--text-1',       `oklch(0.62 0.06  ${h})`);
  root.style.setProperty('--text-2',       `oklch(0.48 0.05  ${h})`);
  root.style.setProperty('--text-3',       `oklch(0.35 0.04  ${h})`);

  // DaisyUI v5 vars — full oklch() values (v4 used bare channels)
  root.style.setProperty('--color-primary',          `oklch(0.62 0.15 ${h})`);
  root.style.setProperty('--color-primary-content',  `oklch(0.90 0.02 ${h})`);
  root.style.setProperty('--color-base-100',         `oklch(${cfg.L[1]} ${cfg.c} ${h})`);
  root.style.setProperty('--color-base-200',         `oklch(${cfg.L[2]} ${cfg.c} ${h})`);
  root.style.setProperty('--color-base-300',         `oklch(${cfg.L[3]} ${cfg.c} ${h})`);
  root.style.setProperty('--color-base-content',     `oklch(0.85 0.03 ${h})`);
  root.style.setProperty('--color-neutral',          `oklch(${cfg.L[3]} ${cfg.c} ${h})`);
  root.style.setProperty('--color-neutral-content',  `oklch(0.62 0.06 ${h})`);

  // Tight radii and flat depth — native desktop feel, no raised/shadowed buttons
  root.style.setProperty('--radius-selector', '0.375rem');
  root.style.setProperty('--radius-field',    '0.25rem');
  root.style.setProperty('--radius-box',      '0.5rem');
  root.style.setProperty('--depth',           '0');    // removes v5 raised button shadows
  root.style.setProperty('--noise',           '0');    // no noise texture
}
