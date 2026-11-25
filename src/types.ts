// Shared types for the session history page: the record on disk (two CSV files) and the JSON the
// page renders. Everything the page shows is computed on the server (stats.ts), so the page's own
// script only draws.

/** What happened in one scheduled week. */
export type SessionStatus = 'Played' | 'Cancelled' | 'No session' | 'Special';

export const SESSION_STATUSES: readonly SessionStatus[] = ['Played', 'Cancelled', 'No session', 'Special'];

/**
 * One row of sessions.csv: one scheduled week (or an extra session).
 *
 * Columns: Session, Date, Start, Status, Games, Planned, Cost, Announced by, Source, Notes.
 */
export interface SessionRow {
  /** The session's name as announced, e.g. "EG289". Missing for off weeks and unnumbered sessions. */
  session?: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Start time as free text, e.g. "10:30am". */
  start?: string;
  status: SessionStatus;
  /** Games actually played (";"-separated in the file). Empty when unknown or nothing was played. */
  games: string[];
  /** What was announced, when something else (or nothing) ended up being played. */
  planned: string[];
  /** What the game cost at the time, as free text: "Free", "Free (demo)", "$2.99", "Host gave out keys". */
  cost?: string;
  announcedBy?: string;
  /** Where the row came from, e.g. "#announcements" or "Announcement (auto)". */
  source?: string;
  notes?: string;
}

/** `source` of rows the bot added itself from an announcement (nobody has checked them). */
export const AUTO_SOURCE = 'Announcement (auto)';

/**
 * One row of games.csv: what kind of game it is. Optional: a game with no row is "Uncategorized".
 *
 * Columns: Game, Style, Mode, Where, Link, Tags, Developer.
 */
export interface GameInfo {
  name: string;
  /** The owner's own genre label, e.g. "Social deduction". */
  style?: string;
  /** "Competitive", "Co-op", "Mixed" or "Party". */
  mode?: string;
  /** "Steam", "Browser", "Discord", … */
  where?: string;
  /** Store or home page. Only http(s) links are kept. */
  link?: string;
  /** Store tags, most relevant first (","-separated in the file). */
  tags: string[];
  developer?: string;
}

export const UNCATEGORIZED = 'Uncategorized';

/** A problem found while reading a file, shown at the bottom of the page. */
export interface DataNote {
  kind: 'warning' | 'info';
  text: string;
}

export type CostKind = 'free' | 'keys' | 'paid' | 'unknown';

/** Display order of the cost kinds. */
export const COST_KINDS: readonly CostKind[] = ['free', 'keys', 'paid', 'unknown'];

// ---------------------------------------------------------------------------------------------
// What the page gets: GET /api/history.json
// ---------------------------------------------------------------------------------------------

export interface HistoryData {
  /** Page heading, e.g. the community's name. */
  title: string;
  /** When this was computed (ISO 8601). */
  generatedAt: string;
  /** "Today" in the schedule's timezone (YYYY-MM-DD); `daysSince` counts from it. */
  today: string;
  /** Short name of the timezone start times are in, e.g. "PT". Missing if unknown. */
  timezone?: string;
  /** Every row of the record, oldest first. */
  sessions: SessionView[];
  /** Every game that was played at least once, most played first (ties: most recently played first). */
  games: GameView[];
  /** Totals for each time range the page can filter to: "all", then "recent" (last 12 months), then each year, newest first. */
  slices: Slice[];
  /** One entry per calendar year in the record, oldest first. */
  years: YearSummary[];
  /** Every style, most sessions first (the row order of the style-by-year grid). */
  styles: string[];
  /** Games played 3+ times whose last session was more than a year before `today`, most played first. */
  overdue: OverdueGame[];
  /** The first session and each numbered session divisible by 50 (EG50, EG100, …), oldest first. */
  milestones: Milestone[];
  /** The upcoming session, from next.json (which the bot keeps up to date). Missing when it isn't known. */
  next?: NextSession;
  /** Problems reading the files, rows dated after today, and games with no style. */
  notes: DataNote[];
}

export interface SessionView {
  session?: string;
  date: string;
  /** "Saturday" */
  day: string;
  start?: string;
  status: SessionStatus;
  /**
   * The row's games, each with how many times it had been played up to and including this session.
   * `play` is 0 on rows that aren't Played (a Special session's games count towards nothing).
   */
  games: { name: string; play: number }[];
  planned: string[];
  cost?: string;
  /** Only for Played rows that name a game. */
  costKind?: CostKind;
  announcedBy?: string;
  source?: string;
  notes?: string;
  /** Distinct styles of the games played, in game order. */
  styles: string[];
  /** True for rows the bot added from an announcement (see AUTO_SOURCE). */
  auto: boolean;
}

export interface GameView {
  name: string;
  /** Number of Played sessions that include the game. */
  plays: number;
  /** Date of each of those sessions, oldest first. */
  dates: string[];
  /** Name of the first and last of those sessions, when they have one. */
  firstSession?: string;
  lastSession?: string;
  /** Whole days from the last play to `today`. */
  daysSince: number;
  /** Most sessions in a row (counting Played sessions only; off weeks don't break a run). */
  longestRun: number;
  style: string;
  mode?: string;
  where?: string;
  /** Only ever an http(s) address. */
  link?: string;
  tags: string[];
  developer?: string;
}

export interface Slice {
  /** "all", "recent" or a year like "2024". */
  key: string;
  /** "All time", "Last 12 months" or "2024". */
  label: string;
  /** First and last date the range covers (YYYY-MM-DD), clipped to the record. */
  from: string;
  to: string;
  /** Played sessions. */
  played: number;
  /** Cancelled and "No session" weeks. */
  off: number;
  special: number;
  /** Different games played in the range. */
  distinctGames: number;
  /** Of those, games whose first-ever session is in the range. */
  newGames: number;
  /** Played sessions in which at least one game was new to the record. */
  newGameSessions: number;
  /** Games played exactly once in the range. */
  onePlayGames: number;
  /** The 15 most played games in the range (ties: most recently played first). */
  topGames: { name: string; plays: number }[];
  /** Sessions per style (a session with games of two styles counts for both), most sessions first. */
  styles: { style: string; sessions: number; games: number }[];
  /** Sessions per mode, most sessions first. A session with games of two modes counts for both. */
  modes: { mode: string; sessions: number }[];
  /** Played sessions that name a game, by cost kind, in COST_KINDS order (zero counts included). */
  costs: { kind: CostKind; sessions: number }[];
  /** The longest run of consecutive Played sessions of one game, when any game ran 2+ times. */
  longestRun?: { name: string; length: number; from: string; to: string };
}

export interface YearSummary {
  year: string;
  /** Played sessions in which at least one game was new to the record. */
  newGameSessions: number;
  /** Played sessions of games all seen before. */
  returningSessions: number;
  /** Played sessions with no game recorded. */
  unknownSessions: number;
  /** Cancelled and "No session" weeks. */
  off: number;
  /** Sessions per style that year. */
  styles: Record<string, number>;
}

export interface OverdueGame {
  name: string;
  plays: number;
  last: string;
  daysSince: number;
}

export interface Milestone {
  session: string;
  date: string;
  games: string[];
}

export interface NextSession {
  /** YYYY-MM-DD in the schedule's timezone. */
  date: string;
  start: string;
  status: 'announced' | 'cancelled' | 'unannounced';
  session?: string;
  games: string[];
}
