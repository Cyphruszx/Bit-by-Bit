export const CHART_PIXEL = 2;
export const PIE_PIXEL = 4;

export type PixelCell = {
  x: number;
  y: number;
  size: number;
};

export function snapChart(value: number, pixel = CHART_PIXEL): number {
  return Math.round(value / pixel) * pixel;
}

/** Axis-aligned stairs so a line reads as pixels instead of a diagonal stroke. */
export function steppedPath(
  points: Array<{ x: number; y: number } | null | undefined>,
  pixel = CHART_PIXEL,
): string {
  const commands: string[] = [];
  let last: { x: number; y: number } | null = null;
  for (const point of points) {
    if (!point) continue;
    const x = snapChart(point.x, pixel);
    const y = snapChart(point.y, pixel);
    if (!last) {
      commands.push(`M ${x} ${y}`);
    } else {
      if (last.x !== x) commands.push(`H ${x}`);
      if (last.y !== y) commands.push(`V ${y}`);
    }
    last = { x, y };
  }
  return commands.join(" ");
}

export function closeSteppedArea(path: string, x0: number, y0: number, pixel = CHART_PIXEL): string {
  if (!path) return "";
  return `${path} V ${snapChart(y0, pixel)} H ${snapChart(x0, pixel)} Z`;
}

/**
 * A monotone cubic through the points, so a running total reads as one curve.
 * Gaps start a new subpath. Two points stay a straight segment.
 */
export function smoothPath(points: Array<{ x: number; y: number } | null | undefined>): string {
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs.map(smoothRun).filter(Boolean).join(" ");
}

function smoothRun(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  if (points.length === 2) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  }

  const n = points.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    delta.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }
  const slope = new Array<number>(n);
  slope[0] = delta[0] ?? 0;
  slope[n - 1] = delta[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const left = delta[i - 1] ?? 0;
    const right = delta[i] ?? 0;
    slope[i] = left * right <= 0 ? 0 : (left + right) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const change = delta[i] ?? 0;
    if (change === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }
    const a = (slope[i] ?? 0) / change;
    const b = (slope[i + 1] ?? 0) / change;
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      slope[i] = scale * a * change;
      slope[i + 1] = scale * b * change;
    }
  }

  const commands = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 0; i < n - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const dx = (end.x - start.x) / 3;
    commands.push(
      `C ${fmt(start.x + dx)} ${fmt(start.y + (slope[i] ?? 0) * dx)} ${fmt(end.x - dx)} ${fmt(end.y - (slope[i + 1] ?? 0) * dx)} ${fmt(end.x)} ${fmt(end.y)}`,
    );
  }
  return commands.join(" ");
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function angleInSweep(angle: number, start: number, end: number): boolean {
  if (end - start >= Math.PI * 2 - 1e-6) return true;
  let next = angle;
  while (next < start) next += Math.PI * 2;
  while (next >= start + Math.PI * 2) next -= Math.PI * 2;
  return next >= start && next < end;
}

export function pixelRingCells(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startAngle: number,
  endAngle: number,
  pixel = PIE_PIXEL,
): PixelCell[] {
  if (endAngle - startAngle <= 0) return [];
  const cells: PixelCell[] = [];
  const minX = snapChart(cx - outer, pixel);
  const maxX = snapChart(cx + outer, pixel);
  const minY = snapChart(cy - outer, pixel);
  const maxY = snapChart(cy + outer, pixel);
  for (let y = minY; y <= maxY; y += pixel) {
    for (let x = minX; x <= maxX; x += pixel) {
      const dx = x + pixel / 2 - cx;
      const dy = y + pixel / 2 - cy;
      const radius = Math.hypot(dx, dy);
      if (radius < inner || radius > outer) continue;
      if (!angleInSweep(Math.atan2(dy, dx), startAngle, endAngle)) continue;
      cells.push({ x, y, size: pixel });
    }
  }
  return cells;
}

export function assignPixelDonutCells<T extends { startAngle: number; endAngle: number }>(
  slices: T[],
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  pixel = PIE_PIXEL,
): Array<T & { cells: PixelCell[] }> {
  const assigned = slices.map((slice) => ({ ...slice, cells: [] as PixelCell[] }));
  const minX = snapChart(cx - outer, pixel);
  const maxX = snapChart(cx + outer, pixel);
  const minY = snapChart(cy - outer, pixel);
  const maxY = snapChart(cy + outer, pixel);
  for (let y = minY; y <= maxY; y += pixel) {
    for (let x = minX; x <= maxX; x += pixel) {
      const dx = x + pixel / 2 - cx;
      const dy = y + pixel / 2 - cy;
      const radius = Math.hypot(dx, dy);
      if (radius < inner || radius > outer) continue;
      const angle = Math.atan2(dy, dx);
      const index = assigned.findIndex((slice) => angleInSweep(angle, slice.startAngle, slice.endAngle));
      if (index >= 0) assigned[index]?.cells.push({ x, y, size: pixel });
    }
  }
  for (const slice of assigned) {
    if (slice.cells.length > 0 || slice.endAngle - slice.startAngle <= 0) continue;
    const mid = (slice.startAngle + slice.endAngle) / 2;
    const radius = (inner + outer) / 2;
    slice.cells.push({
      x: snapChart(cx + radius * Math.cos(mid) - pixel / 2, pixel),
      y: snapChart(cy + radius * Math.sin(mid) - pixel / 2, pixel),
      size: pixel,
    });
  }
  return assigned;
}
