// The parts of the page that aren't charts or the two big tables: the header, the range filter,
// the stat tiles, the "due a return" list, the milestones and the footer.

import type { HistoryData, Slice } from '../types.ts';
import { card, gameButton } from './card.ts';
import type { Ctx, Section } from './card.ts';
import { coversEverything, freeShare, nextSessionText, safeHref, subtitle } from './data.ts';
import { append, button, h, time } from './dom.ts';
import { ago, count, formatDate, formatMonth, formatMonthSpan, formatSpan, percent, plural } from './format.ts';
import { fraction } from './scale.ts';

/** Fills the header that index.html already holds: title, subtitle and the next session. */
export function fillHeader(data: HistoryData): void {
  const title = document.getElementById('title');
  const sub = document.getElementById('subtitle');
  const next = document.getElementById('next');
  if (title && data.title) title.textContent = data.title;
  if (data.title) document.title = `${data.title} · session history`;
  if (sub) sub.textContent = subtitle(data);
  if (next) {
    next.hidden = !data.next;
    if (data.next) next.textContent = nextSessionText(data.next, data.timezone);
  }
}

export interface RangeBar {
  select(slice: Slice): void;
}

/** One row of chips, one per range; `onPick` gets the key of the chip that was pressed. */
export function mountRangeBar(root: HTMLElement, slices: readonly Slice[], onPick: (key: string) => void): RangeBar {
  const chips = new Map<string, HTMLButtonElement>();
  const group = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'Time range' } });
  for (const slice of slices) {
    const chip = button({ class: 'chip', attrs: { 'aria-pressed': 'false' }, on: { click: () => onPick(slice.key) } }, slice.label);
    chips.set(slice.key, chip);
    group.append(chip);
  }
  const span = h('p', { class: 'range-span' });
  root.replaceChildren(h('div', { class: 'wrap range-in' }, group, span));
  root.hidden = false;
  return {
    select(slice) {
      for (const [key, chip] of chips) chip.setAttribute('aria-pressed', String(key === slice.key));
      span.textContent = formatSpan(slice.from, slice.to);
      // On a phone the row scrolls sideways: keep the selected chip in sight.
      const chip = chips.get(slice.key);
      if (!chip) return;
      const left = chip.offsetLeft;
      const right = left + chip.offsetWidth;
      if (left < group.scrollLeft) group.scrollLeft = left - 16;
      else if (right > group.scrollLeft + group.clientWidth) group.scrollLeft = right - group.clientWidth + 16;
    },
  };
}

function tile(label: string, value: string, note: string, unit?: string): HTMLElement {
  return h(
    'div',
    { class: 'tile' },
    h('dt', null, label),
    h('dd', { class: 'tile-val' }, value, unit ? h('span', { class: 'tile-unit' }, unit) : null),
    h('dd', { class: 'tile-note' }, note),
  );
}

/** The stat tiles of the selected range. Figures, not charts. */
export function numbersSection(ctx: Ctx): Section {
  const title = h('h2', { id: 'numbers-title', class: 'sr-only' });
  const list = h('dl', { class: 'tiles' });
  const el = h('section', { id: 'numbers', class: 'numbers', attrs: { 'aria-labelledby': 'numbers-title' } }, title, list);
  return {
    el,
    update(slice) {
      title.textContent = `Numbers: ${slice.label}`;
      const free = freeShare(slice.costs);
      const run = slice.longestRun;
      list.replaceChildren(
        tile('Sessions played', count(slice.played), formatMonthSpan(slice.from, slice.to)),
        tile(
          'Different games',
          count(slice.distinctGames),
          coversEverything(slice) ? 'played at least once' : `of ${count(ctx.data.games.length)} in the whole record`,
        ),
        tile('New games', count(slice.newGames), coversEverything(slice) ? 'every game was new once' : 'first played in this range'),
        tile(
          'Played only once',
          count(slice.onePlayGames),
          slice.distinctGames > 0 ? `${percent(slice.onePlayGames, slice.distinctGames)} of the games` : 'no games in this range',
        ),
        tile('Weeks off', count(slice.off), 'cancelled, or no session planned'),
        run
          ? tile('Longest run', count(run.length), `${run.name} · ${formatMonthSpan(run.from, run.to)}`, 'sessions in a row')
          : tile('Longest run', '–', 'no game twice in a row'),
        free.known > 0
          ? tile('Free to join', percent(free.free, free.known), `${count(free.free)} of ${plural(free.known, 'session')} with a known cost`)
          : tile('Free to join', '–', 'no costs recorded'),
      );
    },
  };
}

const OVERDUE_FIRST = 12;

/** Favourites nobody has played for over a year. A table, with a thin bar for how long it has been. */
export function overdueCard(ctx: Ctx): Section {
  const rows = ctx.data.overdue;
  const frame = card('overdue', 'Favourites due a return', 'played 3 or more times, not for over a year');
  let showAll = false;
  const longest = Math.max(1, ...rows.map((row) => row.daysSince));

  function draw(): void {
    if (rows.length === 0) {
      frame.body.replaceChildren(h('p', { class: 'empty' }, 'Nothing is overdue: every favourite was played in the last year.'));
      return;
    }
    const shown = showAll ? rows : rows.slice(0, OVERDUE_FIRST);
    const table = h(
      'table',
      { class: 'tbl overdue' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { attrs: { scope: 'col' } }, 'Game'),
          h('th', { class: 'num', attrs: { scope: 'col' } }, 'Played'),
          h('th', { attrs: { scope: 'col' } }, 'Last played'),
          h('th', { attrs: { scope: 'col' } }, 'How long ago'),
        ),
      ),
      h(
        'tbody',
        null,
        ...shown.map((row) =>
          h(
            'tr',
            null,
            h('th', { attrs: { scope: 'row' } }, gameButton(ctx, row.name)),
            h('td', { class: 'num' }, `${count(row.plays)}×`),
            h('td', { class: 'nowrap' }, time(row.last, formatMonth(row.last))),
            h(
              'td',
              null,
              h(
                'span',
                { class: 'ago' },
                h('span', { class: 'ago-text' }, ago(row.daysSince)),
                h('i', { class: 'ago-bar', vars: { '--f': fraction(row.daysSince, 0, longest).toFixed(4) }, attrs: { 'aria-hidden': 'true' } }),
              ),
            ),
          ),
        ),
      ),
    );
    frame.body.replaceChildren(table);
    if (rows.length > OVERDUE_FIRST) {
      const toggle = button(
        { class: 'ghost more', attrs: { 'aria-expanded': String(showAll) } },
        showAll ? `Show the first ${OVERDUE_FIRST}` : `Show all ${count(rows.length)}`,
      );
      toggle.addEventListener('click', () => {
        showAll = !showAll;
        draw();
        // The button was redrawn: keep the keyboard where it was.
        frame.body.querySelector<HTMLButtonElement>('.more')?.focus();
      });
      frame.body.append(toggle);
    }
  }

  draw();
  return { el: frame.el, update() {} };
}

export function milestonesCard(ctx: Ctx): Section {
  const rows = ctx.data.milestones;
  const frame = card('milestones', 'Milestones', 'the first session and every 50th');
  if (rows.length === 0) {
    frame.body.append(h('p', { class: 'empty' }, 'No numbered sessions yet.'));
  } else {
    frame.body.append(
      h(
        'ol',
        { class: 'miles' },
        ...rows.map((row) =>
          h(
            'li',
            null,
            h('strong', { class: 'miles-name' }, row.session),
            time(row.date, formatDate(row.date)),
            h('span', { class: 'miles-games' }, row.games.length > 0 ? row.games.join(', ') : 'Game not recorded'),
          ),
        ),
      ),
    );
  }
  return { el: frame.el, update() {} };
}

/** The footer: what went wrong reading the files, the downloads, and when the data was computed. */
export function fillFooter(root: HTMLElement, data: HistoryData): void {
  const inner = h('div', { class: 'wrap foot-in' });
  inner.append(h('h2', { id: 'notes-title' }, 'About this data'));
  if (data.notes.length > 0) {
    inner.append(
      h(
        'ul',
        { class: 'notes' },
        ...data.notes.map((note) =>
          h(
            'li',
            { class: note.kind === 'warning' ? 'note is-warning' : 'note' },
            h('span', { class: 'note-kind' }, note.kind === 'warning' ? 'Warning' : 'Note'),
            h('span', { class: 'note-text' }, note.text),
          ),
        ),
      ),
    );
  }
  const meta = h('p', { class: 'foot-meta' });
  const downloads: readonly [string, string][] = [
    ['/sessions.csv', 'sessions.csv'],
    ['/games.csv', 'games.csv'],
  ];
  append(meta, 'Download the record: ');
  downloads.forEach(([href, label], index) => {
    if (index > 0) append(meta, ', ');
    append(meta, h('a', { attrs: { href, download: '' } }, label));
  });
  const generated = new Date(data.generatedAt);
  if (!Number.isNaN(generated.getTime())) {
    let stamp: string;
    try {
      stamp = generated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      stamp = generated.toISOString();
    }
    append(meta, ' · Updated ', h('time', { attrs: { datetime: generated.toISOString() } }, stamp));
  }
  if (data.timezone) append(meta, ` · Start times are in ${data.timezone}`);
  inner.append(meta);
  root.setAttribute('aria-labelledby', 'notes-title');
  root.replaceChildren(inner);
  root.hidden = false;
}

/** A game's name: a link to its store page when it has a safe one. */
export function gameLink(name: string, link: string | undefined): HTMLElement {
  const href = safeHref(link);
  if (!href) return h('span', null, name);
  return h('a', { attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }, name);
}
