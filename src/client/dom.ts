// A tiny element builder. Everything that comes from the data goes in as a text node or as the
// value of an attribute named here in the code: there is no innerHTML anywhere on the page.

export type Child = Node | string | number | false | null | undefined;

export interface Props {
  class?: string;
  id?: string;
  /** Attributes by name. `undefined` and `false` leave the attribute out; `true` sets it empty. */
  attrs?: Record<string, string | number | boolean | undefined>;
  /** CSS custom properties, set through the style object (the page's CSP has no inline styles). */
  vars?: Record<string, string | number>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.id) el.id = props.id;
    for (const [name, value] of Object.entries(props.attrs ?? {})) {
      // Never an inline style or an event handler, whatever a caller passes.
      if (value === undefined || value === false || name === 'style' || name.startsWith('on')) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
    for (const [name, value] of Object.entries(props.vars ?? {})) el.style.setProperty(name, String(value));
    for (const [type, listener] of Object.entries(props.on ?? {})) el.addEventListener(type, listener as EventListener);
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Text that only screen readers get. */
export function srOnly(text: string): HTMLSpanElement {
  return h('span', { class: 'sr-only' }, text);
}

/** A button that isn't a form's submit button. */
export function button(props: Props | null, ...children: Child[]): HTMLButtonElement {
  return h('button', { ...props, attrs: { type: 'button', ...props?.attrs } }, ...children);
}

/** A <time> for a "YYYY-MM-DD" date, shown as `label`. */
export function time(ymd: string, label: string): HTMLTimeElement {
  return h('time', { attrs: { datetime: ymd } }, label);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The page's few icons, as stroked paths on a 24-unit grid. */
const ICONS = {
  /** Two arrows out to the corners: open the full view. */
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
} as const;

export type IconName = keyof typeof ICONS;

/** An icon drawn in the text colour. Decorative: the button it sits in carries the label. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
