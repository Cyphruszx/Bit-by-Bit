import { roundMoney } from "@/lib/money-flow/parse-values";
import type { CategorySpend } from "@/lib/money-flow/types";

export const TAG_CHART_COLORS = ["#173b31", "#73a883", "#5b8a9a", "#c4a35a", "#8b6b9b", "#9b3b32", "#355a3f", "#257155"];

export type ChartKind = "bar" | "pie";

export type TagChartSlice = CategorySpend & {
  color: string;
  startAngle: number;
  endAngle: number;
};

export function nextTagSelection(current: string, clicked: string): string {
  if (clicked === "All") return "All";
  return current === clicked ? "All" : clicked;
}

export function topChartCategories(categories: CategorySpend[], limit = 8): CategorySpend[] {
  if (categories.length <= limit) return categories;
  const head = categories.slice(0, limit - 1);
  const rest = categories.slice(limit - 1);
  const total = categories.reduce((sum, item) => sum + item.amount, 0);
  const amount = roundMoney(rest.reduce((sum, item) => sum + item.amount, 0));
  return [...head, { name: "Other", amount, share: total > 0 ? Math.round((amount / total) * 100) : 0 }];
}

export function withTagColors(categories: CategorySpend[]): Array<CategorySpend & { color: string }> {
  return categories.map((item, index) => ({
    ...item,
    color: TAG_CHART_COLORS[index % TAG_CHART_COLORS.length],
  }));
}

export function pieSlices(categories: CategorySpend[]): TagChartSlice[] {
  const colored = withTagColors(categories);
  const total = colored.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) return [];
  let angle = -Math.PI / 2;
  return colored.map((item) => {
    const sweep = (item.amount / total) * Math.PI * 2;
    const startAngle = angle;
    const endAngle = angle + sweep;
    angle = endAngle;
    return { ...item, startAngle, endAngle };
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

export function barLayout(
  categories: Array<CategorySpend & { color: string }>,
  innerWidth: number,
  innerHeight: number,
): Array<CategorySpend & { color: string; x: number; y: number; width: number; height: number }> {
  const maxValue = Math.max(0, ...categories.map((item) => item.amount));
  const count = Math.max(categories.length, 1);
  const slot = innerWidth / count;
  const width = slot * 0.62;
  return categories.map((item, index) => {
    const height = maxValue > 0 ? (item.amount / maxValue) * innerHeight : 0;
    return {
      ...item,
      x: slot * index + (slot - width) / 2,
      y: innerHeight - height,
      width,
      height,
    };
  });
}
