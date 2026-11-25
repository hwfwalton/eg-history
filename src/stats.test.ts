import { describe, expect, it } from 'vitest';
import { type HistoryInput, buildHistory, costKind, gamesExport, ordinal, sessionNumber, sessionsExport } from './stats.ts';
import {
  AUTO_SOURCE,
  UNCATEGORIZED,
  type GameInfo,
  type HistoryData,
  type NextSession,
  type SessionRow,
  type SessionStatus,
  type Slice,
} from './types.ts';

// Every session below is made up.
const NOW = new Date('2026-06-15T18:00:00Z');
const TODAY = '2026-06-15'; // a Monday

function row(date: string, status: SessionStatus, games: string[] = [], extra: Partial<SessionRow> = {}): SessionRow {
  return { date, status, games, planned: [], ...extra };
}
const played = (date: string, games: string[] = [], extra: Partial<SessionRow> = {}) => row(date, 'Played', games, extra);
const special = (date: string, games: string[] = [], extra: Partial<SessionRow> = {}) => row(date, 'Special', games, extra);
const noSession = (date: string, extra: Partial<SessionRow> = {}) => row(date, 'No session', [], extra);
const cancelled = (date: string, extra: Partial<SessionRow> = {}) => row(date, 'Cancelled', [], extra);

function game(name: string, style?: string, mode?: string, extra: Partial<GameInfo> = {}): GameInfo {
  return { name, ...(style !== undefined && { style }), ...(mode !== undefined && { mode }), tags: [], ...extra };
}

function build(sessions: SessionRow[], games: GameInfo[] = [], extra: Partial<HistoryInput> = {}): HistoryData {
  return buildHistory({ title: 'Test Club', now: NOW, today: TODAY, sessions, games, ...extra });
}

function slice(data: HistoryData, key: string): Slice {
  const found = data.slices.find((s) => s.key === key);
  if (!found) throw new Error(`no "${key}" slice, only ${data.slices.map((s) => s.key).join(', ')}`);
  return found;
}

function gameNamed(data: HistoryData, name: string) {
  const found = data.games.find((g) => g.name === name);
  if (!found) throw new Error(`no game "${name}"`);
  return found;
}

/** The play numbers of each session's games, e.g. [[1], [1, 2]]. */
const playNumbers = (data: HistoryData) => data.sessions.map((s) => s.games.map((g) => g.play));

/** `count` Saturdays starting at `first` (YYYY-MM-DD). */
function weekly(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, week) => new Date(start + week * 7 * 24 * 3600_000).toISOString().slice(0, 10));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('sessions', () => {
  it('lists every row oldest first, keeping the file order for equal dates', () => {
    const data = build([
      played('2026-03-14', ['Duck Game'], { session: 'EG3' }),
      played('2026-03-07', ['Among Us'], { session: 'EG2' }),
      special('2026-03-14', ['Jackbox Party Pack 3'], { notes: 'evening extra' }),
      noSession('2026-02-28'),
    ]);
    expect(data.sessions.map((s) => [s.date, s.status, s.session])).toEqual([
      ['2026-02-28', 'No session', undefined],
      ['2026-03-07', 'Played', 'EG2'],
      ['2026-03-14', 'Played', 'EG3'],
      ['2026-03-14', 'Special', undefined],
    ]);
  });

  it('names the weekday', () => {
    const data = build([played('2026-11-14'), played('2024-02-29'), played(TODAY), played('sometime in May')]);
    expect(data.sessions.map((s) => [s.date, s.day])).toEqual([
      ['2024-02-29', 'Thursday'],
      ['2026-06-15', 'Monday'],
      ['2026-11-14', 'Saturday'],
      ['sometime in May', ''],
    ]);
  });

  it('passes the row through and leaves out empty fields', () => {
    const data = build(
      [
        played('2026-03-07', ['Among Us'], {
          session: 'EG12',
          start: '10:30am',
          planned: ['Duck Game'],
          cost: 'Free',
          announcedBy: 'Robin',
          source: '#announcements',
          notes: 'Duck Game servers were down',
        }),
        cancelled('2026-03-14', { session: '', start: '', cost: '', announcedBy: '', source: '', notes: '' }),
      ],
      [game('Among Us', 'Social deduction')],
    );
    expect(data.sessions).toEqual([
      {
        session: 'EG12',
        date: '2026-03-07',
        day: 'Saturday',
        start: '10:30am',
        status: 'Played',
        games: [{ name: 'Among Us', play: 1 }],
        planned: ['Duck Game'],
        cost: 'Free',
        costKind: 'free',
        announcedBy: 'Robin',
        source: '#announcements',
        notes: 'Duck Game servers were down',
        styles: ['Social deduction'],
        auto: false,
      },
      { date: '2026-03-14', day: 'Saturday', status: 'Cancelled', games: [], planned: [], styles: [], auto: false },
    ]);
    expect(Object.keys(data.sessions[1] ?? {})).not.toContain('session');
  });

  it('marks the rows the bot added itself', () => {
    const data = build([played('2026-03-07', ['Among Us'], { source: AUTO_SOURCE }), played('2026-03-14', ['Among Us'], { source: '#gaming' })]);
    expect(data.sessions.map((s) => s.auto)).toEqual([true, false]);
  });

  it('lists the distinct styles of a session in game order', () => {
    const data = build(
      [played('2026-03-07', ['Duck Game', 'Among Us', 'Project Winter', 'Skribbl.io'])],
      [game('Among Us', 'Social deduction'), game('Project Winter', 'Social deduction'), game('Duck Game', '2D platform fighter')],
    );
    expect(data.sessions[0]?.styles).toEqual(['2D platform fighter', 'Social deduction', UNCATEGORIZED]);
  });

  it('does not change its input', () => {
    const input: HistoryInput = {
      title: 'Test Club',
      now: NOW,
      today: TODAY,
      sessions: [
        played('2026-03-14', ['Duck Game', 'Among Us'], { planned: ['Golf It!'] }),
        played('2026-03-07', ['Among Us']),
        noSession('2026-02-28'),
      ],
      games: [game('Among Us', 'Social deduction', 'Competitive', { tags: ['Multiplayer', 'Space'] })],
      notes: [{ kind: 'warning', text: 'sessions.csv line 9: no date' }],
    };
    const before = structuredClone(input);
    // Writing to a frozen object throws (modules are strict), so a mutation fails the test here.
    const data = buildHistory(deepFreeze(input));
    expect(input).toEqual(before);

    // And the result doesn't share the input's arrays.
    expect(data.sessions.map((s) => s.date)).toEqual(['2026-02-28', '2026-03-07', '2026-03-14']);
    expect(data.sessions[2]?.planned).not.toBe(input.sessions[0]?.planned);
    expect(gameNamed(data, 'Among Us').tags).toEqual(['Multiplayer', 'Space']);
    expect(gameNamed(data, 'Among Us').tags).not.toBe(input.games[0]?.tags);
  });
});

describe('play numbers', () => {
  it('counts each game up across the whole record', () => {
    const data = build([
      played('2025-12-20', ['Among Us']),
      played('2026-01-03', ['Duck Game', 'Among Us']),
      played('2026-01-10', ['Among Us']),
      played('2026-01-17', ['Duck Game']),
    ]);
    expect(playNumbers(data)).toEqual([[1], [1, 2], [3], [2]]);
    expect(data.games.map((g) => [g.name, g.plays])).toEqual([
      ['Among Us', 3],
      ['Duck Game', 2],
    ]);
  });

  it('numbers by date, not by the order of the rows', () => {
    const data = build([played('2026-01-10', ['Among Us'], { session: 'EG2' }), played('2026-01-03', ['Among Us'], { session: 'EG1' })]);
    expect(data.sessions.map((s) => [s.session, s.games[0]?.play])).toEqual([
      ['EG1', 1],
      ['EG2', 2],
    ]);
  });

  it('counts a game named twice in one session once', () => {
    const data = build([played('2026-01-03', ['Among Us', 'among us ']), played('2026-01-10', ['Among Us'])]);
    expect(data.sessions.map((s) => s.games)).toEqual([[{ name: 'Among Us', play: 1 }], [{ name: 'Among Us', play: 2 }]]);
  });

  it('skips blank game names', () => {
    const data = build([played('2026-01-03', ['', '   ', 'Among Us'])]);
    expect(data.sessions[0]?.games).toEqual([{ name: 'Among Us', play: 1 }]);
  });
});

describe('game identity', () => {
  const sessions = [played('2026-01-03', ['  among   us ']), played('2026-01-10', ['AMONG US']), played('2026-01-17', ['Among\tUs'])];

  it('ignores case and extra whitespace, and shows the first spelling seen', () => {
    const data = build(sessions);
    expect(data.games).toHaveLength(1);
    expect(data.games[0]).toMatchObject({ name: 'among us', plays: 3 });
    expect(data.sessions.map((s) => s.games)).toEqual([
      [{ name: 'among us', play: 1 }],
      [{ name: 'among us', play: 2 }],
      [{ name: 'among us', play: 3 }],
    ]);
  });

  it("shows the games.csv spelling when the game is listed there, however it's written", () => {
    const data = build(sessions, [game(' Among  Us', 'Social deduction')]);
    expect(data.games).toHaveLength(1);
    expect(data.games[0]).toMatchObject({ name: 'Among Us', plays: 3, style: 'Social deduction' });
    expect(data.sessions[0]?.games[0]?.name).toBe('Among Us');
    expect(slice(data, 'all').topGames).toEqual([{ name: 'Among Us', plays: 3 }]);
  });

  it('uses the first games.csv row when a game is listed twice', () => {
    const data = build(sessions, [game('Among Us', 'Social deduction'), game('AMONG US', 'Shooter')]);
    expect(data.games[0]).toMatchObject({ name: 'Among Us', style: 'Social deduction' });
  });

  it('keeps games with different names apart', () => {
    const data = build([played('2026-01-03', ['Overcooked']), played('2026-01-10', ['Overcooked! 2'])]);
    expect(data.games.map((g) => g.name).sort()).toEqual(['Overcooked', 'Overcooked! 2']);
  });

  it('takes the first spelling by date, not by the order of the rows', () => {
    const data = build([played('2026-01-10', ['DUCK GAME']), played('2026-01-03', ['Duck Game'])]);
    expect(data.games.map((g) => [g.name, g.plays])).toEqual([['Duck Game', 2]]);
  });

  it('treats the two ways of typing an accented letter as one name', () => {
    // "é" as one character, and as "e" plus a combining accent: they look the same on the page.
    const data = build(
      [played('2026-01-03', ['Pok\u00e9mon Unite']), played('2026-01-10', ['Poke\u0301mon Unite'])],
      [game('POKE\u0301MON UNITE', 'MOBA')],
    );
    expect(data.games).toHaveLength(1);
    expect(data.games[0]).toMatchObject({ plays: 2, style: 'MOBA' });
    expect(playNumbers(data)).toEqual([[1], [2]]);
  });

  it('keeps quotes, commas, emoji and non-Latin names as they are', () => {
    const names = ['"Quoted" Game', 'Commas, The Game', '🎲 Dice 🎲', '原神', 'Ünïcödé', "Don't Starve Together", '<b>Bold</b> & Co'];
    const data = build([played('2026-01-03', names), played('2026-01-10', ['原神', '🎲 dice 🎲'])], [game('原神', 'Open world')]);
    expect(data.sessions[0]?.games.map((g) => g.name)).toEqual(names);
    expect(data.games.slice(0, 2).map((g) => [g.name, g.plays, g.style])).toEqual([
      ['🎲 Dice 🎲', 2, UNCATEGORIZED],
      ['原神', 2, 'Open world'],
    ]);
    expect(data.games).toHaveLength(names.length);
    expect(sessionsExport(data)[1]?.[5]).toBe(names.join('; '));
  });

  it("isn't confused by names that are also properties of every object", () => {
    const data = build(
      [played('2026-01-03', ['__proto__', 'constructor', 'toString']), played('2026-01-10', ['constructor'])],
      [game('__proto__', '__proto__', 'constructor'), game('constructor', 'hasOwnProperty')],
    );
    expect(data.games.map((g) => [g.name, g.plays, g.style])).toEqual([
      ['constructor', 2, 'hasOwnProperty'],
      ['__proto__', 1, '__proto__'],
      ['toString', 1, UNCATEGORIZED],
    ]);
    // Compared as entries: `{ __proto__: 1 }` in an object literal would set the prototype instead.
    expect(Object.entries(data.years[0]?.styles ?? {}).sort()).toEqual([
      [UNCATEGORIZED, 1],
      ['__proto__', 1],
      ['hasOwnProperty', 2],
    ]);
    expect(Object.entries(JSON.parse(JSON.stringify(data.years[0]?.styles)) as object)).toHaveLength(3);
    expect(slice(data, 'all').modes).toEqual([
      { mode: 'Unknown', sessions: 2 },
      { mode: 'constructor', sessions: 1 },
    ]);
  });
});

describe('Special and off rows', () => {
  const data = build(
    [
      played('2026-01-03', ['Among Us'], { cost: 'Free' }),
      special('2026-01-10', ['Among Us', 'Iron Lung', 'Mystery Game'], { cost: 'Free', session: 'EG2' }),
      cancelled('2026-01-17', { planned: ['Duck Game'], cost: '$5' }),
      noSession('2026-01-24'),
      played('2026-01-31', ['Among Us'], { cost: 'Free' }),
    ],
    [game('Among Us', 'Social deduction', 'Competitive'), game('Iron Lung', 'Single-player', 'Spectate')],
  );

  it('lists them', () => {
    expect(data.sessions.map((s) => s.status)).toEqual(['Played', 'Special', 'Cancelled', 'No session', 'Played']);
    expect(slice(data, 'all')).toMatchObject({ played: 2, off: 2, special: 1 });
  });

  it("shows a Special row's games and styles, as play 0", () => {
    expect(data.sessions[1]).toMatchObject({
      games: [
        { name: 'Among Us', play: 0 },
        { name: 'Iron Lung', play: 0 },
        { name: 'Mystery Game', play: 0 },
      ],
      styles: ['Social deduction', 'Single-player', UNCATEGORIZED],
    });
  });

  it('never counts a Special row as a play', () => {
    expect(playNumbers(data)).toEqual([[1], [0, 0, 0], [], [], [2]]);
    expect(data.games.map((g) => [g.name, g.plays, g.dates])).toEqual([['Among Us', 2, ['2026-01-03', '2026-01-31']]]);
    expect(slice(data, 'all')).toMatchObject({
      distinctGames: 1,
      newGames: 1,
      onePlayGames: 0,
      topGames: [{ name: 'Among Us', plays: 2 }],
      styles: [{ style: 'Social deduction', sessions: 2, games: 1 }],
      modes: [{ mode: 'Competitive', sessions: 2 }],
    });
    expect(data.styles).toEqual(['Social deduction']);
    expect(data.years).toEqual([
      { year: '2026', newGameSessions: 1, returningSessions: 1, unknownSessions: 0, off: 2, styles: { 'Social deduction': 2 } },
    ]);
    // "Mystery Game" has no style, but it was never played.
    expect(data.notes).toEqual([]);
  });

  it('sets a cost kind only on Played rows', () => {
    expect(data.sessions.map((s) => s.costKind)).toEqual(['free', undefined, undefined, undefined, 'free']);
    expect(data.sessions[2]?.cost).toBe('$5');
    expect(slice(data, 'all').costs).toEqual([
      { kind: 'free', sessions: 2 },
      { kind: 'keys', sessions: 0 },
      { kind: 'paid', sessions: 0 },
      { kind: 'unknown', sessions: 0 },
    ]);
  });

  it("doesn't count what a cancelled week had planned", () => {
    expect(data.sessions[2]?.planned).toEqual(['Duck Game']);
    expect(data.games.map((g) => g.name)).not.toContain('Duck Game');
  });

  it("doesn't count games listed on an off week", () => {
    const off = build([
      played('2026-01-03', ['Among Us'], { cost: 'Free' }),
      cancelled('2026-01-10', { games: ['Among Us', 'Duck Game'], cost: 'Free' }),
      noSession('2026-01-17', { games: ['Duck Game'] }),
      played('2026-01-24', ['Among Us']),
    ]);
    expect(playNumbers(off)).toEqual([[1], [0, 0], [0], [2]]);
    expect(off.games.map((g) => [g.name, g.plays])).toEqual([['Among Us', 2]]);
    expect(off.sessions.map((s) => s.costKind)).toEqual(['free', undefined, undefined, 'unknown']);
    expect(slice(off, 'all')).toMatchObject({
      played: 2,
      off: 2,
      distinctGames: 1,
      newGames: 1,
      longestRun: { name: 'Among Us', length: 2, from: '2026-01-03', to: '2026-01-24' },
    });
    expect(off.years[0]).toMatchObject({ newGameSessions: 1, returningSessions: 1, unknownSessions: 0, off: 2 });
  });
});

describe('runs', () => {
  const longestRuns = (data: HistoryData) => Object.fromEntries(data.games.map((g) => [g.name, g.longestRun]));

  it('counts consecutive Played sessions of a game', () => {
    const data = build([
      played('2026-01-03', ['ROUNDS']),
      played('2026-01-10', ['ROUNDS']),
      played('2026-01-17', ['Duck Game']),
      played('2026-01-24', ['ROUNDS']),
      played('2026-01-31', ['ROUNDS']),
      played('2026-02-07', ['ROUNDS']),
    ]);
    expect(longestRuns(data)).toEqual({ ROUNDS: 3, 'Duck Game': 1 });
    expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 3, from: '2026-01-24', to: '2026-02-07' });
  });

  it("isn't broken by an off week or a Special session", () => {
    const data = build([
      played('2026-01-03', ['ROUNDS']),
      noSession('2026-01-10'),
      cancelled('2026-01-17'),
      played('2026-01-24', ['ROUNDS']),
      special('2026-01-31', ['Iron Lung']),
      played('2026-02-07', ['ROUNDS']),
    ]);
    expect(longestRuns(data)).toEqual({ ROUNDS: 3 });
    expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 3, from: '2026-01-03', to: '2026-02-07' });
  });

  it('is broken by a Played session with no game recorded', () => {
    const data = build([
      played('2026-01-03', ['ROUNDS']),
      played('2026-01-10', ['ROUNDS']),
      played('2026-01-17'),
      played('2026-01-24', ['ROUNDS']),
    ]);
    expect(longestRuns(data)).toEqual({ ROUNDS: 2 });
    expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 2, from: '2026-01-03', to: '2026-01-10' });
  });

  it('follows each game of a session separately', () => {
    const data = build([
      played('2026-01-03', ['ROUNDS', 'Duck Game']),
      played('2026-01-10', ['Duck Game']),
      played('2026-01-17', ['Duck Game', 'Among Us']),
      played('2026-01-24', ['ROUNDS']),
    ]);
    expect(longestRuns(data)).toEqual({ 'Duck Game': 3, ROUNDS: 1, 'Among Us': 1 });
  });

  it('is 1 for a game that was never played twice in a row, and the slice then has no longest run', () => {
    const data = build([played('2026-01-03', ['ROUNDS']), played('2026-01-10', ['Duck Game']), played('2026-01-17', ['ROUNDS'])]);
    expect(longestRuns(data)).toEqual({ ROUNDS: 1, 'Duck Game': 1 });
    expect(slice(data, 'all').longestRun).toBeUndefined();
    expect(slice(data, 'all')).not.toHaveProperty('longestRun');
  });

  it('counts two sessions on the same day', () => {
    const data = build([played('2026-01-03', ['ROUNDS']), played('2026-01-03', ['ROUNDS'])]);
    expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 2, from: '2026-01-03', to: '2026-01-03' });
  });

  it('names the first game A-Z when two ran through the same sessions', () => {
    const data = build([played('2026-01-03', ['ROUNDS', 'Duck Game']), played('2026-01-10', ['Duck Game', 'ROUNDS'])]);
    expect(slice(data, 'all').longestRun).toEqual({ name: 'Duck Game', length: 2, from: '2026-01-03', to: '2026-01-10' });
  });
});

describe('games', () => {
  it('describes each played game', () => {
    const data = build(
      [
        played('2026-05-02', ['Duck Game'], { session: 'EG7' }),
        played('2026-05-09', ['Duck Game']),
        played('2026-06-01', ['Duck Game'], { session: 'EG9 RETRY' }),
      ],
      [
        game('Duck Game', '2D platform fighter', 'Competitive', {
          where: 'Steam',
          link: 'https://example.com/duck-game',
          tags: ['Local Multiplayer', 'Pixel Graphics'],
          developer: 'Landon Podbielski',
        }),
        game('Never Played', 'Shooter'),
      ],
    );
    expect(data.games).toEqual([
      {
        name: 'Duck Game',
        plays: 3,
        dates: ['2026-05-02', '2026-05-09', '2026-06-01'],
        firstSession: 'EG7',
        lastSession: 'EG9 RETRY',
        daysSince: 14,
        longestRun: 3,
        style: '2D platform fighter',
        mode: 'Competitive',
        where: 'Steam',
        link: 'https://example.com/duck-game',
        tags: ['Local Multiplayer', 'Pixel Graphics'],
        developer: 'Landon Podbielski',
      },
    ]);
  });

  it('is Uncategorized, with no mode, for a game that has no row or an empty one', () => {
    const data = build(
      [played('2026-05-02', ['Duck Game', 'Skribbl.io', 'ROUNDS'])],
      [game('Duck Game', '', ''), game('ROUNDS', '  ', '  ')],
    );
    for (const name of ['Duck Game', 'Skribbl.io', 'ROUNDS']) {
      const view = gameNamed(data, name);
      expect(view).toMatchObject({ style: UNCATEGORIZED, tags: [] });
      expect(view).not.toHaveProperty('mode');
      expect(view).not.toHaveProperty('firstSession');
      expect(view).not.toHaveProperty('lastSession');
      expect(view).not.toHaveProperty('link');
    }
  });

  it('counts whole days since the last play, never below zero', () => {
    const data = build([
      played('2025-06-14', ['Long Ago']),
      played(TODAY, ['Today']),
      played('2026-06-14', ['Yesterday']),
      played('2026-06-20', ['Next Week']),
    ]);
    expect(Object.fromEntries(data.games.map((g) => [g.name, g.daysSince]))).toEqual({
      'Long Ago': 366,
      Today: 0,
      Yesterday: 1,
      'Next Week': 0,
    });
  });

  it('counts days across a leap day', () => {
    const data = build([played('2024-02-28', ['Duck Game'])], [], { today: '2024-03-01' });
    expect(data.games[0]?.daysSince).toBe(2);
  });

  it('counts a leap year as 366 days', () => {
    const before = build([played('2024-02-29', ['Duck Game'])], [], { today: '2025-02-28' });
    expect(before.games[0]?.daysSince).toBe(365);
    const after = build([played('2024-02-29', ['Duck Game'])], [], { today: '2025-03-01' });
    expect(after.games[0]?.daysSince).toBe(366);
    expect(build([played('2023-03-01', ['Duck Game'])], [], { today: '2024-03-01' }).games[0]?.daysSince).toBe(366);
  });

  it('counts calendar days, not 24-hour periods, across a clock change', () => {
    // Made-up sessions around the US and EU clock changes of 2026, when a day is 23 or 25 hours long.
    const days = (from: string, today: string) => build([played(from, ['Duck Game'])], [], { today }).games[0]?.daysSince;
    expect(days('2026-03-07', '2026-03-08')).toBe(1);
    expect(days('2026-03-07', '2026-03-09')).toBe(2);
    expect(days('2026-03-28', '2026-03-30')).toBe(2);
    expect(days('2026-10-24', '2026-10-26')).toBe(2);
    expect(days('2026-10-31', '2026-11-02')).toBe(2);
    const data = build([played('2026-03-08'), played('2026-03-29'), played('2026-10-25'), played('2026-11-01')]);
    expect(data.sessions.map((s) => s.day)).toEqual(['Sunday', 'Sunday', 'Sunday', 'Sunday']);
  });

  it('counts one day from New Year\'s Eve to New Year\'s Day', () => {
    const data = build([played('2025-12-31', ['Duck Game'])], [], { today: '2026-01-01' });
    expect(data.games[0]?.daysSince).toBe(1);
    expect(data.sessions[0]?.day).toBe('Wednesday');
  });

  it('only passes on http and https links', () => {
    const links: [string, string | undefined][] = [
      ['https://example.com/duck-game', 'https://example.com/duck-game'],
      ['HTTP://example.com/', 'HTTP://example.com/'],
      ['  https://example.com/padded ', 'https://example.com/padded'],
      ['javascript:alert(1)', undefined],
      [' JaVaScRiPt:alert(1)', undefined],
      ['java\tscript:alert(1)', undefined],
      ['data:text/html,<script>alert(1)</script>', undefined],
      ['vbscript:msgbox(1)', undefined],
      ['file:///etc/passwd', undefined],
      ['steam://run/440', undefined],
      ['//example.com/no-scheme', undefined],
      ['example.com', undefined],
      ['https://', undefined],
      ['   ', undefined],
    ];
    const names = links.map((_, index) => `Game ${index}`);
    const data = build(
      [played('2026-05-02', names)],
      links.map(([link], index) => game(`Game ${index}`, 'Shooter', undefined, { link })),
    );
    expect(names.map((name) => [name, gameNamed(data, name).link])).toEqual(links.map(([, kept], index) => [`Game ${index}`, kept]));
    expect(gameNamed(data, 'Game 3')).not.toHaveProperty('link');
    // The download has no dangerous links either.
    expect(gamesExport(data).slice(1).map((cells) => cells[13]).filter(Boolean).sort()).toEqual([
      'HTTP://example.com/',
      'https://example.com/duck-game',
      'https://example.com/padded',
    ]);
  });

  it('sorts by plays, then the most recent last play, then name', () => {
    const data = build([
      played('2026-01-03', ['Zeepkist', 'bean battles']),
      played('2026-01-10', ['Among Us', 'Duck Game']),
      played('2026-01-17', ['Witch It', 'Among Us']),
      played('2026-01-24', ['Duck Game']),
      played('2026-01-31', ['Among Us']),
    ]);
    expect(data.games.map((g) => [g.name, g.plays])).toEqual([
      ['Among Us', 3],
      ['Duck Game', 2],
      ['Witch It', 1], // last played Jan 17
      ['bean battles', 1], // Jan 3, and "b" before "Z" whatever the case
      ['Zeepkist', 1],
    ]);
  });
});

describe('slices', () => {
  it('lists all time, the last 12 months, then each year with rows, newest first', () => {
    const data = build([played('2023-04-01', ['Among Us']), noSession('2025-09-06'), played('2026-05-02', ['Among Us'])]);
    expect(data.slices.map((s) => [s.key, s.label, s.from, s.to])).toEqual([
      ['all', 'All time', '2023-04-01', '2026-05-02'],
      ['recent', 'Last 12 months', '2025-09-06', '2026-05-02'],
      ['2026', '2026', '2026-05-02', '2026-05-02'],
      ['2025', '2025', '2025-09-06', '2025-09-06'],
      ['2023', '2023', '2023-04-01', '2023-04-01'],
    ]);
  });

  it('leaves out the last 12 months when nothing happened in them', () => {
    const data = build([played('2023-04-01', ['Among Us']), played('2024-04-06', ['Among Us'])]);
    expect(data.slices.map((s) => s.key)).toEqual(['all', '2024', '2023']);
  });

  it('leaves out the last 12 months, and counts no days, when "today" isn\'t a date', () => {
    for (const today of ['', '   ', 'today', '2026-6-15']) {
      const data = build(['2024-05-11', '2024-05-18', '2024-05-25'].map((date) => played(date, ['Among Us'])), [], { today });
      expect(data.slices.map((s) => s.key)).toEqual(['all', '2024']);
      expect(data.games.map((g) => [g.plays, g.daysSince])).toEqual([[3, 0]]);
      expect(data.overdue).toEqual([]);
      expect(data.today).toBe(today);
    }
  });

  it('counts "recent" from the day after the same day last year, up to today', () => {
    const data = build([
      played('2025-06-14', ['A']),
      played('2025-06-15', ['B']), // a year ago to the day: out
      played('2025-06-16', ['C']),
      played('2026-06-15', ['D']), // today
      played('2026-06-16', ['E']), // tomorrow: out
    ]);
    const recent = slice(data, 'recent');
    expect(recent).toMatchObject({ from: '2025-06-16', to: '2026-06-15', played: 2, distinctGames: 2 });
    expect(recent.topGames.map((g) => g.name)).toEqual(['D', 'C']);
    // Rows dated after today still count everywhere else.
    expect(slice(data, 'all')).toMatchObject({ from: '2025-06-14', to: '2026-06-16', played: 5 });
    expect(slice(data, '2026').played).toBe(2);
  });

  it('handles a "today" of Feb 29', () => {
    const data = build([played('2023-02-28', ['A']), played('2023-03-01', ['B']), played('2024-02-29', ['C'])], [], {
      today: '2024-02-29',
    });
    expect(slice(data, 'recent')).toMatchObject({ from: '2023-03-01', to: '2024-02-29', played: 2 });
  });

  it('counts a Feb 29 as recent a year later, on Feb 28', () => {
    const data = build([played('2024-02-28', ['A']), played('2024-02-29', ['B']), played('2025-02-28', ['C'])], [], {
      today: '2025-02-28',
    });
    expect(slice(data, 'recent')).toMatchObject({ from: '2024-02-29', to: '2025-02-28', played: 2 });
  });

  it('splits the years between Dec 31 and Jan 1', () => {
    const data = build([played('2025-12-31', ['A']), played('2026-01-01', ['A']), noSession('2026-12-31')], [], { today: '2026-12-31' });
    expect(data.slices.map((s) => [s.key, s.from, s.to, s.played, s.off, s.newGames])).toEqual([
      ['all', '2025-12-31', '2026-12-31', 2, 1, 1],
      // A year back from Dec 31 is Dec 31: that day itself is out.
      ['recent', '2026-01-01', '2026-12-31', 1, 1, 0],
      ['2026', '2026-01-01', '2026-12-31', 1, 1, 0],
      ['2025', '2025-12-31', '2025-12-31', 1, 0, 1],
    ]);
    expect(data.years.map((y) => [y.year, y.newGameSessions, y.returningSessions, y.off])).toEqual([
      ['2025', 1, 0, 0],
      ['2026', 0, 1, 1],
    ]);
  });

  it('has the same totals in every slice for a record of one row', () => {
    const one = build([played('2026-03-07', ['Among Us'], { session: 'EG1', cost: 'Free' })], [game('Among Us', 'Social deduction', 'Competitive')]);
    expect(one.slices.map((s) => s.key)).toEqual(['all', 'recent', '2026']);
    for (const s of one.slices) {
      expect(s).toMatchObject({
        from: '2026-03-07',
        to: '2026-03-07',
        played: 1,
        off: 0,
        special: 0,
        distinctGames: 1,
        newGames: 1,
        onePlayGames: 1,
        topGames: [{ name: 'Among Us', plays: 1 }],
        styles: [{ style: 'Social deduction', sessions: 1, games: 1 }],
        modes: [{ mode: 'Competitive', sessions: 1 }],
      });
      expect(s).not.toHaveProperty('longestRun');
    }
    expect(one.games.map((g) => [g.name, g.plays, g.longestRun, g.daysSince])).toEqual([['Among Us', 1, 1, 100]]);
    expect(one.milestones).toEqual([{ session: 'EG1', date: '2026-03-07', games: ['Among Us'] }]);

    const unknown = build([played('2026-03-07')]);
    expect(slice(unknown, 'all')).toMatchObject({ played: 1, distinctGames: 0, newGames: 0, topGames: [], styles: [], modes: [] });
    expect(slice(unknown, 'all').costs.every((cost) => cost.sessions === 0)).toBe(true);
    expect(unknown.years).toEqual([{ year: '2026', newGameSessions: 0, returningSessions: 0, unknownSessions: 1, off: 0, styles: {} }]);
    expect(unknown.milestones).toEqual([{ session: 'First session', date: '2026-03-07', games: [] }]);
    expect(unknown.notes).toEqual([]);
  });

  it('counts rows, games, new games and one-play games inside the range only', () => {
    const data = build([
      played('2025-03-01', ['Among Us']),
      played('2025-03-08', ['Among Us', 'Duck Game']),
      cancelled('2025-03-15'),
      played('2025-03-22'),
      special('2025-03-29', ['Iron Lung']),
      played('2026-02-07', ['Duck Game']),
      played('2026-02-14', ['ROUNDS', 'Witch It']),
      played('2026-02-21', ['ROUNDS']),
      noSession('2026-02-28'),
      noSession('2026-03-07'),
    ]);
    expect(slice(data, '2025')).toMatchObject({
      played: 3,
      off: 1,
      special: 1,
      distinctGames: 2,
      newGames: 2,
      onePlayGames: 1, // Duck Game
      topGames: [
        { name: 'Among Us', plays: 2 },
        { name: 'Duck Game', plays: 1 },
      ],
    });
    expect(slice(data, '2026')).toMatchObject({
      played: 3,
      off: 2,
      special: 0,
      distinctGames: 3,
      newGames: 2, // ROUNDS and Witch It; Duck Game was first played in 2025
      onePlayGames: 2, // Duck Game (once this year, twice in all) and Witch It
      topGames: [
        { name: 'ROUNDS', plays: 2 },
        { name: 'Witch It', plays: 1 },
        { name: 'Duck Game', plays: 1 },
      ],
    });
    expect(slice(data, 'all')).toMatchObject({ played: 6, off: 3, special: 1, distinctGames: 4, newGames: 4, onePlayGames: 1 });
  });

  it('breaks ties in the top games by the most recent play in the range, then by name', () => {
    const data = build([
      played('2025-01-04', ['Among Us']),
      played('2025-02-01', ['Bean Battles']),
      played('2025-03-01', ['Among Us']),
      played('2025-04-05', ['Bean Battles']),
      played('2025-05-03', ['Zeepkist', 'Duck Game', 'cold space']),
      played('2026-01-10', ['Among Us']),
    ]);
    // In 2025 both were played twice, Bean Battles more recently. Among Us's 2026 play doesn't count here.
    expect(slice(data, '2025').topGames).toEqual([
      { name: 'Bean Battles', plays: 2 },
      { name: 'Among Us', plays: 2 },
      { name: 'cold space', plays: 1 },
      { name: 'Duck Game', plays: 1 },
      { name: 'Zeepkist', plays: 1 },
    ]);
    expect(slice(data, 'all').topGames.slice(0, 2)).toEqual([
      { name: 'Among Us', plays: 3 },
      { name: 'Bean Battles', plays: 2 },
    ]);
  });

  it('lists at most 15 top games', () => {
    const dates = weekly('2026-01-03', 17);
    const sessions = dates.map((date, week) => played(date, [`Game ${String.fromCharCode(65 + week)}`]));
    const all = slice(build([...sessions, played('2026-05-02', ['Game A'])]), 'all');
    expect(all.distinctGames).toBe(17);
    expect(all.onePlayGames).toBe(16);
    expect(all.topGames).toHaveLength(15);
    expect(all.topGames[0]).toEqual({ name: 'Game A', plays: 2 });
    // Then the most recently played: Q (week 17) down to D.
    expect(all.topGames[1]).toEqual({ name: 'Game Q', plays: 1 });
    expect(all.topGames[14]).toEqual({ name: 'Game D', plays: 1 });
  });

  describe('styles, modes and costs', () => {
    const catalog = [
      game('Among Us', 'Social deduction', 'Competitive'),
      game('Project Winter', 'Social deduction', 'Competitive'),
      game('Duck Game', '2D platform fighter', 'Competitive'),
      game('Overcooked! 2', 'Party & minigames', 'Co-op'),
      game('Golf It!', 'Party & minigames'),
    ];
    const data = build(
      [
        played('2025-11-01', ['Among Us', 'Project Winter'], { cost: 'Free' }), // one style, one session
        played('2025-11-08', ['Among Us', 'Duck Game'], { cost: '$4.99' }), // two styles: counts for both
        played('2025-11-15', ['Overcooked! 2'], { cost: 'Host gave out keys' }),
        played('2025-11-22', ['Skribbl.io']), // not in games.csv
        played('2025-11-29', [], { cost: 'Free' }), // no game recorded
        special('2025-12-06', ['Duck Game'], { cost: 'Free' }),
        played('2026-01-03', ['Golf It!', 'Overcooked! 2'], { cost: 'free (demo)' }),
        played('2026-01-10', ['Among Us'], { cost: 'Free' }),
      ],
      catalog,
    );

    it('counts a session once per distinct style, and the different games of each style', () => {
      expect(slice(data, 'all').styles).toEqual([
        { style: 'Social deduction', sessions: 3, games: 2 },
        { style: 'Party & minigames', sessions: 2, games: 2 },
        { style: '2D platform fighter', sessions: 1, games: 1 },
        { style: UNCATEGORIZED, sessions: 1, games: 1 },
      ]);
      expect(slice(data, '2025').styles).toEqual([
        { style: 'Social deduction', sessions: 2, games: 2 },
        // One session each: A-Z.
        { style: '2D platform fighter', sessions: 1, games: 1 },
        { style: 'Party & minigames', sessions: 1, games: 1 },
        { style: UNCATEGORIZED, sessions: 1, games: 1 },
      ]);
      expect(slice(data, '2026').styles).toEqual([
        { style: 'Party & minigames', sessions: 1, games: 2 },
        { style: 'Social deduction', sessions: 1, games: 1 },
      ]);
    });

    it('lists every style at the top level in all-time order', () => {
      expect(data.styles).toEqual(['Social deduction', 'Party & minigames', '2D platform fighter', UNCATEGORIZED]);
    });

    it('counts modes the same way, with "Unknown" for games that have none', () => {
      expect(slice(data, 'all').modes).toEqual([
        { mode: 'Competitive', sessions: 3 },
        { mode: 'Co-op', sessions: 2 },
        { mode: 'Unknown', sessions: 2 }, // Skribbl.io, and Golf It! (listed, but with no mode)
      ]);
      expect(slice(data, '2026').modes).toEqual([
        { mode: 'Co-op', sessions: 1 },
        { mode: 'Competitive', sessions: 1 },
        { mode: 'Unknown', sessions: 1 },
      ]);
      expect(gameNamed(data, 'Golf It!').mode).toBeUndefined();
    });

    it('counts cost kinds for Played sessions that name a game', () => {
      expect(slice(data, 'all').costs).toEqual([
        { kind: 'free', sessions: 3 },
        { kind: 'keys', sessions: 1 },
        { kind: 'paid', sessions: 1 },
        { kind: 'unknown', sessions: 1 },
      ]);
      expect(slice(data, '2026').costs).toEqual([
        { kind: 'free', sessions: 2 },
        { kind: 'keys', sessions: 0 },
        { kind: 'paid', sessions: 0 },
        { kind: 'unknown', sessions: 0 },
      ]);
      // The Played row with no game keeps its cost text but has no kind.
      expect(data.sessions[4]).toMatchObject({ cost: 'Free', games: [] });
      expect(data.sessions[4]).not.toHaveProperty('costKind');
    });
  });

  describe('longest run', () => {
    it('counts only the part of a run inside the range', () => {
      const data = build([
        played('2025-12-13', ['ROUNDS']),
        played('2025-12-20', ['ROUNDS']),
        played('2025-12-27', ['ROUNDS']),
        played('2026-01-03', ['ROUNDS']),
        played('2026-01-10', ['ROUNDS']),
        played('2026-01-17', ['Duck Game']),
      ]);
      expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 5, from: '2025-12-13', to: '2026-01-10' });
      expect(slice(data, '2025').longestRun).toEqual({ name: 'ROUNDS', length: 3, from: '2025-12-13', to: '2025-12-27' });
      expect(slice(data, '2026').longestRun).toEqual({ name: 'ROUNDS', length: 2, from: '2026-01-03', to: '2026-01-10' });
      expect(gameNamed(data, 'ROUNDS').longestRun).toBe(5);
    });

    it('has none in a range where a run is cut down to one session', () => {
      const data = build([played('2025-12-27', ['ROUNDS']), played('2026-01-03', ['ROUNDS'])]);
      expect(slice(data, 'all').longestRun).toMatchObject({ name: 'ROUNDS', length: 2 });
      expect(slice(data, '2025').longestRun).toBeUndefined();
      expect(slice(data, '2026').longestRun).toBeUndefined();
    });

    it('cuts a run at the start of the last 12 months too', () => {
      // With today = 2026-06-15, "recent" starts on 2025-06-16.
      const data = build(['2025-06-01', '2025-06-08', '2025-06-15', '2025-06-22', '2025-06-29'].map((date) => played(date, ['ROUNDS'])));
      expect(slice(data, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 5, from: '2025-06-01', to: '2025-06-29' });
      expect(slice(data, 'recent').longestRun).toEqual({ name: 'ROUNDS', length: 2, from: '2025-06-22', to: '2025-06-29' });
    });

    it('prefers the most recent of equally long runs, but a longer one over a recent one', () => {
      const tied = build([
        played('2026-01-03', ['ROUNDS']),
        played('2026-01-10', ['ROUNDS']),
        played('2026-01-17', ['Duck Game']),
        played('2026-01-24', ['Duck Game']),
        played('2026-01-31', ['Among Us']),
      ]);
      expect(slice(tied, 'all').longestRun).toEqual({ name: 'Duck Game', length: 2, from: '2026-01-17', to: '2026-01-24' });

      const longer = build([
        played('2026-01-03', ['ROUNDS']),
        played('2026-01-10', ['ROUNDS']),
        played('2026-01-17', ['ROUNDS']),
        played('2026-01-24', ['Duck Game']),
        played('2026-01-31', ['Duck Game']),
      ]);
      expect(slice(longer, 'all').longestRun).toEqual({ name: 'ROUNDS', length: 3, from: '2026-01-03', to: '2026-01-17' });
    });
  });
});

describe('years', () => {
  it('splits each year into new-game, returning and unknown sessions, oldest year first', () => {
    const data = build(
      [
        played('2026-01-10', ['Among Us', 'Witch It']), // one old, one new: a new-game session
        played('2026-01-03', ['Among Us']),
        played('2024-05-04', ['Among Us']),
        played('2024-05-11', ['Among Us', 'Duck Game']),
        played('2024-05-18', ['Duck Game']),
        played('2024-05-25'),
        cancelled('2024-06-01'),
        noSession('2024-06-08'),
        special('2024-06-15', ['Iron Lung']),
        noSession('2025-07-05'),
      ],
      [game('Among Us', 'Social deduction'), game('Duck Game', '2D platform fighter'), game('Witch It', 'Prop hunt')],
    );
    expect(data.years).toEqual([
      {
        year: '2024',
        newGameSessions: 2,
        returningSessions: 1,
        unknownSessions: 1,
        off: 2,
        styles: { 'Social deduction': 2, '2D platform fighter': 2 },
      },
      { year: '2025', newGameSessions: 0, returningSessions: 0, unknownSessions: 0, off: 1, styles: {} },
      {
        year: '2026',
        newGameSessions: 1,
        returningSessions: 1,
        unknownSessions: 0,
        off: 0,
        styles: { 'Social deduction': 2, 'Prop hunt': 1 },
      },
    ]);
  });

  it('counts a session with two games of one style once for that style', () => {
    const data = build(
      [played('2026-01-03', ['Among Us', 'Project Winter'])],
      [game('Among Us', 'Social deduction'), game('Project Winter', 'Social deduction')],
    );
    expect(data.years[0]?.styles).toEqual({ 'Social deduction': 1 });
  });
});

describe('overdue', () => {
  it('lists games played 3+ times and not for more than a year, most played first', () => {
    const data = build([
      // Four plays, last one 744 days ago.
      ...['2024-05-11', '2024-05-18', '2024-05-25', '2024-06-01'].map((date) => played(date, ['Spellsworn'])),
      // Three plays, last one 891 days ago.
      ...['2023-12-23', '2023-12-30', '2024-01-06'].map((date) => played(date, ['Sky Noon'])),
      // Three plays, last one 366 days ago.
      ...['2025-05-31', '2025-06-07', '2025-06-14'].map((date) => played(date, ['Bean Battles'])),
      // Three plays, last one exactly 365 days ago: not yet.
      ...['2025-06-01', '2025-06-08', '2025-06-15'].map((date) => played(date, ['Pummel Party'])),
      // Long ago, but only played twice.
      ...['2023-01-07', '2023-01-14'].map((date) => played(date, ['Muck'])),
      // Played a lot, and recently.
      ...['2026-05-09', '2026-05-16', '2026-05-23', '2026-05-30', '2026-06-06'].map((date) => played(date, ['Among Us'])),
    ]);
    expect(data.overdue).toEqual([
      { name: 'Spellsworn', plays: 4, last: '2024-06-01', daysSince: 744 },
      { name: 'Sky Noon', plays: 3, last: '2024-01-06', daysSince: 891 },
      { name: 'Bean Battles', plays: 3, last: '2025-06-14', daysSince: 366 },
    ]);
  });

  it('lists games that tie on both A-Z', () => {
    const data = build(['2024-05-11', '2024-05-18', '2024-05-25'].map((date) => played(date, ['Sky Noon', 'bean battles', 'Muck'])));
    expect(data.overdue.map((game) => game.name)).toEqual(['bean battles', 'Muck', 'Sky Noon']);
  });
});

describe('milestones', () => {
  it('lists the first session and each session numbered a multiple of 50', () => {
    const data = build([
      noSession('2020-01-04'),
      played('2020-01-11', ['Teeworlds'], { session: 'EG1' }),
      played('2020-12-19', ['Duck Game', 'Among Us'], { session: 'EG50' }),
      played('2021-01-09', ['Muck'], { session: 'EG51' }),
      played('2021-12-18', ['Teeworlds'], { session: 'EG100' }),
      played('2022-01-08', ['ROUNDS'], { session: 'EG100' }), // the number was used twice
      special('2022-12-17', ['Iron Lung'], { session: 'EG150' }),
      cancelled('2023-12-16', { session: 'EG200' }),
      played('2023-12-23', ['Sky Noon'], { session: 'EG199.5' }),
      played('2024-12-21', [], { session: 'EG250 RETRY' }),
      played('2025-01-04', ['Muck'], { session: 'EG0' }),
      played('2025-01-11', ['Muck'], { session: 'Anniversary' }),
      played('2025-01-18', ['Muck']),
    ]);
    expect(data.milestones).toEqual([
      { session: 'EG1', date: '2020-01-11', games: ['Teeworlds'] },
      { session: 'EG50', date: '2020-12-19', games: ['Duck Game', 'Among Us'] },
      { session: 'EG100', date: '2021-12-18', games: ['Teeworlds'] },
      { session: 'EG250 RETRY', date: '2024-12-21', games: [] },
    ]);
  });

  it('calls an unnamed first session "First session"', () => {
    const data = build([played('2020-01-11', ['Teeworlds']), played('2020-01-18', ['Muck'], { session: 'EG2' })]);
    expect(data.milestones).toEqual([{ session: 'First session', date: '2020-01-11', games: ['Teeworlds'] }]);
  });

  it('calls a first session whose name is only spaces "First session" too', () => {
    const data = build([played('2020-01-11', ['Teeworlds'], { session: '   ' }), played('2020-01-18', ['Muck'], { session: 'EG2' })]);
    expect(data.milestones).toEqual([{ session: 'First session', date: '2020-01-11', games: ['Teeworlds'] }]);
  });

  it('lists a late first session once, under its own name', () => {
    const data = build([noSession('2023-03-04'), played('2023-03-11', ['Muck'], { session: 'EG100 RETRY' }), played('2023-03-18', ['Muck'], { session: 'EG100' })]);
    expect(data.milestones).toEqual([{ session: 'EG100 RETRY', date: '2023-03-11', games: ['Muck'] }]);
  });

  it("doesn't list the first session twice when it is a milestone itself", () => {
    const data = build([
      played('2023-03-04', ['Teeworlds'], { session: 'EG50' }),
      played('2023-03-11', ['Muck'], { session: 'EG50' }),
      played('2024-03-02', ['ROUNDS'], { session: 'EG100' }),
    ]);
    expect(data.milestones.map((m) => [m.session, m.date])).toEqual([
      ['EG50', '2023-03-04'],
      ['EG100', '2024-03-02'],
    ]);
  });

  it('uses the first Played row, wherever it is in the file', () => {
    const data = build([
      played('2021-06-05', ['Muck'], { session: 'EG50' }),
      special('2020-01-04', ['Iron Lung'], { session: 'EG0.5' }),
      played('2020-01-11', ['Teeworlds'], { session: 'EG1' }),
    ]);
    expect(data.milestones.map((m) => m.session)).toEqual(['EG1', 'EG50']);
  });
});

describe('costKind', () => {
  it.each([
    ['Free', 'free'],
    ['free', 'free'],
    ['  Free (demo)', 'free'],
    ["Free (Friend's Pass)", 'free'],
    ['Free on mobile, $2.99 on Steam', 'free'],
    ['Host gave out keys', 'keys'],
    ['host had spare keys', 'keys'],
    ['$2.99', 'paid'],
    ['$15 (host had spare keys)', 'paid'],
    ['£3', 'paid'],
    ['about €5', 'paid'],
    ['4.99', 'paid'],
    ['5 dollars', 'paid'],
    ['Game Pass', 'unknown'],
    ['Not free', 'unknown'],
    ['?', 'unknown'],
    ['', 'unknown'],
    ['   ', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%j is %s', (cost, kind) => {
    expect(costKind(cost)).toBe(kind);
  });
});

describe('sessionNumber', () => {
  it.each([
    ['EG289', 289],
    ['EG199.5', 199.5],
    ['EG284 RETRY', 284],
    ['eg 12', 12],
    ['EG50.', 50],
    ['Session 7 (rescheduled from 6)', 7],
    ['Anniversary', undefined],
    ['', undefined],
    [undefined, undefined],
  ] as const)('%j -> %j', (label, number) => {
    expect(sessionNumber(label)).toBe(number);
  });
});

describe('notes', () => {
  it('passes the given notes through first, then names the played games with no style', () => {
    const warning = { kind: 'warning' as const, text: 'sessions.csv line 4: unknown status "Playd"' };
    const data = build(
      [
        played('2026-01-03', ['Skribbl.io', 'Among Us']),
        played('2026-01-10', ['Muck']),
        played('2026-01-17', ['Muck', 'Golf It!']),
        special('2026-01-24', ['Iron Lung']),
      ],
      [game('Among Us', 'Social deduction'), game('Golf It!', '')],
      { notes: [warning] },
    );
    // Most played first, like the games list.
    expect(data.notes).toEqual([warning, { kind: 'info', text: 'No style set for: Muck, Golf It!, Skribbl.io. Add them to games.csv.' }]);
  });

  it('names at most 15 games, then counts the rest', () => {
    const names = Array.from({ length: 17 }, (_, i) => `Game ${String.fromCharCode(65 + i)}`);
    const data = build([played('2026-01-03', names)]);
    expect(data.notes).toEqual([
      {
        kind: 'info',
        text: `No style set for: ${names.slice(0, 15).join(', ')} and 2 more. Add them to games.csv.`,
      },
    ]);

    const fifteen = build([played('2026-01-03', names.slice(0, 15))]);
    expect(fifteen.notes[0]?.text).toBe(`No style set for: ${names.slice(0, 15).join(', ')}. Add them to games.csv.`);
  });

  it('adds nothing when every played game has a style', () => {
    const data = build([played('2026-01-03', ['Among Us'])], [game('Among Us', 'Social deduction')]);
    expect(data.notes).toEqual([]);
  });
});

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [100, '100th'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
    [122, '122nd'],
  ])('%d -> %s', (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe('sessionsExport', () => {
  it('has a header row and one row per session', () => {
    const data = build(
      [
        played('2026-03-07', ['Among Us'], {
          session: 'EG12',
          start: '10:30am',
          planned: ['Duck Game', 'Golf It!'],
          cost: 'Free',
          announcedBy: 'Robin',
          source: '#announcements',
          notes: 'Servers were down, so "Among Us" it was',
        }),
        played('2026-03-14', ['Among Us'], { session: 'EG13' }),
        played('2026-03-21', ['Duck Game', 'Among Us', 'Skribbl.io']),
        played('2026-03-28'),
        special('2026-04-04', ['Among Us']),
        cancelled('2026-04-11', { planned: ['Duck Game'] }),
        noSession('2026-04-18'),
      ],
      [game('Among Us', 'Social deduction'), game('Duck Game', '2D platform fighter')],
    );
    expect(sessionsExport(data)).toEqual([
      ['Session', 'Date', 'Day', 'Start', 'Status', 'Games', 'Planned', 'Times played', 'Style', 'Cost', 'Announced by', 'Source', 'Notes'],
      [
        'EG12',
        '2026-03-07',
        'Saturday',
        '10:30am',
        'Played',
        'Among Us',
        'Duck Game; Golf It!',
        'first time',
        'Social deduction',
        'Free',
        'Robin',
        '#announcements',
        'Servers were down, so "Among Us" it was',
      ],
      ['EG13', '2026-03-14', 'Saturday', '', 'Played', 'Among Us', '', '2nd', 'Social deduction', '', '', '', ''],
      [
        '',
        '2026-03-21',
        'Saturday',
        '',
        'Played',
        'Duck Game; Among Us; Skribbl.io',
        '',
        'Duck Game: first time; Among Us: 3rd; Skribbl.io: first time',
        `2D platform fighter; Social deduction; ${UNCATEGORIZED}`,
        '',
        '',
        '',
        '',
      ],
      ['', '2026-03-28', 'Saturday', '', 'Played', '', '', '', '', '', '', '', ''],
      // A Special session isn't a play, so it has no "times played".
      ['', '2026-04-04', 'Saturday', '', 'Special', 'Among Us', '', '', 'Social deduction', '', '', '', ''],
      ['', '2026-04-11', 'Saturday', '', 'Cancelled', '', 'Duck Game', '', '', '', '', '', ''],
      ['', '2026-04-18', 'Saturday', '', 'No session', '', '', '', '', '', '', '', ''],
    ]);
  });

  it('writes the times played as ordinals', () => {
    const data = build(weekly('2024-01-06', 23).map((date) => played(date, ['Among Us'])));
    const timesPlayed = sessionsExport(data)
      .slice(1)
      .map((cells) => cells[7]);
    expect(timesPlayed.slice(0, 4)).toEqual(['first time', '2nd', '3rd', '4th']);
    expect(timesPlayed.slice(10, 13)).toEqual(['11th', '12th', '13th']);
    expect(timesPlayed.slice(20)).toEqual(['21st', '22nd', '23rd']);
  });

  it("marks cells a spreadsheet would run as a formula as text, with a leading '", () => {
    const data = build(
      [
        played('2026-03-07', ['=HYPERLINK("https://example.com/x","Click")', '@party'], {
          session: '=1+1',
          start: '+10:30',
          planned: ['-KLAUS-', 'Duck Game'],
          cost: '-',
          announcedBy: '@Robin',
          source: '\t=cmd|x',
          notes: ' =SUM(A1:A9)',
        }),
        played('2026-03-14', ['Duck Game'], { session: 'EG=2', notes: "'=already marked", cost: '$5 + keys', announcedBy: 'Robin @ home' }),
      ],
      [game('@party', '+Party')],
    );
    const [, first, second] = sessionsExport(data);
    expect(first).toEqual([
      "'=1+1",
      '2026-03-07',
      'Saturday',
      "'+10:30",
      'Played',
      `'=HYPERLINK("https://example.com/x","Click"); @party`,
      "'-KLAUS-; Duck Game",
      `'=HYPERLINK("https://example.com/x","Click"): first time; @party: first time`,
      `${UNCATEGORIZED}; +Party`,
      "'-",
      "'@Robin",
      "'\t=cmd|x",
      "' =SUM(A1:A9)",
    ]);
    // Only the start of a cell matters, and a marked cell isn't marked twice.
    expect(second).toEqual(['EG=2', '2026-03-14', 'Saturday', '', 'Played', 'Duck Game', '', 'first time', UNCATEGORIZED, '$5 + keys', 'Robin @ home', '', "'=already marked"]);
    // The page's own data is left as it was written.
    expect(data.sessions[0]).toMatchObject({ session: '=1+1', announcedBy: '@Robin', cost: '-' });
  });
});

describe('gamesExport', () => {
  it('has a header row and one row per game', () => {
    const data = build(
      [
        played('2026-05-02', ['Duck Game'], { session: 'EG7' }),
        played('2026-05-09', ['Duck Game', 'Skribbl.io']),
        played('2026-06-01', ['Duck Game'], { session: 'EG9' }),
      ],
      [
        game('Duck Game', '2D platform fighter', 'Competitive', {
          where: 'Steam',
          link: 'https://example.com/duck-game',
          tags: ['Local Multiplayer', 'Pixel Graphics'],
          developer: 'Landon Podbielski',
        }),
      ],
    );
    expect(gamesExport(data)).toEqual([
      [
        'Game',
        'Times played',
        'First played',
        'First session',
        'Last played',
        'Last session',
        'Days since last played',
        'Most in a row',
        'Style',
        'Mode',
        'Where',
        'Tags',
        'Developer',
        'Link',
      ],
      [
        'Duck Game',
        '3',
        '2026-05-02',
        'EG7',
        '2026-06-01',
        'EG9',
        '14',
        '3',
        '2D platform fighter',
        'Competitive',
        'Steam',
        'Local Multiplayer, Pixel Graphics',
        'Landon Podbielski',
        'https://example.com/duck-game',
      ],
      ['Skribbl.io', '1', '2026-05-09', '', '2026-05-09', '', '37', '1', UNCATEGORIZED, '', '', '', '', ''],
    ]);
  });

  it("marks cells a spreadsheet would run as a formula as text, with a leading '", () => {
    const data = build(
      [played('2026-05-02', ['=cmd|x', 'Duck Game'], { session: '+EG7' }), played('2026-05-09', ['=CMD|X'], { session: '-EG8' })],
      [game('=cmd|x', '@style', '-mode', { where: '+where', tags: ['=tag', '-other'], developer: '@dev', link: 'https://example.com/?q=-1' })],
    );
    expect(gamesExport(data).slice(1)).toEqual([
      ["'=cmd|x", '2', '2026-05-02', "'+EG7", '2026-05-09', "'-EG8", '37', '2', "'@style", "'-mode", "'+where", "'=tag, -other", "'@dev", 'https://example.com/?q=-1'],
      ['Duck Game', '1', '2026-05-02', "'+EG7", '2026-05-02', "'+EG7", '44', '1', UNCATEGORIZED, '', '', '', '', ''],
    ]);
    expect(data.games[0]).toMatchObject({ name: '=cmd|x', style: '@style', firstSession: '+EG7' });
  });
});

describe('an empty record', () => {
  const data = build([]);

  it('still has an all-time slice, with zeros', () => {
    expect(data).toEqual({
      title: 'Test Club',
      generatedAt: '2026-06-15T18:00:00.000Z',
      today: TODAY,
      sessions: [],
      games: [],
      slices: [
        {
          key: 'all',
          label: 'All time',
          from: '',
          to: '',
          played: 0,
          off: 0,
          special: 0,
          distinctGames: 0,
          newGames: 0,
          onePlayGames: 0,
          topGames: [],
          styles: [],
          modes: [],
          costs: [
            { kind: 'free', sessions: 0 },
            { kind: 'keys', sessions: 0 },
            { kind: 'paid', sessions: 0 },
            { kind: 'unknown', sessions: 0 },
          ],
        },
      ],
      years: [],
      styles: [],
      overdue: [],
      milestones: [],
      notes: [],
    });
  });

  it('exports just the header rows', () => {
    expect(sessionsExport(data)).toHaveLength(1);
    expect(gamesExport(data)).toHaveLength(1);
  });

  it('copes with a record of off weeks only', () => {
    const offOnly = build([noSession('2026-01-03'), cancelled('2026-01-10')], [game('Among Us', 'Social deduction')]);
    expect(offOnly.slices.map((s) => [s.key, s.played, s.off])).toEqual([
      ['all', 0, 2],
      ['recent', 0, 2],
      ['2026', 0, 2],
    ]);
    expect(offOnly).toMatchObject({ games: [], styles: [], milestones: [], overdue: [], notes: [] });
  });
});

describe('the rest of the page data', () => {
  it('passes through the title, dates, timezone and next session', () => {
    const next: NextSession = { date: '2026-06-20', start: '10:30am', status: 'announced', session: 'EG14', games: ['Duck Game'] };
    const data = build([played('2026-03-07', ['Among Us'])], [], { timezone: 'PT', next });
    expect(data).toMatchObject({ title: 'Test Club', generatedAt: '2026-06-15T18:00:00.000Z', today: TODAY, timezone: 'PT', next });
  });

  it('leaves the timezone and next session out when they are not known', () => {
    const data = build([played('2026-03-07', ['Among Us'])]);
    expect(data).not.toHaveProperty('timezone');
    expect(data).not.toHaveProperty('next');
  });
});

describe('a very long record', () => {
  it('is counted the same way', () => {
    // 60 made-up years of Saturdays, round and round 30 games, with one week in ten off.
    const dates = weekly('1966-01-01', 3000);
    const sessions = dates.map((date, week) => (week % 10 === 4 ? noSession(date) : played(date, [`Game ${week % 30}`], { session: `EG${week + 1}` })));
    const data = build(sessions.reverse(), [], { today: dates.at(-1) ?? '' });
    const all = slice(data, 'all');
    expect(all).toMatchObject({ from: '1966-01-01', to: dates.at(-1), played: 2700, off: 300, distinctGames: 27, newGames: 27, onePlayGames: 0 });
    expect(all.topGames).toHaveLength(15);
    expect(data.games.every((g) => g.plays === 100 && g.longestRun === 1)).toBe(true);
    expect(data.sessions).toHaveLength(3000);
    expect(data.sessions.at(-2)?.games).toEqual([{ name: 'Game 28', play: 100 }]);
    expect(data.years).toHaveLength(data.slices.length - 2);
    expect(data.milestones.map((m) => m.session)).toEqual(['EG1', ...Array.from({ length: 60 }, (_, i) => `EG${(i + 1) * 50}`)]);
    expect(sessionsExport(data)).toHaveLength(3001);
    expect(gamesExport(data)).toHaveLength(28);
  });

  it('copes with a very long name', () => {
    const long = `${'Very '.repeat(20_000)}Long Game`;
    const data = build([played('2026-01-03', [long]), played('2026-01-10', [`  ${long.toUpperCase()}  `])]);
    expect(data.games.map((g) => [g.name.length, g.plays])).toEqual([[long.length, 2]]);
  });
});
