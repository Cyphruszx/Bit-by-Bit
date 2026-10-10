export const CHART_PIXEL = 4;
export const PIE_PIXEL = 8;

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
