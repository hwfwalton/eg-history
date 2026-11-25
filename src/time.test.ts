import { describe, expect, it } from 'vitest';
import { isTimezone, localDate, timezoneLabel } from './time.ts';

describe('isTimezone', () => {
  it('knows IANA names and nothing else', () => {
    expect(isTimezone('America/Los_Angeles')).toBe(true);
    expect(isTimezone('UTC')).toBe(true);
    expect(isTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimezone('Pacific')).toBe(false);
  });
});

describe('localDate', () => {
  it('gives the calendar date in that timezone', () => {
    // A Saturday 10:30 Pacific session is already Sunday in UTC+14, but still Saturday where it's played.
    const start = new Date('2030-02-02T18:30:00Z');
    expect(localDate(start, 'America/Los_Angeles')).toBe('2030-02-02');
    expect(localDate(start, 'UTC')).toBe('2030-02-02');
    expect(localDate(start, 'Pacific/Kiritimati')).toBe('2030-02-03');
  });

  it('changes at local midnight', () => {
    expect(localDate(new Date('2030-03-02T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-01');
    expect(localDate(new Date('2030-03-02T08:00:00Z'), 'America/Los_Angeles')).toBe('2030-03-02');
  });

  it('knows leap days and year ends', () => {
    expect(localDate(new Date('2028-03-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2028-02-29');
    expect(localDate(new Date('2030-03-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-02-28');
    expect(localDate(new Date('2031-01-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-12-31');
    expect(localDate(new Date('2030-12-31T10:00:00Z'), 'Pacific/Kiritimati')).toBe('2031-01-01');
  });

  it('follows the clocks on a daylight-saving weekend', () => {
    // Pacific time, 2030: forward on Mar 10, back on Nov 3. Midnight is at 08:00 UTC, then 07:00.
    expect(localDate(new Date('2030-03-10T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-09');
    expect(localDate(new Date('2030-03-11T06:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-10');
    expect(localDate(new Date('2030-03-11T07:00:00Z'), 'America/Los_Angeles')).toBe('2030-03-11');
    expect(localDate(new Date('2030-11-04T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-11-03');
  });
});

describe('timezoneLabel', () => {
  const winter = new Date('2030-01-15T12:00:00Z');
  const summer = new Date('2030-07-15T12:00:00Z');

  it('uses the year-round abbreviation where there is one', () => {
    expect(timezoneLabel('America/Los_Angeles', winter)).toBe('PT');
    expect(timezoneLabel('America/Los_Angeles', summer)).toBe('PT');
    expect(timezoneLabel('America/New_York', winter)).toBe('ET');
  });

  it('falls back to the short name at that moment', () => {
    expect(timezoneLabel('UTC', winter)).toBe('UTC');
    expect(timezoneLabel('Europe/Berlin', winter)).toBe('GMT+1');
    expect(timezoneLabel('Europe/Berlin', summer)).toBe('GMT+2');
  });

  it("is undefined for a timezone Intl doesn't know", () => {
    expect(timezoneLabel('Mars/Olympus_Mons', winter)).toBeUndefined();
    expect(timezoneLabel('', winter)).toBeUndefined();
  });
});
