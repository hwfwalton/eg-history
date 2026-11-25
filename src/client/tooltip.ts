// One tooltip for the whole page, shown on hover, on keyboard focus and on a tap. It only ever
// repeats what the page also shows without it (a label, a table, the legend).

import { h } from './dom.ts';
import type { Child } from './dom.ts';
import { movePoint } from './scale.ts';
import type { Move, Point } from './scale.ts';

let tip: HTMLDivElement | undefined;
/** What the tooltip belongs to, and (when it is pinned to an element instead of the pointer) that element. */
let owner: Element | undefined;
let anchor: Element | undefined;

const MARGIN = 8;
const GAP = 10;

function ensure(): HTMLDivElement {
  if (tip) return tip;
  // aria-hidden: it never says anything a label, a legend or a table doesn't.
  const el = h('div', { class: 'tip', attrs: { role: 'tooltip', 'aria-hidden': 'true' } });
  el.hidden = true;
  document.body.appendChild(el);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTip();
  });
  // Scrolling leaves a pointer tooltip behind; one pinned to a focused mark follows it.
  document.addEventListener(
    'scroll',
    () => {
      if (!anchor) hideTip();
      else placeAtAnchor();
    },
    { capture: true, passive: true },
  );
  // A tap elsewhere puts away a tooltip that a tap opened.
  document.addEventListener('pointerdown', (event) => {
    if (owner && event.target instanceof Node && !owner.contains(event.target)) hideTip();
  });
  tip = el;
  return el;
}

function place(x: number, top: number, bottom: number): void {
  const el = ensure();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const maxLeft = Math.max(MARGIN, document.documentElement.clientWidth - width - MARGIN);
  const left = Math.min(maxLeft, Math.max(MARGIN, x - width / 2));
  const above = top - GAP - height;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(above >= MARGIN ? above : bottom + GAP)}px`;
}

function placeAtAnchor(): void {
  if (!anchor) return;
  const box = anchor.getBoundingClientRect();
  // In a modal the list scrolls inside its own box: a mark scrolled out of that box is out of view too.
  const clip = anchor.closest('.modal-body')?.getBoundingClientRect();
  if (box.bottom < (clip?.top ?? 0) || box.top > (clip?.bottom ?? window.innerHeight)) {
    hideTip();
    return;
  }
  place(box.left + box.width / 2, box.top, box.bottom);
}

function fill(content: Node, forOwner: Element): HTMLDivElement {
  const el = ensure();
  el.replaceChildren(content);
  el.hidden = false;
  owner = forOwner;
  return el;
}

/** Shows the tooltip beside the pointer. */
export function tipAtPoint(content: Node, x: number, y: number, forOwner: Element): void {
  fill(content, forOwner);
  anchor = undefined;
  place(x, y - 4, y + 12);
}

/** Shows the tooltip above (or, with no room, below) an element. */
export function tipAtElement(content: Node, target: Element, forOwner: Element = target): void {
  fill(content, forOwner);
  anchor = target;
  placeAtAnchor();
}

/** Hides the tooltip; with an owner, only if it is that owner's tooltip. */
export function hideTip(ifOwner?: Element): void {
  if (!tip || (ifOwner && owner !== ifOwner)) return;
  tip.hidden = true;
  owner = undefined;
  anchor = undefined;
}

/**
 * Moves the tooltip into a modal dialog while it is open, or back to the page with null. A modal
 * dialog sits above everything else on the page, so a tooltip left outside it would be hidden behind it.
 */
export function tipHost(host: Element | null): void {
  const el = ensure();
  hideTip();
  (host ?? document.body).appendChild(el);
}

/**
 * Gives one element a tooltip: beside the pointer on hover, above the element on keyboard focus
 * (of `focusTarget`, by default the element itself) and on a tap.
 */
export function hoverTip(el: HTMLElement, content: () => Node | null, focusTarget: HTMLElement = el): void {
  const show = (event: PointerEvent): void => {
    const node = content();
    if (!node) return;
    if (event.pointerType === 'touch') tipAtElement(node, el);
    else tipAtPoint(node, event.clientX, event.clientY, el);
  };
  el.addEventListener('pointerenter', show);
  el.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') show(event);
  });
  el.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') hideTip(el);
  });
  focusTarget.addEventListener('focus', () => {
    if (!focusTarget.matches(':focus-visible')) return;
    const node = content();
    if (node) tipAtElement(node, el);
  });
  focusTarget.addEventListener('blur', () => hideTip(el));
}

const KEYS: Record<string, Move> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

export interface MarksOptions {
  /** The tooltip of one mark. */
  content: (mark: HTMLElement) => Node | null;
  /** Which mark the keyboard starts on. Default: the first. */
  start?: 'first' | 'last';
  /** Pointer handling: each mark is its own target (default), or `nearest` picks one from the pointer's position. */
  nearest?: (event: PointerEvent) => HTMLElement | null;
  /** Keep the tooltip above the mark instead of beside the pointer (for tall marks it would cover). */
  pin?: boolean;
}

/**
 * Makes a chart's marks (the elements with data-r and data-c: row and position) readable by
 * pointer and by keyboard. The chart is one tab stop; the arrow keys walk the marks, and the
 * tooltip follows.
 */
export function interactiveMarks(chart: HTMLElement, options: MarksOptions): void {
  let active: HTMLElement | null = null;
  // Marks in a hidden row (one a search filtered out) are skipped by the keyboard too.
  const marks = (): HTMLElement[] => Array.from(chart.querySelectorAll<HTMLElement>('[data-r][data-c]')).filter((mark) => !mark.closest('[hidden]'));
  const pointOf = (mark: HTMLElement): Point => ({ r: Number(mark.dataset['r']), c: Number(mark.dataset['c']) });

  const activate = (mark: HTMLElement | null, pin: boolean, event?: PointerEvent): void => {
    if (active !== mark) {
      active?.classList.remove('is-active');
      mark?.classList.add('is-active');
      active = mark;
    }
    if (!mark) {
      hideTip(chart);
      return;
    }
    const node = options.content(mark);
    if (!node) return;
    if (pin || !event) tipAtElement(node, mark, chart);
    else tipAtPoint(node, event.clientX, event.clientY, chart);
  };

  const fromPointer = (event: PointerEvent): HTMLElement | null => {
    if (options.nearest) return options.nearest(event);
    return event.target instanceof Element ? event.target.closest<HTMLElement>('[data-r][data-c]') : null;
  };
  // A row-wide target (`nearest`) pins the tooltip to the mark it found; a mark that is its own target lets it follow the pointer.
  const pinned = (event: PointerEvent): boolean => event.pointerType === 'touch' || options.nearest !== undefined || options.pin === true;

  chart.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') activate(fromPointer(event), pinned(event), event);
  });
  chart.addEventListener('pointerdown', (event) => activate(fromPointer(event), pinned(event), event));
  chart.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && !chart.matches(':focus-visible')) activate(null, false);
  });

  chart.tabIndex = 0;
  chart.addEventListener('focus', () => {
    if (!chart.matches(':focus-visible')) return;
    const all = marks();
    const start = active && chart.contains(active) ? active : options.start === 'last' ? all.at(-1) : all[0];
    activate(start ?? null, true);
  });
  chart.addEventListener('blur', () => activate(null, false));
  chart.addEventListener('keydown', (event) => {
    // Keys pressed on a button inside the chart belong to that button.
    if (event.target !== chart) return;
    const move = Object.hasOwn(KEYS, event.key) ? KEYS[event.key] : undefined;
    if (!move) return;
    const all = marks();
    const current = active ? all.indexOf(active) : -1;
    const next = all[current === -1 ? 0 : movePoint(all.map(pointOf), current, move)];
    if (!next) return;
    event.preventDefault();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    activate(next, true);
  });
}

/** The inside of a tooltip: a title, then rows with the value first (strong) and what it is after it. */
export function tipCard(title: string, rows: readonly (readonly [value: string, label?: string, swatch?: string])[], foot?: string): HTMLElement {
  const lines: Child[] = rows.map(([value, label, swatch]) =>
    h(
      'div',
      { class: 'tip-row' },
      swatch ? h('span', { class: `key ${swatch}` }) : null,
      h('strong', null, value),
      label ? h('span', null, ` ${label}`) : null,
    ),
  );
  return h('div', null, title ? h('div', { class: 'tip-title' }, title) : null, ...lines, foot ? h('div', { class: 'tip-foot' }, foot) : null);
}
