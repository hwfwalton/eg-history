// The session history page: fetches the record once, then draws the dashboard. Everything shown is
// computed on the server (../types.ts); this script filters, sorts and draws.
//
// Every string in the data is untrusted text: it only ever reaches the page as a text node or as
// the value of an attribute named in the code (dom.ts). There is no innerHTML anywhere.

import type { HistoryData, Slice } from '../types.ts';
import type { Ctx, Section } from './card.ts';
import { costCard, modesCard, mostPlayedCard, stylesCard, yearsCard } from './charts.ts';
import { ALL_KEY, gamesByName, pickSlice, sessionIndex, sessionsIn } from './data.ts';
import { button, h } from './dom.ts';
import { playHistoryCard, stylesByYearCard, weeksCard } from './grids.ts';
import { fillFooter, fillHeader, milestonesCard, mountRangeBar, numbersSection, overdueCard } from './page.ts';
import { gamesCard, sessionsCard } from './tables.ts';
import { initTheme, themeControl } from './theme.ts';
import { hideTip } from './tooltip.ts';

const DATA_URL = '/api/history.json';
const RANGE_PARAM = 'range';

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function readRange(): string | null {
  return new URLSearchParams(location.search).get(RANGE_PARAM);
}

/** Keeps the selected range in the address, so a link to the page opens on the same view. */
function writeRange(key: string): void {
  try {
    const url = new URL(location.href);
    if (key === ALL_KEY) url.searchParams.delete(RANGE_PARAM);
    else url.searchParams.set(RANGE_PARAM, key);
    history.replaceState(history.state, '', url);
  } catch {
    // The page works the same without it.
  }
}

/** Goes to the section the address names ("#most-played"), now that it exists. */
function scrollToHash(): void {
  let id = '';
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  if (id) byId(id)?.scrollIntoView();
}

function looksLikeHistory(value: unknown): value is HistoryData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return ['sessions', 'games', 'slices', 'years', 'styles', 'overdue', 'milestones', 'notes'].every((key) => Array.isArray(data[key]));
}

function showStatus(app: HTMLElement, ...content: (Node | string)[]): void {
  app.replaceChildren(h('p', { class: 'status', id: 'status', attrs: { role: 'status' } }, ...content));
}

function draw(app: HTMLElement, data: HistoryData): void {
  fillHeader(data);
  const footer = byId('notes');
  if (footer) fillFooter(footer, data);

  const first = pickSlice(data.slices, readRange());
  if (data.sessions.length === 0 || !first) {
    showStatus(app, 'No sessions recorded yet.');
    return;
  }
  let slice: Slice = first;

  const games = gamesByName(data.games);
  const ctx: Ctx = {
    data,
    game: (name) => games.get(name),
    findSession: sessionIndex(data.sessions),
    showGame: (name) => goToSessions((rows) => rows.some((row) => row.games.some((game) => game.name === name)), () => sessions.showGame(name)),
    showStyle: (style) => goToSessions((rows) => rows.some((row) => row.styles.includes(style)), () => sessions.showStyle(style)),
    showEverything: () => setRange(ALL_KEY),
  };

  const sessions = sessionsCard(ctx);
  const sections: Section[] = [
    numbersSection(ctx),
    mostPlayedCard(ctx),
    stylesCard(ctx),
    costCard(),
    modesCard(ctx),
    overdueCard(ctx),
    playHistoryCard(ctx),
    yearsCard(ctx),
    stylesByYearCard(ctx),
    milestonesCard(ctx),
    weeksCard(ctx),
    sessions,
    gamesCard(ctx),
  ];

  const rangeRoot = byId('range');
  const rangeBar = rangeRoot ? mountRangeBar(rangeRoot, data.slices, (key) => setRange(key)) : undefined;

  function refresh(): void {
    hideTip();
    rangeBar?.select(slice);
    for (const section of sections) section.update(slice);
  }

  function setRange(key: string): void {
    const next = pickSlice(data.slices, key);
    if (!next || next === slice) return;
    slice = next;
    writeRange(slice.key);
    refresh();
  }

  /**
   * Narrows the sessions table and goes there. A game picked from a whole-record card may have no
   * session in the selected range: then the range widens to the whole record instead of showing nothing.
   */
  function goToSessions(inRange: (rows: ReturnType<typeof sessionsIn>) => boolean, narrow: () => void): void {
    if (!inRange(sessionsIn(data.sessions, slice))) setRange(ALL_KEY);
    narrow();
    sessions.el.scrollIntoView();
    sessions.el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  app.replaceChildren(h('div', { class: 'grid' }, ...sections.map((section) => section.el)));
  refresh();
  scrollToHash();
}

async function load(app: HTMLElement): Promise<void> {
  showStatus(app, 'Loading…');
  try {
    const response = await fetch(DATA_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!looksLikeHistory(data)) throw new Error('Unexpected data');
    draw(app, data);
  } catch (err) {
    console.error('History page: loading failed', err);
    showStatus(app, "Couldn't load the session history. ", button({ class: 'ghost', on: { click: () => void load(app) } }, 'Try again'));
  }
}

const theme = initTheme();
byId('theme')?.replaceChildren(themeControl(theme));
const app = byId('app');
if (app) void load(app);
