// The three views of the whole record over time: the strip plot of the most played games, the
// styles-by-year heatmap and the "every week" grid. They always show everything; the selected range
// is marked on them (the rest is toned down).

import type { GameView, HistoryData, SessionView, Slice } from '../types.ts';
import { WHOLE, card, emptyNote, expandButton, gameButton, legend } from './card.ts';
import type { Ctx, Section } from './card.ts';
import { ALL_KEY, coversEverything, inSlice, pickSlice, weekGrid, weekKey, yearsIn } from './data.ts';
import type { WeekCell } from './data.ts';
import { h } from './dom.ts';
import { count, dateOfDay, dayNumber, dotted, formatDate, formatDay, formatMonth, nthTime, plural } from './format.ts';
import { openGamesModal } from './modal.ts';
import { WEEKS_PER_YEAR, fraction, heatLevel, heatLevels, monthStartWeeks, nearestIndex, yearBands } from './scale.ts';
import type { YearBand } from './scale.ts';
import { interactiveMarks, tipCard } from './tooltip.ts';

function percentOf(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

// ---------------------------------------------------------------------------------------------
// Play history: one row per game, one tick per session
// ---------------------------------------------------------------------------------------------

const STRIP_GAMES = 20;

/** The time axis of the play history: from the first session to today. The card and its modal share it. */
interface StripScale {
  start: number;
  end: number;
  at(day: number): number;
  bands: YearBand[];
}

function stripScale(data: HistoryData): StripScale | undefined {
  const firstDay = dayNumber(data.sessions[0]?.date ?? '');
  if (Number.isNaN(firstDay)) return undefined;
  const today = dayNumber(data.today);
  const lastPlay = Math.max(...data.games.map((game) => dayNumber(game.dates.at(-1) ?? '')).filter((day) => !Number.isNaN(day)), firstDay);
  const start = firstDay;
  const end = Math.max(Number.isNaN(today) ? lastPlay : today, lastPlay, start + 1);
  return { start, end, at: (day) => fraction(day, start, end), bands: yearBands(start, end) };
}

interface Strip {
  el: HTMLElement;
  /** One row per game, for the modal's search to show or hide. */
  rows: { name: string; el: HTMLElement }[];
  /** Tones down the marks outside the selected range and shades the range. */
  mark(slice: Slice): void;
}

/** The strip plot: one row per game, one tick per session, on the record's time axis. */
function stripChart(ctx: Ctx, games: readonly GameView[], scale: StripScale): Strip {
  const { start, end, at, bands } = scale;
  const ticks: { el: HTMLElement; date: string }[] = [];
  const rangeBands: HTMLElement[] = [];
  const rowDays = new Map<HTMLElement, { days: number[]; els: HTMLElement[] }>();

  const rows = games.map((game, r) => {
    const track = h('div', { class: 'strip-track' });
    const band = h('i', { class: 'strip-band' });
    band.hidden = true;
    rangeBands.push(band);
    track.append(band);
    // A hairline where each year starts (the first one is the edge of the plot).
    for (const yearBand of bands.slice(1)) {
      const line = h('i', { class: 'strip-year' });
      line.style.left = percentOf(yearBand.from);
      track.append(line);
    }
    const days: number[] = [];
    const els: HTMLElement[] = [];
    for (const date of game.dates) {
      const day = dayNumber(date);
      if (Number.isNaN(day)) continue;
      const tick = h('i', { class: 'tk', attrs: { 'data-r': r, 'data-c': day } });
      tick.style.left = percentOf(at(day));
      track.append(tick);
      days.push(day);
      els.push(tick);
      ticks.push({ el: tick, date });
    }
    rowDays.set(track, { days, els });
    const first = game.dates[0];
    const last = game.dates.at(-1);
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', first && last ? `${plural(game.plays, 'session')}, ${formatMonth(first)} to ${formatMonth(last)}` : plural(game.plays, 'session'));
    return h(
      'li',
      { class: 'strip-row' },
      h('div', { class: 'strip-label' }, gameButton(ctx, game.name), h('span', { class: 'strip-n', attrs: { title: 'Sessions played' } }, count(game.plays))),
      track,
    );
  });

  const yearAxis = (extra: string): HTMLElement => {
    const axis = h('div', { class: `strip-axis ${extra}`, attrs: { 'aria-hidden': 'true' } });
    for (const yearBand of bands) {
      // A sliver of a year (a record that starts in December) has no room for its label.
      if (yearBand.to - yearBand.from < 0.07) continue;
      const label = h('span', { class: 'strip-yl' }, String(yearBand.year));
      label.style.left = percentOf((yearBand.from + yearBand.to) / 2);
      axis.append(label);
    }
    return h('div', { class: `strip-row strip-edge ${extra}` }, h('span', null), axis);
  };

  const chart = h(
    'div',
    { class: 'strip', attrs: { role: 'group', 'aria-label': 'Play history. The arrow keys step through the sessions of each game.' } },
    // On a phone the list is several screens long, so the years are also named above it.
    yearAxis('is-top'),
    h('ul', { class: 'strip-rows' }, ...rows),
    yearAxis('is-bottom'),
  );

  interactiveMarks(chart, {
    nearest: (event) => {
      const track = event.target instanceof Element ? event.target.closest<HTMLElement>('.strip-track') : null;
      const row = track ? rowDays.get(track) : undefined;
      if (!track || !row) return null;
      const box = track.getBoundingClientRect();
      if (!(box.width > 0)) return null;
      const day = start + ((event.clientX - box.left) / box.width) * (end - start);
      return row.els[nearestIndex(row.days, day)] ?? null;
    },
    content: (mark) => {
      const game = games[Number(mark.dataset['r'])];
      const day = Number(mark.dataset['c']);
      if (!game || Number.isNaN(day)) return null;
      const date = dateOfDay(day);
      const session = ctx.findSession(date, game.name);
      const play = session?.games.find((entry) => entry.name === game.name)?.play ?? game.dates.indexOf(date) + 1;
      return tipCard(game.name, [[formatDate(date), dotted(session?.session, nthTime(play))]]);
    },
  });

  return {
    el: chart,
    rows: games.flatMap((game, index) => {
      const el = rows[index];
      return el ? [{ name: game.name, el }] : [];
    }),
    mark(slice) {
      const everything = coversEverything(slice);
      for (const tick of ticks) tick.el.classList.toggle('is-out', !inSlice(tick.date, slice));
      const from = at(dayNumber(slice.from));
      // The band runs to the end of the range's last day, or to today when the range is still open.
      const to = at(Math.min(dayNumber(slice.to) + 1, end));
      for (const band of rangeBands) {
        band.hidden = everything || !(to > from);
        band.style.left = percentOf(from);
        band.style.width = percentOf(Math.max(0, to - from));
      }
    },
  };
}

export function playHistoryCard(ctx: Ctx): Section {
  const { data } = ctx;
  const games = data.games.slice(0, STRIP_GAMES);
  const frame = card('play-history', 'When the favourites were played', `the ${games.length === STRIP_GAMES ? `${STRIP_GAMES} ` : ''}most played games, one mark per session`);
  const scale = stripScale(data);
  if (games.length === 0 || !scale) {
    frame.body.append(emptyNote('No games recorded yet.'));
    return { el: frame.el, update() {} };
  }
  const strip = stripChart(ctx, games, scale);
  frame.body.append(strip.el);

  let current: Slice | undefined;
  expandButton(frame, 'Show every game', (opener) => {
    const slice = current;
    if (!slice) return;
    openGamesModal(ctx, {
      title: 'When the favourites were played',
      scope: WHOLE,
      caption: 'every game, most played first, one mark per session',
      opener,
      build: (inner) => {
        const all = stripChart(inner, data.games, scale);
        all.mark(slice);
        return { el: all.el, items: all.rows };
      },
    });
  });

  return {
    el: frame.el,
    update(slice) {
      current = slice;
      strip.mark(slice);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Styles by year: a heatmap on a real table
// ---------------------------------------------------------------------------------------------

const HEAT_STEPS = 5;

export function stylesByYearCard(ctx: Ctx): Section {
  const { years, styles } = ctx.data;
  const frame = card('styles-by-year', 'Styles by year', 'sessions of each style, year by year');
  // The styles are a plain object keyed by names from the record: only its own, numeric entries count
  // (a style called "constructor" must not find Object's).
  const valueOf = (yearIndex: number, style: string): number => {
    const counts = years[yearIndex]?.styles;
    if (!counts || !Object.hasOwn(counts, style)) return 0;
    const value = counts[style];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const max = Math.max(0, ...years.flatMap((_, index) => styles.map((style) => valueOf(index, style))));
  if (years.length === 0 || styles.length === 0 || max === 0) {
    frame.body.append(emptyNote('No styles recorded yet.'));
    return { el: frame.el, update() {} };
  }
  const levels = heatLevels(max, HEAT_STEPS);
  const columns: HTMLElement[][] = years.map(() => []);

  const headRow = h('tr', null, h('th', { class: 'heat-corner', attrs: { scope: 'col' } }, h('span', { class: 'sr-only' }, 'Style')));
  years.forEach((year, index) => {
    const th = h('th', { class: 'heat-year', attrs: { scope: 'col' } }, year.year);
    columns[index]?.push(th);
    headRow.append(th);
  });
  const body = h('tbody');
  styles.forEach((style, r) => {
    const tr = h('tr', null, h('th', { class: 'heat-style', attrs: { scope: 'row' } }, style));
    years.forEach((_, c) => {
      const value = valueOf(c, style);
      const level = heatLevel(value, levels);
      // An empty cell for nothing: zero is not the lightest blue.
      const cell =
        value > 0
          ? h('td', null, h('span', { class: `hc lv${level}`, attrs: { 'data-r': r, 'data-c': c } }, count(value)))
          : h('td', null, h('span', { class: 'hc lv0' }, h('span', { class: 'sr-only' }, '0')));
      columns[c]?.push(cell);
      tr.append(cell);
    });
    body.append(tr);
  });
  const table = h('table', { class: 'heat', vars: { '--cols': years.length } }, h('thead', null, headRow), body);
  const wrap = h('div', { class: 'scroll-x heat-wrap', attrs: { role: 'group', 'aria-label': 'Styles by year. The arrow keys move between the cells.' } }, table);
  interactiveMarks(wrap, {
    content: (mark) => {
      const style = styles[Number(mark.dataset['r'])];
      const yearIndex = Number(mark.dataset['c']);
      const year = years[yearIndex];
      if (style === undefined || !year) return null;
      const played = year.newGameSessions + year.returningSessions + year.unknownSessions;
      return tipCard(`${style} · ${year.year}`, [[plural(valueOf(yearIndex, style), 'session'), `of ${count(played)} played that year`]]);
    },
  });

  const scale = h(
    'div',
    { class: 'heat-scale' },
    h('span', { class: 'heat-scale-title' }, 'Sessions in a year'),
    h(
      'ul',
      { class: 'legend' },
      ...levels.map((level) =>
        h(
          'li',
          null,
          h('i', { class: `sw lv${level.level}`, attrs: { 'aria-hidden': 'true' } }),
          level.from === level.to ? count(level.from) : `${count(level.from)}–${count(level.to)}`,
        ),
      ),
    ),
  );
  frame.body.append(scale, wrap);

  return {
    el: frame.el,
    update(slice) {
      const marked = yearsIn(slice);
      years.forEach((year, index) => {
        const out = !marked.has(year.year);
        for (const el of columns[index] ?? []) el.classList.toggle('is-out', out);
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Every week: one row per year, one cell per week
// ---------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sessionLine(session: SessionView): [string, string] {
  const games = session.games.map((game) => game.name).join(', ');
  if (session.status === 'Played') return [games || 'Game not recorded', session.session ?? ''];
  const what = session.status === 'Special' ? dotted('Special session', games) : session.status;
  return [what, dotted(session.session, session.notes)];
}

function weekTip(cell: WeekCell): Node {
  return h(
    'div',
    { class: 'tip-stack' },
    ...cell.rows.map((session) => tipCard(formatDay(session.date), [sessionLine(session)])),
  );
}

export function weeksCard(ctx: Ctx): Section {
  const { data } = ctx;
  const frame = card('weeks', 'Every week', 'one row per year, one cell per week');
  const grid = weekGrid(data.sessions);
  if (grid.years.length === 0) {
    frame.body.append(emptyNote('No sessions recorded yet.'));
    return { el: frame.el, update() {} };
  }
  const all = pickSlice(data.slices, ALL_KEY);
  const gist = all ? `${plural(all.played, 'session')} played, ${plural(all.off, 'week')} off, ${count(all.special)} special` : '';
  const board = h('div', {
    class: 'weeks',
    attrs: {
      role: 'img',
      'aria-label': `Every week from ${grid.years[0] ?? ''} to ${grid.years.at(-1) ?? ''}: ${gist}. The sessions table lists each one.`,
    },
  });

  const starts = monthStartWeeks();
  starts.forEach((week, month) => {
    const next = starts[month + 1] ?? WEEKS_PER_YEAR;
    const label = h('span', { class: 'weeks-month' }, MONTHS[month] ?? '');
    label.style.gridColumn = `${week + 2} / span ${Math.max(1, next - week)}`;
    label.style.gridRow = '1';
    board.append(label);
  });

  const yearLabels: HTMLElement[] = [];
  const cellEls = new Map<string, HTMLElement>();
  grid.years.forEach((year, r) => {
    const label = h('span', { class: 'weeks-year' }, String(year));
    label.style.gridColumn = '1';
    label.style.gridRow = String(r + 2);
    yearLabels.push(label);
    board.append(label);
    for (let week = 0; week < WEEKS_PER_YEAR; week++) {
      const cell = grid.cells.get(weekKey(year, week));
      if (!cell) continue;
      const el = h('i', { class: `wk ${cell.state}`, attrs: { 'data-r': r, 'data-c': week } });
      el.style.gridColumn = String(week + 2);
      el.style.gridRow = String(r + 2);
      cellEls.set(weekKey(year, week), el);
      board.append(el);
    }
  });

  interactiveMarks(board, {
    start: 'last',
    // The cells are small (a few pixels on a phone): the pointer only has to be nearest.
    nearest: (event) => {
      const direct = event.target instanceof Element ? event.target.closest<HTMLElement>('.wk') : null;
      if (direct) return direct;
      const first = yearLabels[0]?.getBoundingClientRect();
      const box = board.getBoundingClientRect();
      if (!first || !(box.width > 0)) return null;
      const pitchY = yearLabels.length > 1 ? ((yearLabels.at(-1)?.getBoundingClientRect().top ?? first.top) - first.top) / (yearLabels.length - 1) : first.height;
      const r = Math.floor((event.clientY - first.top) / Math.max(1, pitchY));
      const year = grid.years[r];
      if (year === undefined) return null;
      const left = first.right;
      const pitchX = (box.right - left) / WEEKS_PER_YEAR;
      const column = Math.floor((event.clientX - left) / Math.max(1, pitchX));
      for (const offset of [0, -1, 1, -2, 2]) {
        const el = cellEls.get(weekKey(year, column + offset));
        if (el) return el;
      }
      return null;
    },
    content: (mark) => {
      const year = grid.years[Number(mark.dataset['r'])];
      const cell = year === undefined ? undefined : grid.cells.get(weekKey(year, Number(mark.dataset['c'])));
      return cell ? weekTip(cell) : null;
    },
  });

  const states = new Set([...grid.cells.values()].map((cell) => cell.state));
  const kinds = [
    ...(states.has('played') ? [{ swatch: 'wk played', label: 'Played' }] : []),
    ...(states.has('special') ? [{ swatch: 'wk special', label: 'Special session' }] : []),
    ...(states.has('off') ? [{ swatch: 'wk off', label: 'Week off' }] : []),
  ];
  // Only played weeks: one kind of cell needs no key, the caption says what the cells are.
  if (kinds.length === 1 && states.has('played')) frame.setCaption('one row per year, one cell per week played');
  else frame.body.append(legend(kinds));
  frame.body.append(board);

  return {
    el: frame.el,
    update(slice: Slice) {
      const marked = yearsIn(slice);
      grid.years.forEach((year, r) => {
        yearLabels[r]?.classList.toggle('is-out', !marked.has(String(year)));
      });
      for (const cell of grid.cells.values()) {
        // A cell is in the range when one of its sessions is (a week can straddle the range's edge).
        const inside = cell.rows.some((row) => inSlice(row.date, slice));
        cellEls.get(weekKey(cell.year, cell.week))?.classList.toggle('is-out', !inside);
      }
    },
  };
}
