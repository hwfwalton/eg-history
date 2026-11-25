import { describe, expect, it } from 'vitest';
import { dayNumber } from './format.ts';
import { dayOfYear, fraction, heatLevel, heatLevels, monthStartWeeks, movePoint, nearestIndex, ticks, weekIndex, yearBands } from './scale.ts';

describe('fraction', () => {
  it('places a value between the ends and clamps it', () => {
    expect(fraction(5, 0, 10)).toBe(0.5);
    expect(fraction(-3, 0, 10)).toBe(0);
    expect(fraction(30, 0, 10)).toBe(1);
  });

  it('is 0 when there is no range', () => {
    expect(fraction(5, 5, 5)).toBe(0);
    expect(fraction(Number.NaN, 0, 10)).toBe(0);
  });
});

describe('ticks', () => {
  it('gives round steps that cover the largest value', () => {
    expect(ticks(46)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(ticks(14)).toEqual([0, 5, 10, 15]);
    expect(ticks(3)).toEqual([0, 1, 2, 3]);
    expect(ticks(1)).toEqual([0, 1]);
    expect(ticks(240)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it('never steps by a fraction, and copes with nothing', () => {
    expect(ticks(2)).toEqual([0, 1, 2]);
    expect(ticks(0)).toEqual([0, 1]);
  });
});

describe('weeks of the year', () => {
  it('numbers the days of a year', () => {
    expect(dayOfYear('2026-01-01')).toBe(1);
    expect(dayOfYear('2024-12-31')).toBe(366);
    expect(dayOfYear('2025-12-31')).toBe(365);
    expect(dayOfYear('nope')).toBeNaN();
  });

  it('puts a date in one of 53 seven-day blocks', () => {
    expect(weekIndex('2026-01-01')).toBe(0);
    expect(weekIndex('2026-01-07')).toBe(0);
    expect(weekIndex('2026-01-08')).toBe(1);
    expect(weekIndex('2025-12-30')).toBe(51);
    expect(weekIndex('2025-12-31')).toBe(52);
    expect(weekIndex('2024-12-31')).toBe(52);
    expect(weekIndex('')).toBeNaN();
  });

  it('finds the block each month starts in', () => {
    const starts = monthStartWeeks();
    expect(starts).toHaveLength(12);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(4);
    expect(starts[11]).toBe(47);
  });
});

describe('yearBands', () => {
  it('splits an axis into calendar years', () => {
    const bands = yearBands(dayNumber('2020-07-01'), dayNumber('2022-07-01'));
    expect(bands.map((band) => band.year)).toEqual([2020, 2021, 2022]);
    expect(bands[0]?.from).toBe(0);
    expect(bands[2]?.to).toBe(1);
    expect(bands[1]?.from).toBeCloseTo(184 / 730, 5);
    expect(bands[1]?.to).toBeCloseTo((184 + 365) / 730, 5);
  });

  it('copes with a single day and with nonsense', () => {
    expect(yearBands(dayNumber('2026-11-21'), dayNumber('2026-11-21'))).toEqual([{ year: 2026, from: 0, to: 1 }]);
    expect(yearBands(Number.NaN, 10)).toEqual([]);
    expect(yearBands(10, 5)).toEqual([]);
  });
});

describe('heat levels', () => {
  it('splits the counts into steps of about the same width', () => {
    const levels = heatLevels(12, 5);
    expect(levels.map((level) => [level.from, level.to, level.level])).toEqual([
      [1, 2, 1],
      [3, 5, 2],
      [6, 7, 3],
      [8, 10, 4],
      [11, 12, 5],
    ]);
    expect(heatLevel(0, levels)).toBe(0);
    expect(heatLevel(1, levels)).toBe(1);
    expect(heatLevel(5, levels)).toBe(2);
    expect(heatLevel(12, levels)).toBe(5);
    expect(heatLevel(40, levels)).toBe(5);
  });

  it('spreads few counts over the whole ramp', () => {
    expect(heatLevels(2, 5).map((level) => [level.from, level.to, level.level])).toEqual([
      [1, 1, 1],
      [2, 2, 5],
    ]);
    expect(heatLevels(1, 5)).toEqual([{ from: 1, to: 1, level: 3 }]);
    expect(heatLevels(0, 5)).toEqual([]);
  });

  it('leaves no count without a step', () => {
    for (let max = 1; max <= 60; max++) {
      const levels = heatLevels(max, 5);
      for (let value = 1; value <= max; value++) {
        const level = heatLevel(value, levels);
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(5);
      }
      expect(levels.at(-1)?.to).toBe(max);
    }
  });
});

describe('nearestIndex', () => {
  it('finds the closest value in a sorted list', () => {
    const days = [10, 20, 21, 50];
    expect(nearestIndex(days, 0)).toBe(0);
    expect(nearestIndex(days, 14)).toBe(0);
    expect(nearestIndex(days, 16)).toBe(1);
    expect(nearestIndex(days, 20.6)).toBe(2);
    expect(nearestIndex(days, 36)).toBe(3);
    expect(nearestIndex(days, 999)).toBe(3);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('movePoint', () => {
  // Two rows: row 0 has marks at 1, 5 and 9; row 2 has marks at 4 and 8.
  const points = [
    { r: 0, c: 1 },
    { r: 0, c: 5 },
    { r: 0, c: 9 },
    { r: 2, c: 4 },
    { r: 2, c: 8 },
  ];

  it('walks along a row', () => {
    expect(movePoint(points, 1, 'left')).toBe(0);
    expect(movePoint(points, 1, 'right')).toBe(2);
    expect(movePoint(points, 2, 'right')).toBe(-1);
    expect(movePoint(points, 2, 'home')).toBe(0);
    expect(movePoint(points, 0, 'end')).toBe(2);
  });

  it('jumps to the nearest mark of the next row that has any', () => {
    expect(movePoint(points, 1, 'down')).toBe(3);
    expect(movePoint(points, 2, 'down')).toBe(4);
    expect(movePoint(points, 4, 'up')).toBe(2);
    expect(movePoint(points, 0, 'up')).toBe(-1);
    expect(movePoint(points, 3, 'down')).toBe(-1);
  });

  it('stays put without a current mark', () => {
    expect(movePoint(points, 9, 'left')).toBe(-1);
  });
});
