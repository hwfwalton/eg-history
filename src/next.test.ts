import { describe, expect, it } from 'vitest';
import { parseNext } from './next.ts';

const TODAY = '2031-01-20';
const VALID = {
  updatedAt: '2031-01-20T19:00:00.000Z',
  date: '2031-01-25',
  start: '10:30am',
  status: 'announced',
  session: 'EG4',
  games: ['Duck Game'],
};
const text = (value: unknown) => JSON.stringify(value);

describe('parseNext', () => {
  it('reads the session the bot wrote', () => {
    expect(parseNext(text(VALID), TODAY)).toEqual({ date: '2031-01-25', start: '10:30am', status: 'announced', session: 'EG4', games: ['Duck Game'] });
  });

  it('keeps a session dated today, and ignores one that is over', () => {
    expect(parseNext(text({ ...VALID, date: TODAY }), TODAY)?.date).toBe(TODAY);
    expect(parseNext(text({ ...VALID, date: '2031-01-19' }), TODAY)).toBeUndefined();
  });

  it('reads cancelled and unannounced weeks, without games', () => {
    expect(parseNext(text({ ...VALID, status: 'cancelled', session: undefined, games: [] }), TODAY)).toEqual({
      date: '2031-01-25',
      start: '10:30am',
      status: 'cancelled',
      games: [],
    });
    expect(parseNext(text({ ...VALID, status: 'unannounced', games: ['Leftover'] }), TODAY)?.games).toEqual([]);
  });

  it('does without updatedAt and session, and trims what it keeps', () => {
    const { updatedAt: _, session: __, ...bare } = VALID;
    expect(parseNext(text({ ...bare, start: ' 11am ', games: [' Sky Noon ', ''] }), TODAY)).toEqual({
      date: '2031-01-25',
      start: '11am',
      status: 'announced',
      games: ['Sky Noon'],
    });
    expect(parseNext(text({ ...VALID, session: '  ' }), TODAY)).not.toHaveProperty('session');
  });

  it.each([
    ['empty', ''],
    ['not JSON', '{"date": "2031-01-25",'],
    ['a list', '[]'],
    ['null', 'null'],
    ['a string', '"2031-01-25"'],
  ])('ignores text that is %s', (_, raw) => {
    expect(parseNext(raw, TODAY)).toBeUndefined();
  });

  it.each([
    ['no date', { ...VALID, date: undefined }],
    ['a date in another format', { ...VALID, date: '1/25/2031' }],
    ['a date that does not exist', { ...VALID, date: '2031-02-30' }],
    ['a number for a date', { ...VALID, date: 20310125 }],
    ['no start', { ...VALID, start: undefined }],
    ['an unknown status', { ...VALID, status: 'Played' }],
    ['a number for a session', { ...VALID, session: 4 }],
    ['games that are not a list', { ...VALID, games: 'Duck Game' }],
    ['a game that is not text', { ...VALID, games: ['Duck Game', 3] }],
    ['no games', { ...VALID, games: undefined }],
  ])('ignores a file with %s', (_, value) => {
    expect(parseNext(text(value), TODAY)).toBeUndefined();
  });
});
