// Turns the record (the rows of sessions.csv and games.csv) into everything the history page shows.
// Pure functions: "now" and "today" come in as arguments, and the input is never changed.
//
// Only 'Played' rows count as plays. 'Special' rows are listed (with their games, as play 0) but
// count towards nothing; 'Cancelled' and 'No session' rows are "off" weeks.
import {
  AUTO_SOURCE,
  COST_KINDS,
  UNCATEGORIZED,
  type CostKind,
  type DataNote,
  type GameInfo,
  type GameView,
  type HistoryData,
  type Milestone,
  type NextSession,
  type OverdueGame,
  type SessionRow,
  type SessionView,
  type Slice,
  type YearSummary,
} from './types.ts';

export interface HistoryInput {
  title: string;
  /** When this is computed (becomes `generatedAt`). */
  now: Date;
  /** "Today" as YYYY-MM-DD in the schedule's timezone. */
  today: string;
  timezone?: string;
  sessions: SessionRow[];
  games: GameInfo[];
  /** Problems found while reading the files; they come first in the page's notes. */
  notes?: DataNote[];
  next?: NextSession;
}

const TOP_GAMES = 15;
const MILESTONE_EVERY = 50;
const OVERDUE_MIN_PLAYS = 3;
const OVERDUE_AFTER_DAYS = 365;
/** How many games the "no style" note names before "and N more". */
const NOTE_NAMES = 15;
const UNKNOWN_MODE = 'Unknown';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 24 * 3600_000;

/** One game as the record knows it: its row in games.csv (if any) and every time it was played. */
interface Game {
  name: string;
  info?: GameInfo;
  style: string;
  mode?: string;
  /** The Played rows that include it, oldest first. */
  plays: { date: string; session?: string }[];
}

/** A row of the record with its games looked up. */
interface Entry {
  view: SessionView;
  /** The games that count as plays here: none unless the row is Played. */
  played: Game[];
}

/** One game in consecutive Played sessions. */
interface Run {
  game: Game;
  length: number;
  from: string;
  to: string;
  /** Position of its last session in the sequence it was found in. */
  end: number;
}

export function buildHistory(input: HistoryInput): HistoryData {
  const entries = readRows(input.sessions, input.games);
  const games = gameViews(entries, input.today);
  const slices = buildSlices(entries, input.today);
  const unstyled = games.filter((game) => game.style === UNCATEGORIZED).map((game) => game.name);

  return {
    title: input.title,
    generatedAt: input.now.toISOString(),
    today: input.today,
    ...(input.timezone && { timezone: input.timezone }),
    sessions: entries.map((entry) => entry.view),
    games,
    slices,
    years: [...byYear(entries)].map(([year, rows]) => summarizeYear(year, rows)),
    styles: (slices[0]?.styles ?? []).map((count) => count.style),
    overdue: overdueGames(games),
    milestones: findMilestones(entries),
    ...(input.next && { next: input.next }),
    notes: [...(input.notes ?? []), ...(unstyled.length > 0 ? [unstyledNote(unstyled)] : [])],
  };
}

/** 'free', 'keys' (the host gave out keys), 'paid' or 'unknown', from the free-text cost. */
export function costKind(cost: string | undefined): CostKind {
  const text = (cost ?? '').trim().toLowerCase();
  // "Free on mobile, $2.99 on Steam" is free; "$3 (host had spare keys)" still has a price.
  if (text.startsWith('free')) return 'free';
  if (text.startsWith('host')) return 'keys';
  if (/[$£€]/.test(text) || /^\d/.test(text)) return 'paid';
  return 'unknown';
}

/** The number in a session's name: "EG289" -> 289, "EG199.5" -> 199.5, "EG284 RETRY" -> 284. */
export function sessionNumber(label: string | undefined): number | undefined {
  const match = label?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const teens = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teens ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** The sessions as a table (header row first), for a CSV download. */
export function sessionsExport(data: HistoryData): string[][] {
  const header = [
    'Session',
    'Date',
    'Day',
    'Start',
    'Status',
    'Games',
    'Planned',
    'Times played',
    'Style',
    'Cost',
    'Announced by',
    'Source',
    'Notes',
  ];
  const rows = data.sessions.map((session) => [
    session.session ?? '',
    session.date,
    session.day,
    session.start ?? '',
    session.status,
    session.games.map((game) => game.name).join('; '),
    session.planned.join('; '),
    timesPlayed(session.games),
    session.styles.join('; '),
    session.cost ?? '',
    session.announcedBy ?? '',
    session.source ?? '',
    session.notes ?? '',
  ]);
  return [header, ...rows.map((row) => row.map(asText))];
}

/** The games as a table (header row first), for a CSV download. */
export function gamesExport(data: HistoryData): string[][] {
  const header = [
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
  ];
  const rows = data.games.map((game) => [
    game.name,
    String(game.plays),
    game.dates[0] ?? '',
    game.firstSession ?? '',
    game.dates.at(-1) ?? '',
    game.lastSession ?? '',
    String(game.daysSince),
    String(game.longestRun),
    game.style,
    game.mode ?? '',
    game.where ?? '',
    game.tags.join(', '),
    game.developer ?? '',
    game.link ?? '',
  ]);
  return [header, ...rows.map((row) => row.map(asText))];
}

/**
 * A cell for a download. Spreadsheet apps run a cell that starts with = + - or @ as a formula, and
 * these cells hold text people typed (game names and announcers' names come from Discord), so such
 * a cell gets a leading ' which makes it plain text. The page's own data (HistoryData) is unchanged.
 */
function asText(cell: string): string {
  return /^\s*[=+\-@]/.test(cell) ? `'${cell}` : cell;
}

// ---------------------------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------------------------

/** Sorts the rows oldest first and works out each one's games and running play counts. */
function readRows(sessions: SessionRow[], infos: GameInfo[]): Entry[] {
  const listed = new Map<string, GameInfo>();
  for (const info of infos) {
    const id = gameId(info.name);
    // If games.csv lists a game twice, its first row counts.
    if (id && !listed.has(id)) listed.set(id, info);
  }

  const games = new Map<string, Game>();
  const gameNamed = (name: string): Game | undefined => {
    const id = gameId(name);
    if (!id) return undefined;
    let game = games.get(id);
    if (!game) {
      const info = listed.get(id);
      const mode = info?.mode?.trim();
      game = {
        // The spelling in games.csv, or else the first one seen in the sessions.
        name: tidy(info?.name ?? name),
        ...(info && { info }),
        style: info?.style?.trim() || UNCATEGORIZED,
        ...(mode && { mode }),
        plays: [],
      };
      games.set(id, game);
    }
    return game;
  };

  // Array.sort is stable, so rows with the same date keep their order in the file.
  const sorted = [...sessions].sort((a, b) => compare(a.date, b.date));
  return sorted.map((row) => {
    const counts = row.status === 'Played';
    // A game named twice in one row is still one play.
    const rowGames = [...new Set(row.games.flatMap((name) => gameNamed(name) ?? []))];
    if (counts) {
      for (const game of rowGames) game.plays.push({ date: row.date, ...(row.session && { session: row.session }) });
    }
    const view: SessionView = {
      ...(row.session && { session: row.session }),
      date: row.date,
      day: weekday(row.date),
      ...(row.start && { start: row.start }),
      status: row.status,
      // Rows that aren't plays (a Special session) still show their games, with play 0.
      games: rowGames.map((game) => ({ name: game.name, play: counts ? game.plays.length : 0 })),
      planned: [...row.planned],
      ...(row.cost && { cost: row.cost }),
      ...(counts && rowGames.length > 0 && { costKind: costKind(row.cost) }),
      ...(row.announcedBy && { announcedBy: row.announcedBy }),
      ...(row.source && { source: row.source }),
      ...(row.notes && { notes: row.notes }),
      styles: [...new Set(rowGames.map((game) => game.style))],
      auto: row.source === AUTO_SOURCE,
    };
    return { view, played: counts ? rowGames : [] };
  });
}

/** Names are compared trimmed, ignoring case and extra spaces: " among  us" is "Among Us". */
function gameId(name: string): string {
  // NFC: "é" can be typed as one character or as "e" plus an accent, and both look the same.
  return tidy(name).normalize('NFC').toLowerCase();
}

function tidy(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

const isPlayed = (entry: Entry): boolean => entry.view.status === 'Played';
const isOff = (entry: Entry): boolean => entry.view.status === 'Cancelled' || entry.view.status === 'No session';

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

/** Every game that was played, most played first. */
function gameViews(entries: Entry[], today: string): GameView[] {
  const longest = new Map<Game, number>();
  for (const run of findRuns(entries.filter(isPlayed))) {
    longest.set(run.game, Math.max(longest.get(run.game) ?? 0, run.length));
  }
  const played = new Set(entries.flatMap((entry) => entry.played));
  return [...played]
    .map((game) => gameView(game, longest.get(game) ?? 1, today))
    .sort((a, b) => b.plays - a.plays || compare(b.dates.at(-1) ?? '', a.dates.at(-1) ?? '') || byName(a.name, b.name));
}

function gameView(game: Game, longestRun: number, today: string): GameView {
  const first = game.plays[0];
  const last = game.plays.at(-1);
  const { where, developer } = game.info ?? {};
  const link = webLink(game.info?.link);
  return {
    name: game.name,
    plays: game.plays.length,
    dates: game.plays.map((play) => play.date),
    ...(first?.session && { firstSession: first.session }),
    ...(last?.session && { lastSession: last.session }),
    daysSince: daysBetween(last?.date ?? today, today),
    longestRun,
    style: game.style,
    ...(game.mode && { mode: game.mode }),
    ...(where && { where }),
    ...(link && { link }),
    tags: [...(game.info?.tags ?? [])],
    ...(developer && { developer }),
  };
}

/**
 * The link if it is an http(s) address, which is all the page may link to (a "javascript:" link
 * would run when it's clicked). record.ts already leaves the others out; this is for any other caller.
 */
function webLink(link: string | undefined): string | undefined {
  if (link === undefined || !URL.canParse(link)) return undefined;
  const { protocol } = new URL(link);
  return protocol === 'http:' || protocol === 'https:' ? link.trim() : undefined;
}

function overdueGames(games: GameView[]): OverdueGame[] {
  return games
    .filter((game) => game.plays >= OVERDUE_MIN_PLAYS && game.daysSince > OVERDUE_AFTER_DAYS)
    .map((game) => ({ name: game.name, plays: game.plays, last: game.dates.at(-1) ?? '', daysSince: game.daysSince }))
    .sort((a, b) => b.plays - a.plays || b.daysSince - a.daysSince || byName(a.name, b.name));
}

function unstyledNote(names: string[]): DataNote {
  const more = names.length - NOTE_NAMES;
  const list = names.slice(0, NOTE_NAMES).join(', ') + (more > 0 ? ` and ${more} more` : '');
  return { kind: 'info', text: `No style set for: ${list}. Add ${names.length === 1 ? 'it' : 'them'} to games.csv.` };
}

// ---------------------------------------------------------------------------------------------
// Runs ("most in a row")
// ---------------------------------------------------------------------------------------------

/**
 * Every run in a sequence of Played sessions: a game and the consecutive sessions that include it.
 * Off weeks and Special rows aren't in the sequence, so they don't break a run; a session with
 * other games, or with none recorded, does.
 */
function findRuns(played: Entry[]): Run[] {
  const runs: Run[] = [];
  let open = new Map<Game, Run>();
  for (const [index, entry] of played.entries()) {
    const stillOpen = new Map<Game, Run>();
    for (const game of entry.played) {
      let run = open.get(game);
      if (!run) {
        run = { game, length: 0, from: entry.view.date, to: entry.view.date, end: index };
        runs.push(run);
      }
      run.length += 1;
      run.to = entry.view.date;
      run.end = index;
      stillOpen.set(game, run);
    }
    open = stillOpen;
  }
  return runs;
}

/** The longest run of two or more sessions; on a tie, the most recent one. */
function bestRun(runs: Run[]): Slice['longestRun'] {
  const [best] = runs
    .filter((run) => run.length >= 2)
    .sort((a, b) => b.length - a.length || b.end - a.end || byName(a.game.name, b.game.name));
  return best && { name: best.game.name, length: best.length, from: best.from, to: best.to };
}

// ---------------------------------------------------------------------------------------------
// Slices and years
// ---------------------------------------------------------------------------------------------

/** "all", then "recent" (the last 12 months), then each year, newest first. Empty ranges are left out. */
function buildSlices(entries: Entry[], today: string): Slice[] {
  const slices = [buildSlice('all', 'All time', entries)];

  const yearAgo = oneYearBefore(today);
  const recent = yearAgo === undefined ? [] : entries.filter(({ view }) => view.date > yearAgo && view.date <= today);
  if (recent.length > 0) slices.push(buildSlice('recent', 'Last 12 months', recent));

  for (const [year, rows] of [...byYear(entries)].reverse()) slices.push(buildSlice(year, year, rows));
  return slices;
}

/**
 * Totals for the rows of one time range. The rows must be consecutive rows of the record, so that
 * sessions next to each other here are next to each other in the record (runs depend on it).
 */
function buildSlice(key: string, label: string, entries: Entry[]): Slice {
  const played = entries.filter(isPlayed);

  const tally = new Map<Game, { plays: number; last: string }>();
  for (const entry of played) {
    for (const game of entry.played) {
      tally.set(game, { plays: (tally.get(game)?.plays ?? 0) + 1, last: entry.view.date });
    }
  }
  const ranked = [...tally]
    .map(([game, count]) => ({ name: game.name, ...count }))
    .sort((a, b) => b.plays - a.plays || compare(b.last, a.last) || byName(a.name, b.name));

  const longestRun = bestRun(findRuns(played));
  return {
    key,
    label,
    from: entries[0]?.view.date ?? '',
    to: entries.at(-1)?.view.date ?? '',
    played: played.length,
    off: entries.filter(isOff).length,
    special: entries.filter((entry) => entry.view.status === 'Special').length,
    distinctGames: ranked.length,
    newGames: played.flatMap((entry) => entry.view.games).filter((game) => game.play === 1).length,
    newGameSessions: played.filter(hasNewGame).length,
    onePlayGames: ranked.filter((game) => game.plays === 1).length,
    topGames: ranked.slice(0, TOP_GAMES).map(({ name, plays }) => ({ name, plays })),
    styles: sessionsPer(played, (game) => game.style).map(({ label: style, sessions, games }) => ({
      style,
      sessions,
      games: games.size,
    })),
    modes: sessionsPer(played, (game) => game.mode ?? UNKNOWN_MODE).map(({ label: mode, sessions }) => ({ mode, sessions })),
    costs: COST_KINDS.map((kind) => ({ kind, sessions: played.filter((entry) => entry.view.costKind === kind).length })),
    ...(longestRun && { longestRun }),
  };
}

/**
 * Sessions per label (a style or a mode), most sessions first. Each distinct label among a
 * session's games adds one session to it, so a session with two shooters is one Shooter session
 * and a session with a shooter and a party game counts for both.
 */
function sessionsPer(
  played: Entry[],
  labelOf: (game: Game) => string,
): { label: string; sessions: number; games: Set<Game> }[] {
  const counts = new Map<string, { label: string; sessions: number; games: Set<Game> }>();
  for (const entry of played) {
    const inSession = new Set<string>();
    for (const game of entry.played) {
      const label = labelOf(game);
      const count = counts.get(label) ?? { label, sessions: 0, games: new Set<Game>() };
      counts.set(label, count);
      if (!inSession.has(label)) count.sessions += 1;
      inSession.add(label);
      count.games.add(game);
    }
  }
  return [...counts.values()].sort((a, b) => b.sessions - a.sessions || byName(a.label, b.label));
}

/** The rows of each calendar year, oldest year first (the rows are already in date order). */
function byYear(entries: Entry[]): Map<string, Entry[]> {
  const years = new Map<string, Entry[]>();
  for (const entry of entries) {
    const year = entry.view.date.slice(0, 4);
    const rows = years.get(year) ?? [];
    years.set(year, rows);
    rows.push(entry);
  }
  return years;
}

/** Whether a row's games include one played for the first time in the record. */
function hasNewGame(entry: Entry): boolean {
  return entry.view.games.some((game) => game.play === 1);
}

function summarizeYear(year: string, entries: Entry[]): YearSummary {
  const played = entries.filter(isPlayed);
  const unknownSessions = played.filter((entry) => entry.played.length === 0).length;
  const newGameSessions = played.filter(hasNewGame).length;
  return {
    year,
    newGameSessions,
    returningSessions: played.length - newGameSessions - unknownSessions,
    unknownSessions,
    off: entries.filter(isOff).length,
    styles: Object.fromEntries(sessionsPer(played, (game) => game.style).map(({ label, sessions }) => [label, sessions])),
  };
}

// ---------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------

/** The first Played session, then each one whose number is a multiple of 50 (EG50, EG100, …). */
function findMilestones(entries: Entry[]): Milestone[] {
  const played = entries.filter(isPlayed);
  const first = played[0];
  if (!first) return [];

  const milestone = (entry: Entry, session: string): Milestone => ({
    session,
    date: entry.view.date,
    games: entry.view.games.map((game) => game.name),
  });
  // A name of only spaces is no name.
  const milestones = [milestone(first, first.view.session?.trim() ? first.view.session : 'First session')];
  const seen = new Set<number>();
  for (const entry of played) {
    const number = sessionNumber(entry.view.session);
    // "EG199.5" has a number, but not a whole one. A number that was used twice counts once.
    if (number === undefined || number <= 0 || number % MILESTONE_EVERY !== 0 || seen.has(number)) continue;
    seen.add(number);
    if (entry !== first) milestones.push(milestone(entry, entry.view.session ?? ''));
  }
  return milestones;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Times played, for the download: "first time", "3rd", or "Name: 2nd; Other: first time". */
function timesPlayed(games: SessionView['games']): string {
  // Play 0 marks the games of a row that isn't a play.
  const counted = games.filter((game) => game.play > 0);
  const nth = (play: number): string => (play === 1 ? 'first time' : ordinal(play));
  const [only] = counted;
  if (only && counted.length === 1) return nth(only.play);
  return counted.map((game) => `${game.name}: ${nth(game.play)}`).join('; ');
}

/** Plain text order. Dates as YYYY-MM-DD sort correctly this way. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const collator = new Intl.Collator('en');

/** A-Z, ignoring case unless that's the only difference. */
function byName(a: string, b: string): number {
  return collator.compare(a, b) || compare(a, b);
}

/** Days since 1970-01-01 for a YYYY-MM-DD date; undefined if it isn't one. */
function dayNumber(date: string): number | undefined {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : undefined;
}

/** "Saturday" for a YYYY-MM-DD date; "" if it isn't one. */
function weekday(date: string): string {
  const day = dayNumber(date);
  return day === undefined ? '' : (WEEKDAYS[new Date(day * DAY_MS).getUTCDay()] ?? '');
}

/** Whole calendar days from one date to a later one; 0 if it isn't later (or either isn't a date). */
function daysBetween(from: string, to: string): number {
  const [start, end] = [dayNumber(from), dayNumber(to)];
  return start === undefined || end === undefined ? 0 : Math.max(0, end - start);
}

/**
 * The same calendar day a year earlier. For Feb 29 that day doesn't exist, but as text it still
 * sorts between Feb 28 and Mar 1, which is all it's used for.
 */
function oneYearBefore(date: string): string | undefined {
  if (dayNumber(date) === undefined) return undefined;
  return String(Number(date.slice(0, 4)) - 1).padStart(4, '0') + date.slice(4);
}
