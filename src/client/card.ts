// What every section of the dashboard shares: the card frame (title, scope, caption), the legend,
// the "Show as table" switch, and the button a game's name becomes.

import type { GameView, HistoryData, SessionView, Slice } from '../types.ts';
import { button, h, icon, srOnly } from './dom.ts';

/** The scope label of the cards the range filter doesn't change. */
export const WHOLE = 'Whole record';

/** What the sections need from the page. */
export interface Ctx {
  data: HistoryData;
  game(name: string): GameView | undefined;
  /** The session a game was played in on a date. */
  findSession(date: string, game: string): SessionView | undefined;
  /** Filters the sessions table to one game (or one style) and goes there. */
  showGame(name: string): void;
  showStyle(style: string): void;
  /** Selects the range that covers the whole record. */
  showEverything(): void;
}

export interface Section {
  el: HTMLElement;
  /** Redraws (or re-marks) the section for the selected range. */
  update(slice: Slice): void;
}

export interface Card {
  el: HTMLElement;
  body: HTMLDivElement;
  /** Room for a control on the title line. */
  tools: HTMLDivElement;
  setScope(text: string): void;
  setCaption(text: string): void;
}

/** A titled card: `scope` says which sessions it counts ("2024", "Whole record"), `caption` what it shows. */
export function card(id: string, title: string, caption: string, scope: string = WHOLE): Card {
  const scopeEl = h('span', { class: 'scope' }, scope);
  const captionEl = h('span', null, caption);
  const tools = h('div', { class: 'card-tools' });
  const body = h('div', { class: 'card-body' });
  const el = h(
    'section',
    { class: 'card', id, attrs: { 'aria-labelledby': `${id}-title` } },
    h('header', { class: 'card-head' }, h('h2', { id: `${id}-title`, attrs: { tabindex: -1 } }, title), tools, h('p', { class: 'card-cap' }, scopeEl, captionEl)),
    body,
  );
  return {
    el,
    body,
    tools,
    setScope: (text) => {
      scopeEl.textContent = text;
    },
    setCaption: (text) => {
      captionEl.textContent = text;
    },
  };
}

/** A "Show as table" switch on the card's title line: the chart and its table take turns. */
export function tableToggle(target: Card, chart: HTMLElement, table: HTMLElement): void {
  table.hidden = true;
  const toggle = button({ class: 'ghost', attrs: { 'aria-pressed': 'false' } }, 'Show as table');
  toggle.addEventListener('click', () => {
    const showTable = table.hidden;
    table.hidden = !showTable;
    chart.hidden = showTable;
    toggle.setAttribute('aria-pressed', String(showTable));
  });
  target.tools.append(toggle);
}

export interface LegendItem {
  /** The swatch's colour class: "s1" to "s8", "neutral", or a chart's own. */
  swatch: string;
  label: string;
  /** A figure after the name (the segmented bars list their counts here). */
  value?: string;
  /** Nothing of this kind in the selected range: the row is toned down. */
  none?: boolean;
}

export function legend(items: readonly LegendItem[], listed = false): HTMLUListElement {
  return h(
    'ul',
    { class: listed ? 'legend legend-list' : 'legend' },
    ...items.map((item) =>
      h(
        'li',
        { class: item.none ? 'is-none' : undefined },
        h('i', { class: `sw ${item.swatch}`, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'legend-name' }, item.label),
        item.value !== undefined ? h('span', { class: 'legend-value' }, item.value) : null,
      ),
    ),
  );
}

export function emptyNote(text: string): HTMLParagraphElement {
  return h('p', { class: 'empty' }, text);
}

/** A game's name as a button that lists its sessions in the table further down. */
export function gameButton(ctx: Ctx, name: string): HTMLButtonElement {
  return button({ class: 'pick', on: { click: () => ctx.showGame(name) } }, name, srOnly(': show its sessions'));
}

/** A search field that calls `onInput` with its text as the visitor types. */
export function searchBox(label: string, placeholder: string, onInput: (value: string) => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: 'search-input', attrs: { type: 'search', placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' } });
  input.addEventListener('input', () => onInput(input.value));
  return { el: h('div', { class: 'search' }, input), input };
}

/** An icon button on the card's title line that opens the card's full list (modal.ts). */
export function expandButton(target: Card, label: string, open: (opener: HTMLButtonElement) => void): HTMLButtonElement {
  const el = button({ class: 'ghost icon-btn', attrs: { 'aria-label': label, title: label, 'aria-haspopup': 'dialog' } }, icon('expand'));
  el.addEventListener('click', () => open(el));
  target.tools.append(el);
  return el;
}
