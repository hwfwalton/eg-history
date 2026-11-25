// The full list behind a card, in a modal dialog with a search: every game instead of the card's
// top few. A native <dialog>: it keeps the keyboard inside, closes on Escape, and puts the page
// behind it out of reach of screen readers.

import type { Ctx } from './card.ts';
import { searchBox } from './card.ts';
import { matchesGameName } from './data.ts';
import { button, h, icon } from './dom.ts';
import { shownOf } from './format.ts';
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
}

export interface ModalOptions {
  title: string;
  /** Which sessions it counts, like a card's scope ("2024", "Whole record"). */
  scope: string;
  caption: string;
  /**
   * Draws the list. The Ctx it gets closes the modal before going elsewhere on the page (a game's
   * name opens its sessions in the table further down).
   */
  build: (ctx: Ctx) => ModalContent;
  /** Gets the focus back when the modal closes. */
  opener?: HTMLElement;
}

/** Opens a modal listing games, with a search that filters the rows by name, style, mode or tag. */
export function openGamesModal(ctx: Ctx, options: ModalOptions): void {
  hideTip();
  let returnFocus = true;
  const dialog = h('dialog', { class: 'modal', attrs: { 'aria-labelledby': TITLE_ID } });

  const leave = (go: () => void): void => {
    returnFocus = false;
    dialog.close();
    go();
  };
  const content = options.build({
    ...ctx,
    showGame: (name) => leave(() => ctx.showGame(name)),
    showStyle: (style) => leave(() => ctx.showStyle(style)),
    showEverything: () => leave(() => ctx.showEverything()),
  });

  const total = h('p', { class: 'count', attrs: { role: 'status' } });
  const none = h('p', { class: 'empty' }, 'No games match.');
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
  };
  const search = searchBox('Search games', 'Search game, style, mode or tag', filter);
  const close = button({ class: 'ghost icon-btn', attrs: { 'aria-label': 'Close', title: 'Close' } }, icon('close'));
  close.addEventListener('click', () => dialog.close());

  dialog.append(
    h(
      'div',
      { class: 'modal-in' },
      h(
        'header',
        { class: 'modal-head' },
        h('div', null, h('h2', { id: TITLE_ID }, options.title), h('p', { class: 'card-cap' }, h('span', { class: 'scope' }, options.scope), h('span', null, options.caption))),
        close,
      ),
      h('div', { class: 'toolbar' }, search.el, total),
      h('div', { class: 'modal-body' }, content.el, none),
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
  // With a mouse, straight to the search. On a phone that would open the keyboard over the list.
  if (window.matchMedia('(pointer: fine)').matches) search.input.focus();
}
