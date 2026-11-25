// The two big tables: every row of the record in the selected range, and every game.

import type { GameView, SessionView, Slice } from '../types.ts';
import { card } from './card.ts';
import type { Ctx, Section } from './card.ts';
import { coversEverything, defaultDir, filterSessions, matchesGame, sessionsIn, sortGames } from './data.ts';
import type { GameSortKey, RowKind, SessionFilter, SortDir } from './data.ts';
import { append, button, h, time } from './dom.ts';
import type { Child } from './dom.ts';
import { ago, count, formatDate, formatDay, playMarker, plural } from './format.ts';
import { gameLink } from './page.ts';

const PAGE = 50;
const AUTO_HINT = 'Added by the bot from the announcement; not checked by hand';

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export interface SessionsSection extends Section {
  /** Narrow the table to one game or one style (and clear the search, which could hide it). */
  showGame(name: string): void;
  showStyle(style: string): void;
}

const KINDS: readonly { kind: RowKind; label: string }[] = [
  { kind: 'played', label: 'Played' },
  { kind: 'off', label: 'Weeks off' },
  { kind: 'all', label: 'All' },
];

function searchBox(label: string, placeholder: string, onInput: (value: string) => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'search-input', attrs: { type: 'search', placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' } });
  input.addEventListener('input', () => onInput(input.value));
  return { el: h('div', { class: 'search' }, input), input };
}

function gamesCell(session: SessionView): Child[] {
  const out: Child[] = [];
  const planned = session.planned.join(', ');
  if (session.status !== 'Played') {
    out.push(h('span', { class: 'status-tag' }, session.status));
  }
  if (session.games.length > 0) {
    const list = h('span', { class: 'game-list' });
    session.games.forEach((game, index) => {
      const marker = playMarker(game.play);
      const item = h('span', { class: 'game-item' }, game.name);
      if (marker) append(item, ' ', h('span', { class: marker === 'new' ? 'marker is-new' : 'marker' }, marker));
      // A dot between games: a comma would trail after the marker.
      if (index > 0) append(list, h('span', { class: 'quiet sep' }, ' · '));
      append(list, item);
    });
    out.push(list);
  } else if (session.status === 'Played') {
    out.push(h('span', { class: 'quiet' }, 'Game not recorded'));
  }
  if (planned) {
    out.push(h('span', { class: 'quiet planned' }, session.status === 'Played' ? `(planned: ${planned})` : `planned: ${planned}`));
  }
  return out;
}

function sessionRow(session: SessionView): HTMLTableRowElement {
  const played = session.status === 'Played';
  return h(
    'tr',
    { class: played ? undefined : 'is-off' },
    h('td', { class: 'c-date nowrap' }, time(session.date, formatDay(session.date))),
    h(
      'td',
      { class: 'c-sess nowrap' },
      session.session ?? '',
      session.auto ? h('span', { class: 'tag', attrs: { title: AUTO_HINT } }, 'auto') : null,
    ),
    h('td', { class: 'c-games' }, ...gamesCell(session)),
    h('td', { class: 'c-style' }, session.styles.join(', ')),
    h('td', { class: 'c-cost' }, session.cost ?? ''),
    h('td', { class: 'c-notes' }, session.notes ?? ''),
  );
}

export function sessionsCard(ctx: Ctx): SessionsSection {
  const frame = card('sessions', 'Sessions', 'every week on record, newest first');
  const filter: SessionFilter = { query: '', kind: 'all' };
  let slice: Slice | undefined;
  let shown = PAGE;

  const search = searchBox('Search sessions', 'Search game, session, style or notes', (value) => {
    filter.query = value;
    shown = PAGE;
    draw();
  });
  const kindButtons = KINDS.map(({ kind, label }) => {
    const el = button({ class: 'seg-btn', attrs: { 'aria-pressed': String(kind === filter.kind) } }, label);
    el.addEventListener('click', () => {
      filter.kind = kind;
      shown = PAGE;
      for (const other of kindButtons) other.setAttribute('aria-pressed', String(other === el));
      draw();
    });
    return el;
  });
  const picked = h('div', { class: 'picked' });
  const total = h('p', { class: 'count', attrs: { role: 'status' } });
  const toolbar = h('div', { class: 'toolbar' }, search.el, h('div', { class: 'seg-ctl', attrs: { role: 'group', 'aria-label': 'Which weeks' } }, ...kindButtons), picked, total);
  const body = h('tbody');
  const table = h(
    'table',
    { class: 'tbl sess' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        ...['Date', 'Session', 'Games', 'Style', 'Cost', 'Notes'].map((label) => h('th', { attrs: { scope: 'col' } }, label)),
      ),
    ),
    body,
  );
  const after = h('div', { class: 'after' });
  frame.body.append(toolbar, h('div', { class: 'scroll-x' }, table), after);

  function pickedChip(label: string, value: string, clear: () => void): HTMLElement {
    const remove = button({ class: 'picked-x', attrs: { 'aria-label': `Remove the filter: ${label} ${value}` } }, h('span', { attrs: { 'aria-hidden': 'true' } }, '×'));
    remove.addEventListener('click', () => {
      clear();
      shown = PAGE;
      draw();
      search.input.focus();
    });
    return h('span', { class: 'picked-chip' }, h('span', { class: 'quiet' }, `${label}: `), value, remove);
  }

  function draw(): void {
    if (!slice) return;
    const inRange = sessionsIn(ctx.data.sessions, slice);
    const rows = filterSessions(inRange, filter);
    picked.replaceChildren(
      ...(filter.game !== undefined
        ? [
            pickedChip('Game', filter.game, () => {
              delete filter.game;
            }),
          ]
        : []),
      ...(filter.style !== undefined
        ? [
            pickedChip('Style', filter.style, () => {
              delete filter.style;
            }),
          ]
        : []),
    );
    total.textContent = `${count(rows.length)} of ${count(inRange.length)}`;
    const visible = rows.slice(0, shown);
    body.replaceChildren(...visible.map(sessionRow));
    table.hidden = rows.length === 0;

    after.replaceChildren();
    if (rows.length === 0) {
      const none = h('p', { class: 'empty' }, inRange.length === 0 ? 'No rows in this range.' : 'No rows match.');
      if (!coversEverything(slice) && filterSessions(ctx.data.sessions, filter).length > 0) {
        append(none, ' ', button({ class: 'ghost', on: { click: () => ctx.showEverything() } }, 'Look in the whole record'));
      }
      after.append(none);
    }
    if (rows.length > visible.length) {
      const left = rows.length - visible.length;
      const more = button({ class: 'ghost more' }, `Show ${count(Math.min(PAGE, left))} more`);
      more.addEventListener('click', () => {
        const firstNew = shown;
        shown += PAGE;
        draw();
        // Keep the keyboard in the table: the button moved (or went away).
        const next = after.querySelector<HTMLButtonElement>('.more');
        if (next) next.focus();
        else body.children[firstNew]?.scrollIntoView({ block: 'nearest' });
      });
      after.append(more, h('span', { class: 'quiet' }, ` ${count(left)} more below`));
    }
    if (visible.some((row) => row.auto)) {
      after.append(h('p', { class: 'fine' }, h('span', { class: 'tag' }, 'auto'), ` ${AUTO_HINT}.`));
    }
  }

  function show(change: () => void): void {
    filter.query = '';
    search.input.value = '';
    delete filter.game;
    delete filter.style;
    change();
    shown = PAGE;
    draw();
  }

  return {
    el: frame.el,
    update(next) {
      slice = next;
      frame.setScope(next.label);
      shown = PAGE;
      draw();
    },
    showGame(name) {
      show(() => {
        filter.game = name;
      });
    },
    showStyle(style) {
      show(() => {
        filter.style = style;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

interface GameColumn {
  key: GameSortKey;
  label: string;
  numeric: boolean;
}

const GAME_COLUMNS: readonly GameColumn[] = [
  { key: 'name', label: 'Game', numeric: false },
  { key: 'plays', label: 'Times played', numeric: true },
  { key: 'first', label: 'First played', numeric: false },
  { key: 'last', label: 'Last played', numeric: false },
  { key: 'since', label: 'How long ago', numeric: false },
  { key: 'run', label: 'Most in a row', numeric: true },
  { key: 'style', label: 'Style', numeric: false },
  { key: 'mode', label: 'Mode', numeric: false },
];

function dateCell(ymd: string | undefined): Child {
  return ymd ? time(ymd, formatDate(ymd)) : '';
}

function gameRow(game: GameView): HTMLTableRowElement {
  const tags = game.tags.slice(0, 3).join(' · ');
  const label = (column: number): Record<string, string> => ({ 'data-label': GAME_COLUMNS[column]?.label ?? '' });
  return h(
    'tr',
    null,
    h('th', { class: 'c-name', attrs: { scope: 'row' } }, gameLink(game.name, game.link), tags ? h('span', { class: 'tags' }, tags) : null),
    h('td', { class: 'num', attrs: label(1) }, count(game.plays)),
    h('td', { class: 'nowrap', attrs: label(2) }, dateCell(game.dates[0])),
    h('td', { class: 'nowrap', attrs: label(3) }, dateCell(game.dates.at(-1))),
    // No label on a phone: "16 months ago" right after the last date says it all.
    h('td', { class: 'nowrap' }, ago(game.daysSince)),
    h('td', { class: 'num', attrs: label(5) }, count(game.longestRun)),
    h('td', { attrs: label(6) }, game.style),
    h('td', { attrs: label(7) }, game.mode ?? ''),
  );
}

export function gamesCard(ctx: Ctx): Section {
  const games = ctx.data.games;
  const frame = card('games', 'Games', 'every game played, with its store tags');
  let sortKey: GameSortKey = 'plays';
  let sortDir: SortDir = 'desc';
  let query = '';
  let showAll = false;

  const search = searchBox('Search games', 'Search game, style, mode or tag', (value) => {
    query = value;
    draw();
  });
  const total = h('p', { class: 'count', attrs: { role: 'status' } });
  const headers = GAME_COLUMNS.map((column) => {
    const sorter = button({ class: 'sort' }, column.label, h('i', { class: 'sort-mark', attrs: { 'aria-hidden': 'true' } }));
    sorter.addEventListener('click', () => {
      if (sortKey === column.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = column.key;
        sortDir = defaultDir(column.key);
      }
      draw();
    });
    return h('th', { class: column.numeric ? 'num' : undefined, attrs: { scope: 'col' } }, sorter);
  });
  const body = h('tbody');
  const table = h('table', { class: 'tbl games' }, h('thead', null, h('tr', null, ...headers)), body);
  const after = h('div', { class: 'after' });
  frame.body.append(h('div', { class: 'toolbar' }, search.el, total), h('div', { class: 'scroll-x' }, table), after);

  function draw(): void {
    GAME_COLUMNS.forEach((column, index) => {
      const th = headers[index];
      if (!th) return;
      if (column.key === sortKey) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    const rows = sortGames(
      games.filter((game) => matchesGame(game, query)),
      sortKey,
      sortDir,
    );
    const visible = showAll ? rows : rows.slice(0, PAGE);
    total.textContent = rows.length === games.length ? plural(games.length, 'game') : `${count(rows.length)} of ${plural(games.length, 'game')}`;
    body.replaceChildren(...visible.map(gameRow));
    table.hidden = rows.length === 0;
    after.replaceChildren();
    if (rows.length === 0) after.append(h('p', { class: 'empty' }, games.length === 0 ? 'No games recorded yet.' : 'No games match.'));
    if (rows.length > visible.length) {
      const more = button({ class: 'ghost more' }, `Show all ${count(rows.length)}`);
      more.addEventListener('click', () => {
        showAll = true;
        draw();
        body.children[PAGE]?.scrollIntoView({ block: 'nearest' });
      });
      after.append(more);
    }
  }

  draw();
  return { el: frame.el, update() {} };
}
