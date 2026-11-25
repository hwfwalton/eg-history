// The full list behind a card, in a modal dialog with a search: every game instead of the card's
// top few. A native <dialog>: it keeps the keyboard inside, closes on Escape, and puts the page
// behind it out of reach of screen readers.

import type { Slice } from '../types.ts';
import type { Ctx } from './card.ts';
import { searchBox } from './card.ts';
import { matchesGameName } from './data.ts';
import { button, h, icon } from './dom.ts';
import { shownOf } from './format.ts';
import { rangeChips } from './page.ts';
import { hideTip, tipHost } from './tooltip.ts';

const TITLE_ID = 'modal-title';

/** One game of the list, and the element (a row) the search shows or hides. */
export interface ModalItem {
  name: string;
  el: HTMLElement;
}

export interface ModalContent {
  el: HTMLElement;
  items: readonly ModalItem[];
  /**
   * Shows another range without drawing the list again (it keeps its scroll position). Without it,
   * the modal builds the list again for the new range.
   */
  update?: (slice: Slice) => void;
}

export interface ModalOptions {
  title: string;
  /** The range the modal opens on: the one selected on the page. */
  slice: Slice;
  /**
   * The ranges to choose from in the modal's own range filter, left out for no filter. Picking one
   * changes the modal only, never the range selected on the page.
   */
  slices?: readonly Slice[];
  /** Which sessions it counts, like a card's scope ("2024", "Whole record"). */
  scope: (slice: Slice) => string;
  caption: string;
  /**
   * Draws the list for a range. The Ctx it gets closes the modal before going elsewhere on the page
   * (a game's name opens its sessions in the table further down).
   */
  build: (ctx: Ctx, slice: Slice) => ModalContent;
  /** Gets the focus back when the modal closes. */
  opener?: HTMLElement;
}

/** Opens a modal listing games, with a search that filters the rows by name, style, mode or tag. */
export function openGamesModal(ctx: Ctx, options: ModalOptions): void {
  hideTip();
  let returnFocus = true;
  let slice = options.slice;
  const dialog = h('dialog', { class: 'modal', attrs: { 'aria-labelledby': TITLE_ID } });

  const leave = (go: () => void): void => {
    returnFocus = false;
    dialog.close();
    go();
  };
  const inner: Ctx = {
    ...ctx,
    showGame: (name) => leave(() => ctx.showGame(name)),
    showStyle: (style) => leave(() => ctx.showStyle(style)),
    showEverything: () => leave(() => ctx.showEverything()),
  };
  let content = options.build(inner, slice);

  const scope = h('span', { class: 'scope' }, options.scope(slice));
  const total = h('p', { class: 'count', attrs: { role: 'status' } });
  const none = h('p', { class: 'empty' });
  const body = h('div', { class: 'modal-body' }, content.el, none);
  const filter = (query: string): void => {
    hideTip();
    let shown = 0;
    for (const item of content.items) {
      const match = matchesGameName(item.name, ctx.game(item.name), query);
      item.el.hidden = !match;
      if (match) shown += 1;
    }
    total.textContent = shownOf(shown, content.items.length, 'game');
    content.el.hidden = shown === 0;
    none.hidden = shown > 0;
    none.textContent = content.items.length === 0 ? 'No games played in this range.' : 'No games match.';
  };
  const search = searchBox('Search games', 'Search game, style, mode or tag', filter);
  const close = button({ class: 'ghost icon-btn', attrs: { 'aria-label': 'Close', title: 'Close' } }, icon('close'));
  close.addEventListener('click', () => dialog.close());

  const ranges = options.slices
    ? rangeChips(options.slices, (key) => {
        const next = options.slices?.find((candidate) => candidate.key === key);
        if (!next || next === slice) return;
        slice = next;
        showRange();
      })
    : undefined;
  const showRange = (): void => {
    hideTip();
    ranges?.select(slice);
    scope.textContent = options.scope(slice);
    if (content.update) content.update(slice);
    else {
      content = options.build(inner, slice);
      body.replaceChildren(content.el, none);
      body.scrollTop = 0;
    }
    filter(search.input.value);
  };

  dialog.append(
    h(
      'div',
      { class: 'modal-in' },
      h(
        'header',
        { class: 'modal-head' },
        h('div', null, h('h2', { id: TITLE_ID }, options.title), h('p', { class: 'card-cap' }, scope, h('span', null, options.caption))),
        close,
      ),
      ranges ? h('div', { class: 'modal-range' }, ranges.el) : null,
      h('div', { class: 'toolbar' }, search.el, total),
      body,
    ),
  );
  filter('');

  // The dialog's own box is only ever hit outside its content: on the dimmed page around it. A click
  // that starts there and ends there closes the modal. One that only ends there (a text selection
  // dragged out of the search box) is sent to the dialog too, and doesn't.
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressedOutside = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (pressedOutside && event.target === dialog) dialog.close();
    pressedOutside = false;
  });
  dialog.addEventListener('close', () => {
    hideTip();
    tipHost(null);
    dialog.remove();
    if (returnFocus) options.opener?.focus();
  });

  document.body.append(dialog);
  tipHost(dialog);
  dialog.showModal();
  // Marked once it is on screen: on a phone the selected chip is scrolled into the row's view.
  ranges?.select(slice);
  // With a mouse, straight to the search. On a phone that would open the keyboard over the list.
  if (window.matchMedia('(pointer: fine)').matches) search.input.focus();
}
