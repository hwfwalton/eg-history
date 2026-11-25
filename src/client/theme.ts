// Light or dark: the system's setting unless the visitor picks one. The choice is a data-theme
// attribute on <html> (styles.css does the rest), remembered in localStorage. "?theme=dark" in the
// address wins for that visit and is not remembered.

import { button, h } from './dom.ts';

export type Theme = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'history-theme';
const CHOICES: readonly { theme: Theme; label: string }[] = [
  { theme: 'auto', label: 'Auto' },
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
];

function fixedTheme(value: string | null): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

function stored(): Theme {
  try {
    return fixedTheme(localStorage.getItem(STORAGE_KEY)) ?? 'auto';
  } catch {
    // Storage can be switched off; then the system's setting applies.
    return 'auto';
  }
}

function remember(theme: Theme): void {
  try {
    if (theme === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still holds until the page is closed.
  }
}

function fromAddress(): Theme | undefined {
  return fixedTheme(new URLSearchParams(location.search).get('theme'));
}

/** A choice made on the page replaces the one in the address, or the address would win again on reload. */
function dropFromAddress(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('theme')) return;
    url.searchParams.delete('theme');
    history.replaceState(history.state, '', url);
  } catch {
    // The address stays as it is.
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Applies the theme for this visit and returns it. */
export function initTheme(): Theme {
  const forced = fromAddress();
  // A theme in the address is how the page is photographed, and headless Chrome's screenshot of a
  // scrolled document comes out blank. So such a visit scrolls inside a full-height frame instead
  // (styles.css, "html.framed"), which it can capture. It looks and behaves the same.
  document.documentElement.classList.toggle('framed', forced !== undefined);
  const theme = forced ?? stored();
  apply(theme);
  return theme;
}

/** The Auto / Light / Dark buttons. */
export function themeControl(current: Theme): HTMLElement {
  const buttons = CHOICES.map(({ theme, label }) => {
    const el = button({ class: 'seg-btn', attrs: { 'aria-pressed': String(theme === current) } }, label);
    el.addEventListener('click', () => {
      apply(theme);
      remember(theme);
      dropFromAddress();
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === el));
    });
    return el;
  });
  return h('div', { class: 'seg-ctl', attrs: { role: 'group', 'aria-label': 'Colour theme' } }, ...buttons);
}
