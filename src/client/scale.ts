// Positions for the charts: fractions along an axis, round axis ticks, the week grid, heat levels,
// and moving a keyboard cursor between marks. Pure: no DOM.

import { dayNumber, parseDate } from './format.ts';

/** Where `value` sits between `min` and `max`, from 0 to 1 (0 when the range is empty). */
export function fraction(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Round axis ticks from 0 up to the first round number at or above `max` (whole numbers only: these are counts). */
export function ticks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  const nice = lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
  const step = Math.max(1, Math.round(nice * power));
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let value = 0; value <= top; value += step) out.push(value);
  return out;
}

/** 1 for January 1st, up to 366. NaN when the date can't be read. */
export function dayOfYear(ymd: string): number {
  const parts = parseDate(ymd);
  if (!parts) return Number.NaN;
  return dayNumber(ymd) - dayNumber(`${String(parts.year).padStart(4, '0')}-01-01`) + 1;
}

export const WEEKS_PER_YEAR = 53;

/** Which of the year's 53 seven-day blocks a date is in: 0 for January 1st to 7th, 52 for the last day or two. */
export function weekIndex(ymd: string): number {
  const day = dayOfYear(ymd);
  if (Number.isNaN(day)) return Number.NaN;
  return Math.floor((day - 1) / 7);
}

/** The week index each month starts in (in a year that isn't a leap year): the column of its label. */
export function monthStartWeeks(): number[] {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out: number[] = [];
  let day = 0;
  for (const length of lengths) {
    out.push(Math.floor(day / 7));
    day += length;
  }
  return out;
}

export interface YearBand {
  year: number;
  /** Where the band starts and ends along the axis, 0 to 1. */
  from: number;
  to: number;
}

/** The calendar years between two day numbers, each with the stretch of the axis it covers. */
export function yearBands(startDay: number, endDay: number): YearBand[] {
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay < startDay) return [];
  const firstYear = new Date(startDay * 86_400_000).getUTCFullYear();
  const lastYear = new Date(endDay * 86_400_000).getUTCFullYear();
  const bands: YearBand[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const yearStart = Math.round(Date.UTC(year, 0, 1) / 86_400_000);
    const nextStart = Math.round(Date.UTC(year + 1, 0, 1) / 86_400_000);
    bands.push({
      year,
      from: endDay === startDay ? 0 : fraction(yearStart, startDay, endDay),
      to: endDay === startDay ? 1 : fraction(nextStart, startDay, endDay),
    });
  }
  return bands;
}

export interface HeatLevel {
  /** The counts this step covers, both included. */
  from: number;
  to: number;
  /** 1 (lightest) to `steps` (strongest): which colour of the ramp. */
  level: number;
}

/**
 * Splits the counts 1..max into at most `steps` ranges of about the same width, each with its
 * colour step. With fewer different counts than steps, the colours are spread over the whole ramp.
 */
export function heatLevels(max: number, steps = 5): HeatLevel[] {
  const top = Math.floor(max);
  if (!(top >= 1)) return [];
  const n = Math.min(steps, top);
  const levels: HeatLevel[] = [];
  let from = 1;
  for (let i = 1; i <= n; i++) {
    const to = i === n ? top : Math.max(from, Math.round((top * i) / n));
    const level = n === 1 ? Math.ceil(steps / 2) : 1 + Math.round(((i - 1) * (steps - 1)) / (n - 1));
    levels.push({ from, to, level });
    from = to + 1;
  }
  return levels;
}

/** The colour step of one count: 0 for nothing, else the level whose range holds it. */
export function heatLevel(value: number, levels: readonly HeatLevel[]): number {
  if (!(value > 0)) return 0;
  for (const level of levels) {
    if (value <= level.to) return level.level;
  }
  return levels.at(-1)?.level ?? 0;
}

/** The index of the value nearest to `target` in a list sorted low to high (-1 for an empty list). */
export function nearestIndex(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1;
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] ?? 0) < target) low = mid + 1;
    else high = mid;
  }
  const after = sorted[low] ?? Number.POSITIVE_INFINITY;
  const before = low > 0 ? (sorted[low - 1] ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
  return low > 0 && target - before <= after - target ? low - 1 : low;
}

export interface Point {
  /** Row. */
  r: number;
  /** Position along the row (a column, or a day number). */
  c: number;
}

export type Move = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * Where an arrow key takes a keyboard cursor among the marks of a chart: left and right along the
 * row, up and down to the nearest row that has marks (landing on the mark closest to the current
 * position). Returns the index of the new mark, or -1 to stay put.
 */
export function movePoint(points: readonly Point[], current: number, move: Move): number {
  const here = points[current];
  if (!here) return -1;
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  if (move === 'left' || move === 'right' || move === 'home' || move === 'end') {
    points.forEach((point, index) => {
      if (point.r !== here.r || index === current) return;
      const ahead = point.c - here.c;
      // Left and right take the closest mark on that side; home and end the farthest.
      let score: number;
      if (move === 'left' || move === 'home') {
        if (ahead >= 0) return;
        score = move === 'left' ? -ahead : ahead;
      } else {
        if (ahead <= 0) return;
        score = move === 'right' ? ahead : -ahead;
      }
      if (best === -1 || score < bestScore) {
        best = index;
        bestScore = score;
      }
    });
    return best;
  }
  // Up or down: first the nearest row in that direction, then the closest mark in it.
  let row = Number.NaN;
  for (const point of points) {
    if (move === 'up' ? point.r >= here.r : point.r <= here.r) continue;
    if (Number.isNaN(row) || Math.abs(point.r - here.r) < Math.abs(row - here.r)) row = point.r;
  }
  if (Number.isNaN(row)) return -1;
  points.forEach((point, index) => {
    if (point.r !== row) return;
    const score = Math.abs(point.c - here.c);
    if (best === -1 || score < bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}
