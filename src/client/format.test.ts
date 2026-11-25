import { describe, expect, it } from 'vitest';
import {
  ago,
  count,
  dateOfDay,
  dayNumber,
  dotted,
  formatDate,
  formatDay,
  formatDayNoYear,
  formatMonth,
  formatMonthLong,
  formatMonthSpan,
  formatSpan,
  nthTime,
  ordinal,
  parseDate,
  percent,
  playMarker,
  plural,
} from './format.ts';

describe('parseDate', () => {
  it('reads a calendar date', () => {
    expect(parseDate('2026-11-21')).toEqual({ year: 2026, month: 11, day: 21 });
  });

  it('refuses what is not a real date', () => {
    expect(parseDate('2024-02-31')).toBeUndefined();
    expect(parseDate('13/45/2020')).toBeUndefined();
    expect(parseDate('2024-2-3')).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });
});

describe('dayNumber and dateOfDay', () => {
  it('count whole days and go back and forth', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2);
    expect(dateOfDay(dayNumber('2026-11-21'))).toBe('2026-11-21');
  });

  it('gives NaN for a bad date', () => {
    expect(dayNumber('soon')).toBeNaN();
  });
});

describe('dates as text', () => {
  it('formats a day as UTC, whatever the visitor timezone', () => {
    expect(formatDay('2026-11-21')).toBe('Sat, Nov 21, 2026');
    expect(formatDay('2020-01-01')).toBe('Wed, Jan 1, 2020');
    expect(formatDayNoYear('2026-11-28')).toBe('Sat, Nov 28');
    expect(formatDate('2025-07-20')).toBe('Jul 20, 2025');
    expect(formatMonth('2026-11-21')).toBe('Nov 2026');
    expect(formatMonthLong('2020-06-13')).toBe('June 2020');
  });

  it('returns a string that is not a date as it is', () => {
    expect(formatDay('whenever')).toBe('whenever');
    expect(formatMonth('')).toBe('');
  });

  it('formats a span of days', () => {
    expect(formatSpan('2024-01-07', '2024-12-29')).toBe('Jan 7 – Dec 29, 2024');
    expect(formatSpan('2020-06-13', '2026-11-21')).toBe('Jun 13, 2020 – Nov 21, 2026');
    expect(formatSpan('2024-01-07', '2024-01-07')).toBe('Jan 7, 2024');
  });

  it('formats a span of months', () => {
    expect(formatMonthSpan('2020-06-13', '2026-11-21')).toBe('Jun 2020 – Nov 2026');
    expect(formatMonthSpan('2024-01-07', '2024-12-29')).toBe('Jan – Dec 2024');
    expect(formatMonthSpan('2026-08-01', '2026-08-29')).toBe('Aug 2026');
    expect(formatMonthSpan('?', '2026-08-29')).toBe('? – 2026-08-29');
  });
});

describe('ago', () => {
  it('picks the unit that says the most', () => {
    expect(ago(0)).toBe('today');
    expect(ago(1)).toBe('yesterday');
    expect(ago(3)).toBe('3 days ago');
    expect(ago(13)).toBe('13 days ago');
    expect(ago(14)).toBe('2 weeks ago');
    expect(ago(60)).toBe('8 weeks ago');
    expect(ago(61)).toBe('2 months ago');
    expect(ago(492)).toBe('16 months ago');
    expect(ago(729)).toBe('23 months ago');
    expect(ago(731)).toBe('2 years ago');
    expect(ago(1988)).toBe('5 years ago');
  });

  it('says nothing for a nonsense count', () => {
    expect(ago(-1)).toBe('');
    expect(ago(Number.NaN)).toBe('');
  });
});

describe('ordinals and markers', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
      '112th',
    ]);
  });

  it('marks a first play as new and leaves uncounted plays alone', () => {
    expect(playMarker(1)).toBe('new');
    expect(playMarker(3)).toBe('3rd');
    expect(playMarker(0)).toBe('');
    expect(nthTime(1)).toBe('first time');
    expect(nthTime(14)).toBe('14th time');
    expect(nthTime(0)).toBe('');
  });
});

describe('numbers as text', () => {
  it('groups thousands', () => {
    expect(count(271)).toBe('271');
    expect(count(1284)).toBe('1,284');
    expect(count(1234567)).toBe('1,234,567');
    expect(count(Number.NaN)).toBe('–');
  });

  it('pluralises', () => {
    expect(plural(1, 'session')).toBe('1 session');
    expect(plural(271, 'session')).toBe('271 sessions');
    expect(plural(0, 'week')).toBe('0 weeks');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('writes a share', () => {
    expect(percent(162, 225)).toBe('72%');
    expect(percent(1, 277)).toBe('<1%');
    expect(percent(276, 277)).toBe('>99%');
    expect(percent(0, 10)).toBe('0%');
    expect(percent(10, 10)).toBe('100%');
    expect(percent(3, 0)).toBe('–');
  });

  it('joins the parts that exist', () => {
    expect(dotted('EG228', '', undefined, '14th time')).toBe('EG228 · 14th time');
    expect(dotted(undefined, false)).toBe('');
  });
});
