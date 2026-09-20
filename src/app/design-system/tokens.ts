export type ColorToken = {
  name: string;
  /** Tailwind background class bound to the theme colour. Empty for gallery-only fills. */
  swatchClass: string;
  /** Custom property declared on `@theme` or `:root` in globals.css. */
  cssVar?: string;
  bordered?: boolean;
  /** Bind the swatch to `background-image` instead of a solid colour. */
  gradient?: boolean;
  /** Gallery-only fill when no product token exists yet. */
  displayHex?: string;
  note?: string;
};

/** 01 · Light theme — design names, bound to live theme tokens. */
export const colourTokens: ColorToken[] = [
  { name: "Brand", swatchClass: "bg-primary", cssVar: "--color-primary" },
  { name: "Brand deep", swatchClass: "bg-primary-strong", cssVar: "--color-primary-strong" },
  { name: "Brand 400", swatchClass: "bg-secondary", cssVar: "--color-secondary" },
  { name: "Brand 300", swatchClass: "bg-chart-4", cssVar: "--color-chart-4" },
  { name: "Brand tint", swatchClass: "bg-accent-surface", cssVar: "--color-accent-surface", bordered: true },
  { name: "Feature fill", swatchClass: "", cssVar: "--highlight-gradient", gradient: true },
  { name: "Ink", swatchClass: "bg-ink", cssVar: "--color-ink" },
  { name: "Ink secondary", swatchClass: "bg-ink-soft", cssVar: "--color-ink-soft" },
  { name: "Muted", swatchClass: "bg-muted", cssVar: "--color-muted" },
  { name: "Dim", swatchClass: "bg-on-dark-muted", cssVar: "--color-on-dark-muted" },
  { name: "Line", swatchClass: "bg-line", cssVar: "--color-line", bordered: true },
  { name: "Fill", swatchClass: "bg-surface-subtle", cssVar: "--color-surface-subtle", bordered: true },
];

/**
 * 01 · Dark theme — design names. Several light roles remap to a different
 * token in the 8a block (Brand is `--color-secondary`, not `--color-primary`).
 */
export const darkColourTokens: ColorToken[] = [
  { name: "Brand", swatchClass: "bg-secondary", cssVar: "--color-secondary" },
  {
    name: "Brand 500",
    swatchClass: "",
    displayHex: "#4F7CF5",
    note: "Not in theme yet",
  },
  { name: "Brand 600", swatchClass: "bg-primary", cssVar: "--color-primary" },
  { name: "Brand deep", swatchClass: "bg-primary-strong", cssVar: "--color-primary-strong" },
  { name: "Brand tint", swatchClass: "bg-accent-surface", cssVar: "--color-accent-surface", bordered: true },
  { name: "Brand text", swatchClass: "bg-chart-4", cssVar: "--color-chart-4" },
  { name: "Ink", swatchClass: "bg-ink", cssVar: "--color-ink" },
  { name: "Muted", swatchClass: "bg-muted", cssVar: "--color-muted" },
  { name: "Dim", swatchClass: "bg-chart-6", cssVar: "--color-chart-6" },
  { name: "Surface", swatchClass: "bg-surface", cssVar: "--color-surface", bordered: true },
  { name: "Surface sunk", swatchClass: "bg-surface-subtle", cssVar: "--color-surface-subtle", bordered: true },
  { name: "Line", swatchClass: "bg-line-dashed", cssVar: "--color-line-dashed" },
];

export const radiusSamples = [
  { label: "4", className: "rounded-[4px]" },
  { label: "8", className: "rounded-[8px]" },
  { label: "12", className: "rounded-[12px]" },
  { label: "16", className: "rounded-[var(--radius-card)]", cssVar: "--radius-card" },
  { label: "999", className: "rounded-[var(--radius-pill)]", cssVar: "--radius-pill" },
] as const;

export const spaceSamples = [
  { px: 4, barClass: "w-[4px] bg-chart-4", use: "icon gaps, tight stacks" },
  { px: 8, barClass: "w-[8px] bg-chart-4", use: "label to value" },
  { px: 12, barClass: "w-[12px] bg-secondary", use: "list row internals" },
  { px: 16, barClass: "w-[16px] bg-secondary", use: "block groups" },
  { px: 20, barClass: "w-[20px] bg-primary", use: "grid gutter" },
  { px: 22, barClass: "w-[22px] bg-primary", use: "card padding" },
  { px: 28, barClass: "w-[28px] bg-primary-strong", use: "shell padding" },
] as const;
