import { roundMoney } from "@/lib/money-flow/parse-values";
import type { CategorySpend } from "@/lib/money-flow/types";

export const TAG_CHART_COLORS = ["#173b31", "#73a883", "#5b8a9a", "#c4a35a", "#8b6b9b", "#9b3b32", "#355a3f", "#257155"];

const MIN_BAR_HEIGHT = 2;

export type ChartKind = "bar" | "pie";

export type TagChartSlice = CategorySpend & {
  color: string;
  direction: "in" | "out";
  startAngle: number;
  endAngle: number;
};

export type TagChartBar = CategorySpend & {
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zeroY: number;
};

export function nextTagSelection(current: string, clicked: string): string {
  if (clicked === "All") return "All";
  return current === clicked ? "All" : clicked;
}

export function topChartCategories(categories: CategorySpend[], limit = 8): CategorySpend[] {
  if (categories.length <= limit) return categories;
  const head = categories.slice(0, limit - 1);
  const rest = categories.slice(limit - 1);
  const total = categories.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const amount = roundMoney(rest.reduce((sum, item) => sum + item.amount, 0));
  return [...head, { name: "Other", amount, share: total > 0 ? Math.round((Math.abs(amount) / total) * 100) : 0 }];
}

/** Money in first, then money out, each ordered by size, so bars read left to right across the zero line. */
export function orderByFlow<T extends CategorySpend>(categories: T[]): T[] {
  return [...categories].sort((a, b) => {
    if (a.amount >= 0 !== b.amount >= 0) return a.amount >= 0 ? -1 : 1;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });
}

export function withTagColors(categories: CategorySpend[]): Array<CategorySpend & { color: string }> {
  return categories.map((item, index) => ({
    ...item,
    color: TAG_CHART_COLORS[index % TAG_CHART_COLORS.length],
  }));
}

export function pieSlices(categories: CategorySpend[]): TagChartSlice[] {
  const colored = withTagColors(categories);
  const total = colored.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  if (total <= 0) return [];
  let angle = -Math.PI / 2;
  return colored.map((item) => {
    const magnitude = Math.abs(item.amount);
    const sweep = (magnitude / total) * Math.PI * 2;
    const startAngle = angle;
    const endAngle = angle + sweep;
    angle = endAngle;
    return {
      ...item,
      share: Math.round((magnitude / total) * 100),
      direction: item.amount >= 0 ? ("in" as const) : ("out" as const),
      startAngle,
      endAngle,
    };
  });
}

export function donutPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep <= 0) return "";
  if (sweep >= Math.PI * 2 - 1e-6) {
    return [
      `M ${cx} ${cy - outer}`,
      `A ${outer} ${outer} 0 1 1 ${cx} ${cy + outer}`,
      `A ${outer} ${outer} 0 1 1 ${cx} ${cy - outer}`,
      `M ${cx} ${cy - inner}`,
      `A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner}`,
      `A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner}`,
    ].join(" ");
  }
  const large = sweep > Math.PI ? 1 : 0;
  const [sx, sy] = polar(cx, cy, outer, start);
  const [ex, ey] = polar(cx, cy, outer, end);
  const [ix, iy] = polar(cx, cy, inner, end);
  const [jx, jy] = polar(cx, cy, inner, start);
  return `M ${sx} ${sy} A ${outer} ${outer} 0 ${large} 1 ${ex} ${ey} L ${ix} ${iy} A ${inner} ${inner} 0 ${large} 0 ${jx} ${jy} Z`;
}

export function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/**
 * Lays bars around a zero line: positive amounts rise above `zeroY`, negative ones drop below it.
 * With no negatives the zero line sits on the floor, giving the same layout as a plain column chart.
 */
export function barLayout(
  categories: Array<CategorySpend & { color: string }>,
  innerWidth: number,
  innerHeight: number,
): TagChartBar[] {
  const maxUp = Math.max(0, ...categories.map((item) => item.amount));
  const maxDown = Math.max(0, ...categories.map((item) => -item.amount));
  const span = maxUp + maxDown;
  const zeroY = span > 0 ? (maxUp / span) * innerHeight : innerHeight;
  const count = Math.max(categories.length, 1);
  const slot = innerWidth / count;
  const width = slot * 0.62;
  return categories.map((item, index) => {
    const scaled = span > 0 ? (Math.abs(item.amount) / span) * innerHeight : 0;
    // One shared scale keeps the two sides comparable, which can round a small tag down to nothing.
    const height = item.amount === 0 ? 0 : Math.max(scaled, MIN_BAR_HEIGHT);
    return {
      ...item,
      x: slot * index + (slot - width) / 2,
      y: item.amount >= 0 ? zeroY - height : zeroY,
      width,
      height,
      zeroY,
    };
  });
}

export function barAxisTicks(categories: CategorySpend[]): number[] {
  const maxUp = Math.max(0, ...categories.map((item) => item.amount));
  const maxDown = Math.max(0, ...categories.map((item) => -item.amount));
  const ticks = [maxUp, 0, -maxDown];
  return ticks.filter((tick, index) => ticks.indexOf(tick) === index);
}
