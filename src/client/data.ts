// Looking things up in the page's data: which rows a range or a search shows, how the games table
// is sorted, the week grid, and the few sentences built from the data. Pure: no DOM.
//
// The statistics themselves come computed from the server (../types.ts); nothing here recounts them.

import type { CostKind, GameView, HistoryData, NextSession, SessionView, Slice } from '../types.ts';
import { formatDayNoYear, formatMonthLong, parseDate, plural } from './format.ts';
import { weekIndex } from './scale.ts';

/** The key of the slice that covers the whole record. */
export const ALL_KEY = 'all';

/** The key of the "last 12 months" slice. */
export const RECENT_KEY = 'recent';

/** Display order and names of the cost kinds (the order of COST_KINDS in ../types.ts). */
export const COSTS: readonly { kind: CostKind; label: string }[] = [
  { kind: 'free', label: 'Free' },
  { kind: 'keys', label: 'Keys from the host' },
  { kind: 'paid', label: 'Paid' },
  { kind: 'unknown', label: 'Not recorded' },
];

/** The mode the server reports for sessions whose game has none. */
export const UNKNOWN_MODE = 'Unknown';

/**
 * The modes in the order they are drawn, which is also the order of their colour slots (the palette
 * is only checked for neighbours in that order).
 */
const KNOWN_MODES = ['Competitive', 'Co-op', 'Mixed', 'Party'];

/** The slice a range key names; the whole record when the key is unknown (an old link, a typo). */
export function pickSlice(slices: readonly Slice[], key: string | null | undefined): Slice | undefined {
  return slices.find((slice) => slice.key === key) ?? slices.find((slice) => slice.key === ALL_KEY) ?? slices[0];
}

export function coversEverything(slice: Slice): boolean {
  return slice.key === ALL_KEY;
}

/** The rows whose date is in the slice's range. */
export function sessionsIn(sessions: readonly SessionView[], slice: Slice): SessionView[] {
  if (coversEverything(slice)) return [...sessions];
  return sessions.filter((session) => session.date >= slice.from && session.date <= slice.to);
}

/** Whether a date is inside the slice's range. */
export function inSlice(date: string, slice: Slice): boolean {
  return coversEverything(slice) || (date >= slice.from && date <= slice.to);
}

/** "in 2024", "in the last 12 months", "in the whole record": where a slice's numbers come from. */
export function inRange(slice: Slice): string {
  if (coversEverything(slice)) return 'in the whole record';
  if (slice.key === RECENT_KEY) return 'in the last 12 months';
  return `in ${slice.label}`;
}

/** The calendar years a slice touches ("2025" and "2026" for the last 12 months). */
export function yearsIn(slice: Slice): Set<string> {
  const years = new Set<string>();
  const from = parseDate(slice.from);
  const to = parseDate(slice.to);
  if (!from || !to) return years;
  for (let year = from.year; year <= to.year; year++) years.add(String(year));
  return years;
}

export type RowKind = 'all' | 'played' | 'off';

export interface SessionFilter {
  /** Free text: matches a game, the session's name, a style or the notes. */
  query: string;
  kind: RowKind;
  /** Only sessions of exactly this game. */
  game?: string;
  /** Only sessions with a game of exactly this style. */
  style?: string;
}

export function isOffWeek(session: SessionView): boolean {
  return session.status === 'Cancelled' || session.status === 'No session';
}

export function matchesSession(session: SessionView, filter: SessionFilter): boolean {
  if (filter.kind === 'played' && session.status !== 'Played') return false;
  if (filter.kind === 'off' && !isOffWeek(session)) return false;
  if (filter.game !== undefined && !session.games.some((game) => game.name === filter.game)) return false;
  if (filter.style !== undefined && !session.styles.includes(filter.style)) return false;
  const words = filter.query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = [
    ...session.games.map((game) => game.name),
    ...session.planned,
    session.session ?? '',
    ...session.styles,
    session.notes ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The rows a filter keeps, newest first. */
export function filterSessions(sessions: readonly SessionView[], filter: SessionFilter): SessionView[] {
  return sessions.filter((session) => matchesSession(session, filter)).reverse();
}

export type GameSortKey = 'name' | 'plays' | 'first' | 'last' | 'since' | 'run' | 'style' | 'mode';
export type SortDir = 'asc' | 'desc';

/** The direction a column sorts in when it is first picked: numbers and dates start with the most. */
export function defaultDir(key: GameSortKey): SortDir {
  return key === 'name' || key === 'style' || key === 'mode' ? 'asc' : 'desc';
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
}

function sortValue(game: GameView, key: GameSortKey): string | number {
  switch (key) {
    case 'name':
      return game.name;
    case 'plays':
      return game.plays;
    case 'first':
      return game.dates[0] ?? '';
    case 'last':
      return game.dates.at(-1) ?? '';
    case 'since':
      return game.daysSince;
    case 'run':
      return game.longestRun;
    case 'style':
      return game.style;
    case 'mode':
      return game.mode ?? '';
  }
}

/** A sorted copy. Equal games keep the order they came in (most played first), whichever way the column runs. */
export function sortGames(games: readonly GameView[], key: GameSortKey, dir: SortDir): GameView[] {
  const sign = dir === 'asc' ? 1 : -1;
  return games
    .map((game, index) => ({ game, index, value: sortValue(game, key) }))
    .sort((a, b) => {
      // Games with no mode go last in both directions.
      if (a.value === '' && b.value !== '') return 1;
      if (b.value === '' && a.value !== '') return -1;
      const order =
        typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : compareText(String(a.value), String(b.value));
      return order !== 0 ? order * sign : a.index - b.index;
    })
    .map((entry) => entry.game);
}

export function matchesGame(game: GameView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = [game.name, game.style, game.mode ?? '', game.where ?? '', game.developer ?? '', ...game.tags].join('\n').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** How many sessions with a known cost were free for the players (free, or keys from the host). */
export function freeShare(costs: readonly { kind: CostKind; sessions: number }[]): { free: number; known: number } {
  let free = 0;
  let known = 0;
  for (const cost of costs) {
    if (cost.kind === 'unknown') continue;
    known += cost.sessions;
    if (cost.kind === 'free' || cost.kind === 'keys') free += cost.sessions;
  }
  return { free, known };
}

/**
 * Every mode in the record, in the order the modes card draws them: the known ones first, then any
 * other name in the order the record brings it up, and "Unknown" last. The order never depends on
 * the selected range, so a mode keeps its place and its colour.
 */
export function modeOrder(slices: readonly Slice[]): string[] {
  const seen = new Set<string>();
  for (const slice of slices) {
    for (const entry of slice.modes) seen.add(entry.mode);
  }
  const known = KNOWN_MODES.filter((mode) => seen.has(mode));
  const others = [...seen].filter((mode) => !KNOWN_MODES.includes(mode) && mode !== UNKNOWN_MODE);
  return [...known, ...others, ...(seen.has(UNKNOWN_MODE) ? [UNKNOWN_MODE] : [])];
}

/** The colour slot (1 to 8) a mode wears, or 0 for the neutral grey ("Unknown", and any mode past the eighth). */
export function modeSlot(mode: string, order: readonly string[]): number {
  const fixed: Record<string, number> = { Competitive: 1, 'Co-op': 2, Mixed: 3, Party: 4 };
  if (mode === UNKNOWN_MODE) return 0;
  // Mode names come from the record: only the object's own keys count ("constructor" is not a mode).
  const known = Object.hasOwn(fixed, mode) ? fixed[mode] : undefined;
  if (known !== undefined) return known;
  const extras = order.filter((name) => !Object.hasOwn(fixed, name) && name !== UNKNOWN_MODE);
  const slot = 5 + extras.indexOf(mode);
  return slot >= 5 && slot <= 8 ? slot : 0;
}

export type WeekState = 'played' | 'special' | 'off';

export interface WeekCell {
  year: number;
  week: number;
  state: WeekState;
  /** The rows of that week, oldest first (two sessions can share a week). */
  rows: SessionView[];
}

const STATE_RANK: Record<WeekState, number> = { played: 3, special: 2, off: 1 };

function stateOf(session: SessionView): WeekState {
  if (session.status === 'Played') return 'played';
  if (session.status === 'Special') return 'special';
  return 'off';
}

export interface WeekGrid {
  /** Every year from the first row to the last, oldest first (also years without a row). */
  years: number[];
  cells: Map<string, WeekCell>;
}

export function weekKey(year: number, week: number): string {
  return `${year}:${week}`;
}

/** One cell per week that has a row. A week with a played session counts as played whatever else is in it. */
export function weekGrid(sessions: readonly SessionView[]): WeekGrid {
  const cells = new Map<string, WeekCell>();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    const parts = parseDate(session.date);
    if (!parts) continue;
    const week = weekIndex(session.date);
    first = Math.min(first, parts.year);
    last = Math.max(last, parts.year);
    const key = weekKey(parts.year, week);
    const state = stateOf(session);
    const cell = cells.get(key);
    if (!cell) {
      cells.set(key, { year: parts.year, week, state, rows: [session] });
    } else {
      cell.rows.push(session);
      if (STATE_RANK[state] > STATE_RANK[cell.state]) cell.state = state;
    }
  }
  const years: number[] = [];
  for (let year = first; year <= last; year++) years.push(year);
  return { years, cells };
}

/** Finds the session a game was played in on a date (the strip plot knows only the game and its dates). */
export function sessionIndex(sessions: readonly SessionView[]): (date: string, game: string) => SessionView | undefined {
  const byDate = new Map<string, SessionView[]>();
  for (const session of sessions) {
    const list = byDate.get(session.date);
    if (list) list.push(session);
    else byDate.set(session.date, [session]);
  }
  return (date, game) => {
    const rows = byDate.get(date) ?? [];
    return rows.find((row) => row.status === 'Played' && row.games.some((entry) => entry.name === game)) ?? rows.find((row) => row.games.some((entry) => entry.name === game));
  };
}

/** The games by name. */
export function gamesByName(games: readonly GameView[]): Map<string, GameView> {
  return new Map(games.map((game) => [game.name, game]));
}

/** A link is only used when it is plainly a web address. */
export function safeHref(link: string | undefined): string | undefined {
  if (typeof link !== 'string') return undefined;
  return /^https?:\/\//i.test(link) ? link : undefined;
}

/** "271 sessions of 117 games since June 2020" */
export function subtitle(data: HistoryData): string {
  const all = pickSlice(data.slices, ALL_KEY);
  const first = data.sessions[0];
  if (!all || !first) return '';
  const since = parseDate(first.date) ? ` since ${formatMonthLong(first.date)}` : '';
  return `${plural(all.played, 'session')} of ${plural(data.games.length, 'game')}${since}`;
}

/** The header's line about the upcoming session. */
export function nextSessionText(next: NextSession, timezone: string | undefined): string {
  const day = formatDayNoYear(next.date);
  const time = [next.start, timezone].filter((part) => typeof part === 'string' && part !== '').join(' ');
  const when = next.start ? `${day} at ${time}` : day;
  if (next.status === 'cancelled') return `No session on ${day}`;
  if (next.status === 'unannounced' || next.games.length === 0) return `Next session: ${when} · game not announced yet`;
  return `Next: ${[next.session, when, next.games.join(', ')].filter((part) => typeof part === 'string' && part !== '').join(' · ')}`;
}
