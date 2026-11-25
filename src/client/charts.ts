// The charts of the selected range (ranked bars, the two segmented bars) and the columns per year.
// They are built from tables, lists and plain boxes sized in CSS, so they reflow with the card and
// need no redraw when the window changes.

import type { Slice, YearSummary } from '../types.ts';
import { card, emptyNote, expandButton, gameButton, legend, tableToggle } from './card.ts';
import type { Ctx, LegendItem, Section } from './card.ts';
import { COSTS, UNKNOWN_MODE, coversEverything, inRange, modeOrder, modeSlot, yearsIn } from './data.ts';
import { button, h, srOnly } from './dom.ts';
import { ago, count, formatDate, percent, plural } from './format.ts';
import { openGamesModal } from './modal.ts';
import { fraction, ticks } from './scale.ts';
import { hoverTip, interactiveMarks, tipCard } from './tooltip.ts';

// ---------------------------------------------------------------------------------------------
// Ranked horizontal bars
// ---------------------------------------------------------------------------------------------

interface RankRow {
  /** The row's name, already a button. */
  name: HTMLElement;
  value: number;
  /** The figure in the last column, when the table has one. */
  aux?: number;
  tip: () => Node;
}

interface RankHead {
  name: string;
  value: string;
  aux?: string;
  /** Whether the column names are printed (they always exist for screen readers). */
  visible: boolean;
}

/** One bar per row, longest first, all in one colour, the value at the tip of the bar. */
function rankTable(head: RankHead, rows: readonly RankRow[]): HTMLTableElement {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const hasAux = head.aux !== undefined;
  return h(
    'table',
    { class: hasAux ? 'rank has-aux' : 'rank' },
    h('colgroup', null, h('col', { class: 'rank-c-name' }), h('col', null), hasAux ? h('col', { class: 'rank-c-aux' }) : null),
    h(
      'thead',
      { class: head.visible ? undefined : 'sr-only' },
      h(
        'tr',
        null,
        h('th', { attrs: { scope: 'col' } }, head.name),
        h('th', { attrs: { scope: 'col' } }, head.value),
        hasAux ? h('th', { class: 'num', attrs: { scope: 'col' } }, head.aux) : null,
      ),
    ),
    h(
      'tbody',
      null,
      ...rows.map((row) => {
        const tr = h(
          'tr',
          null,
          h('th', { attrs: { scope: 'row' } }, row.name),
          h(
            'td',
            null,
            h(
              'div',
              { class: 'rank-track' },
              h('i', { class: 'bar', vars: { '--f': fraction(row.value, 0, max).toFixed(4) }, attrs: { 'aria-hidden': 'true' } }),
              h('span', { class: 'rank-val' }, count(row.value)),
            ),
          ),
          hasAux ? h('td', { class: 'num rank-aux' }, row.aux === undefined ? '' : count(row.aux)) : null,
        );
        const focusTarget = row.name instanceof HTMLButtonElement ? row.name : tr;
        hoverTip(tr, row.tip, focusTarget);
        return tr;
      }),
    ),
  );
}

/** The card shows the top of the ranking; its modal shows all of it. */
const TOP_GAMES = 15;

type RankedGame = Slice['rankedGames'][number];

/** The rows of the Most played ranking: a game's name (it opens its sessions), its sessions, and a tooltip. */
function mostPlayedRows(ctx: Ctx, slice: Slice, entries: readonly RankedGame[]): RankRow[] {
  const everything = coversEverything(slice);
  return entries.map((entry) => ({
    name: gameButton(ctx, entry.name),
    value: entry.plays,
    tip: () => {
      const game = ctx.game(entry.name);
      const rows: [string, string][] = [[plural(entry.plays, 'session'), inRange(slice)]];
      if (game) {
        if (!everything) rows.push([plural(game.plays, 'session'), 'in the whole record']);
        const first = game.dates[0];
        const last = game.dates.at(-1);
        if (first) rows.push([formatDate(first), 'first played']);
        if (last) rows.push([formatDate(last), `last played, ${ago(game.daysSince)}`]);
        rows.push([game.style, 'style']);
      }
      return tipCard(entry.name, rows);
    },
  }));
}

const MOST_PLAYED_HEAD: RankHead = { name: 'Game', value: 'Sessions', visible: false };

export function mostPlayedCard(ctx: Ctx): Section {
  const frame = card('most-played', 'Most played', '');
  let current: Slice | undefined;
  const expand = expandButton(frame, 'Show every game', (opener) => {
    const slice = current;
    if (!slice) return;
    openGamesModal(ctx, {
      title: 'Most played',
      slice,
      scope: (shown) => shown.label,
      caption: 'sessions per game, every game',
      opener,
      build: (inner, shown) => {
        const table = rankTable(MOST_PLAYED_HEAD, mostPlayedRows(inner, shown, shown.rankedGames));
        const rows = Array.from(table.tBodies[0]?.rows ?? []);
        return {
          el: table,
          items: shown.rankedGames.flatMap((entry, index) => {
            const el = rows[index];
            return el ? [{ name: entry.name, el }] : [];
          }),
        };
      },
    });
  });
  return {
    el: frame.el,
    update(slice) {
      current = slice;
      frame.setScope(slice.label);
      const ranked = slice.rankedGames;
      frame.setCaption(ranked.length > TOP_GAMES ? `sessions per game, top ${TOP_GAMES} of ${count(ranked.length)}` : 'sessions per game');
      expand.hidden = ranked.length === 0;
      if (ranked.length === 0) {
        frame.body.replaceChildren(emptyNote('No games recorded in this range.'));
        return;
      }
      frame.body.replaceChildren(rankTable(MOST_PLAYED_HEAD, mostPlayedRows(ctx, slice, ranked.slice(0, TOP_GAMES))));
    },
  };
}

export function stylesCard(ctx: Ctx): Section {
  const frame = card('styles', 'Styles of game', 'sessions and different games per style');
  return {
    el: frame.el,
    update(slice) {
      frame.setScope(slice.label);
      if (slice.styles.length === 0) {
        frame.body.replaceChildren(emptyNote('No games recorded in this range.'));
        return;
      }
      frame.body.replaceChildren(
        rankTable(
          { name: 'Style', value: 'Sessions', aux: 'Games', visible: true },
          slice.styles.map((entry) => ({
            name: button({ class: 'pick', on: { click: () => ctx.showStyle(entry.style) } }, entry.style, srOnly(': show its sessions')),
            value: entry.sessions,
            aux: entry.games,
            tip: () =>
              tipCard(entry.style, [
                [plural(entry.sessions, 'session'), inRange(slice)],
                [plural(entry.games, 'game'), entry.games === 1 ? 'of this style' : 'of this style, all different'],
                [percent(entry.sessions, slice.played), 'of the sessions played'],
              ]),
          })),
        ),
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Segmented bars: one whole split into parts
// ---------------------------------------------------------------------------------------------

interface Part {
  label: string;
  value: number;
  /** Colour class: "s1" to "s8" or "neutral". */
  swatch: string;
}

/**
 * The bar itself. Tall: each part is a block with its share printed on it where it fits (the CSS
 * hides a label wider than its block). Thin: no text; the list beside it carries the figures.
 */
function segmentedBar(parts: readonly Part[], tall: boolean, shareOf?: string): HTMLElement {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const gist = parts
    .filter((part) => part.value > 0)
    .map((part) => (shareOf ? `${part.label} ${count(part.value)} (${percent(part.value, total)})` : `${part.label} ${count(part.value)}`))
    .join(', ');
  const bar = h('div', { class: tall ? 'seg seg-tall' : 'seg seg-thin', attrs: { role: 'img', 'aria-label': `Sessions: ${gist}` } });
  parts.forEach((part, index) => {
    if (!(part.value > 0)) return;
    const block = h('span', { class: `seg-part ${part.swatch}`, attrs: { 'data-r': 0, 'data-c': index } });
    block.style.flexGrow = String(part.value);
    if (tall) block.append(h('span', { class: 'seg-label' }, percent(part.value, total)));
    bar.append(block);
  });
  interactiveMarks(bar, {
    content: (mark) => {
      const part = parts[Number(mark.dataset['c'])];
      if (!part) return null;
      const rows: [string, string][] = [[count(part.value), part.value === 1 ? 'session' : 'sessions']];
      if (shareOf) rows.push([percent(part.value, total), shareOf]);
      return tipCard(part.label, rows);
    },
  });
  return bar;
}

function partsLegend(parts: readonly Part[]): HTMLElement {
  const items: LegendItem[] = parts.map((part) => ({ swatch: part.swatch, label: part.label, value: count(part.value), none: !(part.value > 0) }));
  return legend(items, true);
}

export function costCard(): Section {
  const frame = card('cost', 'What it cost to join', 'sessions by what the game cost');
  const swatches: Record<string, string> = { free: 's1', keys: 's2', paid: 's3', unknown: 'neutral' };
  return {
    el: frame.el,
    update(slice) {
      frame.setScope(slice.label);
      const counts = new Map(slice.costs.map((cost) => [cost.kind, cost.sessions]));
      const parts: Part[] = COSTS.map(({ kind, label }) => ({ label, value: counts.get(kind) ?? 0, swatch: swatches[kind] ?? 'neutral' }));
      if (!parts.some((part) => part.value > 0)) {
        frame.body.replaceChildren(emptyNote('No games recorded in this range.'));
        return;
      }
      frame.body.replaceChildren(segmentedBar(parts, true, 'of the sessions with a game'), partsLegend(parts));
    },
  };
}

export function modesCard(ctx: Ctx): Section {
  const frame = card('modes', 'Competitive or co-op', 'sessions per mode; one with two modes counts for both');
  // Every mode of the record, so a mode keeps its place and its colour whatever the range.
  const order = modeOrder(ctx.data.slices);
  return {
    el: frame.el,
    update(slice) {
      frame.setScope(slice.label);
      const counts = new Map(slice.modes.map((mode) => [mode.mode, mode.sessions]));
      const parts: Part[] = order.map((mode) => {
        const slot = modeSlot(mode, order);
        return { label: mode === UNKNOWN_MODE ? 'Not set' : mode, value: counts.get(mode) ?? 0, swatch: slot === 0 ? 'neutral' : `s${slot}` };
      });
      if (!parts.some((part) => part.value > 0)) {
        frame.body.replaceChildren(emptyNote('No games recorded in this range.'));
        return;
      }
      frame.body.replaceChildren(segmentedBar(parts, false), partsLegend(parts));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Sessions per year: stacked columns
// ---------------------------------------------------------------------------------------------

interface YearSeries {
  /** In the legend. */
  label: string;
  /** After a count: "14 with a new game". */
  phrase: string;
  swatch: string;
  value: (year: YearSummary) => number;
}

const YEAR_SERIES: readonly YearSeries[] = [
  { label: 'New game', phrase: 'with a game new to the group', swatch: 's1', value: (year) => year.newGameSessions },
  { label: 'Played before', phrase: 'of games played before', swatch: 's2', value: (year) => year.returningSessions },
  { label: 'No game recorded', phrase: 'with no game recorded', swatch: 'neutral', value: (year) => year.unknownSessions },
];

function playedIn(year: YearSummary): number {
  return year.newGameSessions + year.returningSessions + year.unknownSessions;
}

export function yearsCard(ctx: Ctx): Section {
  const years = ctx.data.years;
  const frame = card('years', 'Sessions per year', 'new games and old favourites; weeks off under each year');
  if (years.length === 0) {
    frame.body.append(emptyNote('No sessions recorded yet.'));
    return { el: frame.el, update() {} };
  }
  // "No game recorded" only gets a place when some year has such a session.
  const series = YEAR_SERIES.filter((entry) => entry.swatch !== 'neutral' || years.some((year) => entry.value(year) > 0));
  const most = Math.max(1, ...years.map(playedIn));
  const axis = ticks(most);
  const top = axis.at(-1) ?? most;
  const best = years.filter((year) => playedIn(year) === most).map((year) => year.year);

  const plot = h('div', { class: 'yc-plot' });
  for (const tick of axis) {
    const line = h('i', { class: tick === 0 ? 'yc-line is-base' : 'yc-line' });
    line.style.bottom = `${(fraction(tick, 0, top) * 100).toFixed(2)}%`;
    const label = h('span', { class: 'yc-tick' }, count(tick));
    label.style.bottom = line.style.bottom;
    plot.append(line, label);
  }
  const columns = h('div', { class: 'yc-cols' });
  const labels = h('div', { class: 'yc-x' });
  const marked: { year: string; els: HTMLElement[] }[] = [];
  years.forEach((year, index) => {
    const total = playedIn(year);
    const stack = h('div', { class: 'yc-stack' });
    stack.style.height = `${(fraction(total, 0, top) * 100).toFixed(2)}%`;
    const blocks = series.filter((entry) => entry.value(year) > 0);
    blocks.forEach((entry, at) => {
      const block = h('i', { class: at === blocks.length - 1 ? `yc-seg ${entry.swatch} is-top` : `yc-seg ${entry.swatch}` });
      block.style.flexGrow = String(entry.value(year));
      stack.append(block);
    });
    const column = h('div', { class: 'yc-col', attrs: { 'data-r': 0, 'data-c': index } }, h('span', { class: 'yc-cap' }, count(total)), stack);
    const label = h('div', { class: 'yc-xl' }, h('span', { class: 'yc-year' }, year.year), h('span', { class: 'yc-off' }, `${count(year.off)} off`));
    columns.append(column);
    labels.append(label);
    marked.push({ year: year.year, els: [column, label] });
  });
  plot.append(columns);

  const first = years[0]?.year ?? '';
  const last = years.at(-1)?.year ?? '';
  const chart = h(
    'div',
    {
      class: 'yc',
      attrs: {
        role: 'img',
        'aria-label': `Sessions played per year, ${first} to ${last}. The most: ${count(most)} in ${best.join(' and ')}. The table view lists every year.`,
      },
    },
    plot,
    labels,
  );
  interactiveMarks(chart, {
    start: 'last',
    pin: true,
    content: (mark) => {
      const year = years[Number(mark.dataset['c'])];
      if (!year) return null;
      const rows: [string, string, string][] = series.map((entry) => [count(entry.value(year)), entry.phrase, entry.swatch]);
      return tipCard(`${year.year} · ${plural(playedIn(year), 'session')}`, rows, `${plural(year.off, 'week')} off`);
    },
  });

  const table = h(
    'table',
    { class: 'tbl' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { attrs: { scope: 'col' } }, 'Year'),
        ...series.map((entry) => h('th', { class: 'num', attrs: { scope: 'col' } }, entry.label)),
        h('th', { class: 'num', attrs: { scope: 'col' } }, 'Sessions'),
        h('th', { class: 'num', attrs: { scope: 'col' } }, 'Weeks off'),
      ),
    ),
    h(
      'tbody',
      null,
      ...years.map((year) =>
        h(
          'tr',
          null,
          h('th', { attrs: { scope: 'row' } }, year.year),
          ...series.map((entry) => h('td', { class: 'num' }, count(entry.value(year)))),
          h('td', { class: 'num' }, count(playedIn(year))),
          h('td', { class: 'num' }, count(year.off)),
        ),
      ),
    ),
  );
  const tableWrap = h('div', { class: 'scroll-x' }, table);
  const chartWrap = h('div', { class: 'yc-wrap' }, legend(series.map((entry) => ({ swatch: entry.swatch, label: entry.label }))), h('div', { class: 'scroll-x' }, chart));
  frame.body.append(chartWrap, tableWrap);
  tableToggle(frame, chartWrap, tableWrap);

  return {
    el: frame.el,
    update(slice: Slice) {
      const inRangeYears = yearsIn(slice);
      for (const entry of marked) {
        for (const el of entry.els) el.classList.toggle('is-out', !inRangeYears.has(entry.year));
      }
    },
  };
}
