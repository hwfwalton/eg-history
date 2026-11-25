import { describe, expect, it } from 'vitest';
import type { GameView, HistoryData, SessionView, Slice } from '../types.ts';
import {
  defaultDir,
  filterSessions,
  freeShare,
  gamesByName,
  inRange,
  inSlice,
  matchesGame,
  matchesGameName,
  matchesSession,
  modeOrder,
  modeSlot,
  nextSessionText,
  pickSlice,
  safeHref,
  sessionIndex,
  sessionsIn,
  sortGames,
  subtitle,
  weekGrid,
  weekKey,
  yearsIn,
} from './data.ts';

function slice(key: string, label: string, from: string, to: string, extra: Partial<Slice> = {}): Slice {
  return {
    key,
    label,
    from,
    to,
    played: 0,
    off: 0,
    special: 0,
    distinctGames: 0,
    newGames: 0,
    newGameSessions: 0,
    onePlayGames: 0,
    rankedGames: [],
    styles: [],
    modes: [],
    costs: [],
    ...extra,
  };
}

function session(date: string, extra: Partial<SessionView> = {}): SessionView {
  return { date, day: 'Saturday', status: 'Played', games: [], planned: [], styles: [], auto: false, ...extra };
}

function game(name: string, extra: Partial<GameView> = {}): GameView {
  return { name, plays: 1, dates: ['2024-01-06'], daysSince: 10, longestRun: 1, style: 'Shooter', tags: [], ...extra };
}

const ALL = slice('all', 'All time', '2023-12-30', '2025-02-01');
const RECENT = slice('recent', 'Last 12 months', '2024-02-02', '2025-02-01');
const Y2024 = slice('2024', '2024', '2024-01-06', '2024-12-28');
const SLICES = [ALL, RECENT, Y2024];

const SESSIONS: SessionView[] = [
  session('2023-12-30', { session: 'MG1', games: [{ name: 'Tiny Tanks', play: 1 }], styles: ['Shooter'] }),
  session('2024-01-06', { session: 'MG2', games: [{ name: 'Mole Patrol', play: 1 }], styles: ['Co-op puzzle'], notes: 'Chosen by poll' }),
  session('2024-01-13', { status: 'No session', notes: 'Snowed in' }),
  session('2024-01-20', {
    session: 'MG3',
    games: [
      { name: 'Tiny Tanks', play: 2 },
      { name: 'Mole Patrol', play: 2 },
    ],
    styles: ['Shooter', 'Co-op puzzle'],
  }),
  session('2024-01-27', { status: 'Cancelled', planned: ['Tiny Tanks'] }),
  session('2025-02-01', { status: 'Special', games: [{ name: 'Board game night', play: 0 }], styles: ['In person'] }),
];

describe('pickSlice', () => {
  it('finds a slice by its key', () => {
    expect(pickSlice(SLICES, '2024')).toBe(Y2024);
    expect(pickSlice(SLICES, 'recent')).toBe(RECENT);
  });

  it('falls back to the whole record for an unknown or missing key', () => {
    expect(pickSlice(SLICES, '1999')).toBe(ALL);
    expect(pickSlice(SLICES, null)).toBe(ALL);
    expect(pickSlice([], 'all')).toBeUndefined();
  });
});

describe('ranges', () => {
  it('keeps the rows inside a slice', () => {
    expect(sessionsIn(SESSIONS, ALL)).toHaveLength(6);
    expect(sessionsIn(SESSIONS, Y2024).map((row) => row.date)).toEqual(['2024-01-06', '2024-01-13', '2024-01-20', '2024-01-27']);
    expect(inSlice('2023-12-30', Y2024)).toBe(false);
    expect(inSlice('2024-12-28', Y2024)).toBe(true);
    expect(inSlice('1999-01-01', ALL)).toBe(true);
  });

  it('lists the years a slice touches', () => {
    expect([...yearsIn(Y2024)]).toEqual(['2024']);
    expect([...yearsIn(RECENT)]).toEqual(['2024', '2025']);
    expect([...yearsIn(slice('x', 'x', 'bad', 'worse'))]).toEqual([]);
  });

  it('says where the numbers come from', () => {
    expect(inRange(ALL)).toBe('in the whole record');
    expect(inRange(RECENT)).toBe('in the last 12 months');
    expect(inRange(Y2024)).toBe('in 2024');
  });
});

describe('filtering sessions', () => {
  it('returns the newest first', () => {
    expect(filterSessions(SESSIONS, { query: '', kind: 'all' }).map((row) => row.date)[0]).toBe('2025-02-01');
  });

  it('splits played weeks from weeks off', () => {
    expect(filterSessions(SESSIONS, { query: '', kind: 'played' }).map((row) => row.session)).toEqual(['MG3', 'MG2', 'MG1']);
    expect(filterSessions(SESSIONS, { query: '', kind: 'off' }).map((row) => row.status)).toEqual(['Cancelled', 'No session']);
  });

  it('searches games, session names, styles and notes, whatever the case', () => {
    const find = (query: string): string[] => filterSessions(SESSIONS, { query, kind: 'all' }).map((row) => row.date);
    expect(find('mole')).toEqual(['2024-01-20', '2024-01-06']);
    expect(find('MG2')).toEqual(['2024-01-06']);
    expect(find('co-op')).toEqual(['2024-01-20', '2024-01-06']);
    expect(find('SNOWED')).toEqual(['2024-01-13']);
    expect(find('tiny  patrol')).toEqual(['2024-01-20']);
    expect(find('nothing like this')).toEqual([]);
  });

  it('finds a cancelled week by the game that was planned', () => {
    expect(matchesSession(SESSIONS[4] as SessionView, { query: 'tanks', kind: 'all' })).toBe(true);
  });

  it('narrows to exactly one game or one style', () => {
    expect(filterSessions(SESSIONS, { query: '', kind: 'all', game: 'Tiny Tanks' }).map((row) => row.session)).toEqual(['MG3', 'MG1']);
    expect(filterSessions(SESSIONS, { query: '', kind: 'all', game: 'Tiny' })).toEqual([]);
    expect(filterSessions(SESSIONS, { query: '', kind: 'all', style: 'Co-op puzzle' }).map((row) => row.session)).toEqual(['MG3', 'MG2']);
  });
});

describe('the games table', () => {
  const games = [
    game('Tiny Tanks', { plays: 9, dates: ['2023-12-30', '2024-06-01'], daysSince: 200, longestRun: 3, mode: 'Competitive', tags: ['Tanks', 'Arcade'] }),
    game('mole patrol', { plays: 4, dates: ['2024-01-06', '2025-01-04'], daysSince: 20, longestRun: 2, style: 'Co-op puzzle', mode: 'Co-op' }),
    game('Áccent Racer 2', { plays: 4, dates: ['2022-03-05'], daysSince: 900, style: 'Racing', developer: 'Small Studio' }),
    game('Accent Racer 10', { plays: 1, dates: ['2024-09-07'], daysSince: 100, style: 'Racing', mode: 'Competitive' }),
  ];
  const names = (key: Parameters<typeof sortGames>[1], dir: Parameters<typeof sortGames>[2]): string[] => sortGames(games, key, dir).map((entry) => entry.name);

  it('sorts numbers, keeping ties in the order they came', () => {
    expect(names('plays', 'desc')).toEqual(['Tiny Tanks', 'mole patrol', 'Áccent Racer 2', 'Accent Racer 10']);
    expect(names('plays', 'asc')).toEqual(['Accent Racer 10', 'mole patrol', 'Áccent Racer 2', 'Tiny Tanks']);
    expect(names('since', 'desc')[0]).toBe('Áccent Racer 2');
    expect(names('run', 'desc')[0]).toBe('Tiny Tanks');
  });

  it('sorts names without minding case or accents, and numbers inside them by value', () => {
    expect(names('name', 'asc')).toEqual(['Áccent Racer 2', 'Accent Racer 10', 'mole patrol', 'Tiny Tanks']);
  });

  it('sorts by first and last date', () => {
    expect(names('first', 'asc')[0]).toBe('Áccent Racer 2');
    expect(names('last', 'desc')[0]).toBe('mole patrol');
  });

  it('keeps games without a mode at the end, both ways', () => {
    expect(names('mode', 'asc').at(-1)).toBe('Áccent Racer 2');
    expect(names('mode', 'desc').at(-1)).toBe('Áccent Racer 2');
  });

  it('does not change the list it was given', () => {
    sortGames(games, 'name', 'asc');
    expect(games[0]?.name).toBe('Tiny Tanks');
  });

  it('starts text columns from A and number columns from the most', () => {
    expect(defaultDir('name')).toBe('asc');
    expect(defaultDir('style')).toBe('asc');
    expect(defaultDir('plays')).toBe('desc');
    expect(defaultDir('last')).toBe('desc');
  });

  it('searches name, style, mode, tags and developer', () => {
    const find = (query: string): string[] => games.filter((entry) => matchesGame(entry, query)).map((entry) => entry.name);
    expect(find('racer')).toEqual(['Áccent Racer 2', 'Accent Racer 10']);
    expect(find('arcade')).toEqual(['Tiny Tanks']);
    expect(find('co-op')).toEqual(['mole patrol']);
    expect(find('small studio')).toEqual(['Áccent Racer 2']);
    expect(find('')).toHaveLength(4);
  });

  it('searches a name the record knows like the Games table, and any other by name alone', () => {
    const mole = games.find((entry) => entry.name === 'mole patrol');
    expect(matchesGameName('mole patrol', mole, 'co-op')).toBe(true);
    expect(matchesGameName('mole patrol', mole, 'MOLE pat')).toBe(true);
    expect(matchesGameName('mole patrol', mole, 'arcade')).toBe(false);
    expect(matchesGameName('Unknown Thing', undefined, 'thing unknown')).toBe(true);
    expect(matchesGameName('Unknown Thing', undefined, 'co-op')).toBe(false);
    expect(matchesGameName('Unknown Thing', undefined, '  ')).toBe(true);
  });

  it('looks a game up by name', () => {
    expect(gamesByName(games).get('mole patrol')?.plays).toBe(4);
    expect(gamesByName(games).get('Mole Patrol')).toBeUndefined();
  });
});

describe('freeShare', () => {
  it('counts free and keys as free, and leaves out sessions with no cost recorded', () => {
    expect(
      freeShare([
        { kind: 'free', sessions: 138 },
        { kind: 'keys', sessions: 24 },
        { kind: 'paid', sessions: 63 },
        { kind: 'unknown', sessions: 43 },
      ]),
    ).toEqual({ free: 162, known: 225 });
  });

  it('has nothing to divide by when no cost is known', () => {
    expect(freeShare([{ kind: 'unknown', sessions: 14 }])).toEqual({ free: 0, known: 0 });
    expect(freeShare([])).toEqual({ free: 0, known: 0 });
  });
});

describe('modes', () => {
  const slices = [
    slice('all', 'All time', '2024-01-01', '2024-12-31', {
      modes: [
        { mode: 'Co-op', sessions: 9 },
        { mode: 'Unknown', sessions: 4 },
        { mode: 'Competitive', sessions: 3 },
        { mode: 'Hot seat', sessions: 1 },
      ],
    }),
    slice('2024', '2024', '2024-01-01', '2024-12-31', { modes: [{ mode: 'Party', sessions: 2 }] }),
  ];

  it('keeps one order for every range: the known modes, then others, then unknown', () => {
    expect(modeOrder(slices)).toEqual(['Competitive', 'Co-op', 'Party', 'Hot seat', 'Unknown']);
  });

  it('gives each mode its own colour slot, whatever the range holds', () => {
    const order = modeOrder(slices);
    expect(modeSlot('Competitive', order)).toBe(1);
    expect(modeSlot('Co-op', order)).toBe(2);
    expect(modeSlot('Mixed', order)).toBe(3);
    expect(modeSlot('Party', order)).toBe(4);
    expect(modeSlot('Hot seat', order)).toBe(5);
    expect(modeSlot('Unknown', order)).toBe(0);
    expect(modeSlot('Never seen', order)).toBe(0);
  });
});

describe('the week grid', () => {
  it('makes one cell per week that has a row', () => {
    const grid = weekGrid(SESSIONS);
    expect(grid.years).toEqual([2023, 2024, 2025]);
    expect(grid.cells.get(weekKey(2023, 51))?.state).toBe('played');
    expect(grid.cells.get(weekKey(2024, 1))?.state).toBe('off');
    expect(grid.cells.get(weekKey(2025, 4))?.state).toBe('special');
    expect(grid.cells.get(weekKey(2024, 30))).toBeUndefined();
  });

  it('counts a week as played when any of its rows is', () => {
    const grid = weekGrid([session('2024-03-04', { status: 'Cancelled' }), session('2024-03-06', { session: 'MG9' })]);
    const cell = grid.cells.get(weekKey(2024, 9));
    expect(cell?.state).toBe('played');
    expect(cell?.rows).toHaveLength(2);
  });

  it('skips rows whose date cannot be read and copes with nothing', () => {
    expect(weekGrid([session('13/45/2020')]).years).toEqual([]);
    expect(weekGrid([]).cells.size).toBe(0);
  });
});

describe('sessionIndex', () => {
  it('finds the session a game was played in on a date', () => {
    const find = sessionIndex(SESSIONS);
    expect(find('2024-01-20', 'Mole Patrol')?.session).toBe('MG3');
    expect(find('2024-01-20', 'Unknown game')).toBeUndefined();
    expect(find('2030-01-01', 'Mole Patrol')).toBeUndefined();
  });
});

describe('safeHref', () => {
  it('only lets web addresses through', () => {
    expect(safeHref('https://store.example/app/1')).toBe('https://store.example/app/1');
    expect(safeHref('http://example.org')).toBe('http://example.org');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref(' https://example.org')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('//example.org')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('the header', () => {
  const data: HistoryData = {
    title: 'Made-up Games',
    generatedAt: '2025-02-02T10:00:00.000Z',
    today: '2025-02-02',
    sessions: SESSIONS,
    games: [game('Tiny Tanks'), game('Mole Patrol')],
    slices: [slice('all', 'All time', '2023-12-30', '2025-02-01', { played: 3 })],
    years: [],
    styles: [],
    overdue: [],
    milestones: [],
    notes: [],
  };

  it('sums the record up', () => {
    expect(subtitle(data)).toBe('3 sessions of 2 games since December 2023');
    expect(subtitle({ ...data, sessions: [] })).toBe('');
  });

  it('announces the next session', () => {
    expect(nextSessionText({ date: '2026-11-28', start: '10:30am', status: 'announced', session: 'EG290', games: ['Spellsworn'] }, 'PT')).toBe(
      'Next: EG290 · Sat, Nov 28 at 10:30am PT · Spellsworn',
    );
    expect(nextSessionText({ date: '2026-11-28', start: '10:30am', status: 'announced', games: ['A', 'B'] }, undefined)).toBe('Next: Sat, Nov 28 at 10:30am · A, B');
  });

  it('says when there is no session, or no game yet', () => {
    expect(nextSessionText({ date: '2026-11-28', start: '10:30am', status: 'cancelled', games: [] }, 'PT')).toBe('No session on Sat, Nov 28');
    expect(nextSessionText({ date: '2026-11-28', start: '10:30am', status: 'unannounced', games: [] }, 'PT')).toBe(
      'Next session: Sat, Nov 28 at 10:30am PT · game not announced yet',
    );
  });
});
