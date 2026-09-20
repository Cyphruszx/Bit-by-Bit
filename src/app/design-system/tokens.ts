export type ColorToken = {
  name: string;
  /** Tailwind background class bound to the theme colour. */
  swatchClass: string;
  /** Custom property declared on `@theme` or `:root` in globals.css. */
  cssVar: string;
  bordered?: boolean;
  /** Named exception — not for money direction or everyday chrome. */
  exception?: boolean;
};

export const colourTokens: ColorToken[] = [
  { name: "Primary / brand", swatchClass: "bg-primary", cssVar: "--color-primary" },
  { name: "Primary strong", swatchClass: "bg-primary-strong", cssVar: "--color-primary-strong" },
  { name: "Secondary / 400", swatchClass: "bg-secondary", cssVar: "--color-secondary" },
  { name: "Chart 300", swatchClass: "bg-chart-4", cssVar: "--color-chart-4" },
  { name: "Accent tint", swatchClass: "bg-accent-surface", cssVar: "--color-accent-surface", bordered: true },
  { name: "Positive", swatchClass: "bg-positive", cssVar: "--color-positive" },
  { name: "Ink", swatchClass: "bg-ink", cssVar: "--color-ink" },
  { name: "Ink soft", swatchClass: "bg-ink-soft", cssVar: "--color-ink-soft" },
  { name: "Muted", swatchClass: "bg-muted", cssVar: "--color-muted" },
  { name: "On dark muted", swatchClass: "bg-on-dark-muted", cssVar: "--color-on-dark-muted" },
  { name: "Line", swatchClass: "bg-line", cssVar: "--color-line", bordered: true },
  { name: "Fill", swatchClass: "bg-surface-subtle", cssVar: "--color-surface-subtle", bordered: true },
  { name: "Surface", swatchClass: "bg-surface", cssVar: "--color-surface", bordered: true },
  { name: "Canvas", swatchClass: "bg-canvas", cssVar: "--color-canvas", bordered: true },
  { name: "Mark 1", swatchClass: "bg-mark-1", cssVar: "--color-mark-1" },
  { name: "Mark 2", swatchClass: "bg-mark-2", cssVar: "--color-mark-2" },
  { name: "Mark 3", swatchClass: "bg-mark-3", cssVar: "--color-mark-3" },
  { name: "Mark 4", swatchClass: "bg-mark-4", cssVar: "--color-mark-4" },
];

export const exceptionTokens: ColorToken[] = [
  { name: "Attention", swatchClass: "bg-attention", cssVar: "--color-attention", exception: true },
  { name: "Attention surface", swatchClass: "bg-attention-surface", cssVar: "--color-attention-surface", bordered: true, exception: true },
  { name: "Negative strong", swatchClass: "bg-negative-strong", cssVar: "--color-negative-strong", exception: true },
  { name: "Negative surface", swatchClass: "bg-negative-surface", cssVar: "--color-negative-surface", bordered: true, exception: true },
];

export const featureFillToken = {
  name: "Feature fill",
  cssVar: "--highlight-gradient",
} as const;

export const radiusTokens = [
  { name: "Mark", cssVar: "--radius-mark", className: "rounded-[var(--radius-mark)]" },
  { name: "Card", cssVar: "--radius-card", className: "rounded-[var(--radius-card)]" },
  { name: "Pill", cssVar: "--radius-pill", className: "rounded-[var(--radius-pill)]" },
] as const;

export const spaceSamples = [
  { px: 4, barClass: "w-1 bg-chart-4", use: "icon gaps, tight stacks" },
  { px: 8, barClass: "w-2 bg-chart-4", use: "label to value" },
  { px: 12, barClass: "w-3 bg-secondary", use: "list row internals" },
  { px: 16, barClass: "w-4 bg-secondary", use: "block groups" },
  { px: 20, barClass: "w-5 bg-primary", use: "grid gutter" },
  { px: 22, barClass: "w-[22px] bg-primary", use: "card padding" },
  { px: 28, barClass: "w-7 bg-primary-strong", use: "shell padding" },
] as const;
