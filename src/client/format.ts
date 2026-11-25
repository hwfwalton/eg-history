// Text formatting for the history page: dates, "how long ago", ordinals and counts.
// Pure: nothing here touches the DOM, so it runs under vitest as it does in the browser.
//
// Dates arrive as "YYYY-MM-DD" in the schedule's own timezone. They are only ever read as UTC, so
// no visitor's timezone can move a session to the day before.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MS_PER_DAY = 86_400_000;

export interface DateParts {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
}

/** The parts of a "YYYY-MM-DD" string, or undefined when it isn't a real calendar date. */
export function parseDate(ymd: string): DateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls "2024-02-31" over into March; a real date comes back unchanged.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

/** Whole days since 1970-01-01 (UTC) for a "YYYY-MM-DD" string; NaN when it can't be read. */
export function dayNumber(ymd: string): number {
  const parts = parseDate(ymd);
  if (!parts) return Number.NaN;
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}

/** The "YYYY-MM-DD" string of a day number (the reverse of dayNumber). */
export function dateOfDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function weekdayName(parts: DateParts): string {
  return DAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()] ?? '';
}

function monthName(parts: DateParts): string {
  return MONTHS[parts.month - 1] ?? '';
}

/** "Sat, Nov 21, 2026". A string that isn't a date is returned as it is. */
export function formatDay(ymd: string): string {
  const parts = parseDate(ymd);
  if (!parts) return ymd;
  return `${weekdayName(parts)}, ${monthName(parts)} ${parts.day}, ${parts.year}`;
}

/** "Sat, Nov 28": for a date whose year is obvious (the next session). */
export function formatDayNoYear(ymd: string): string {
  const parts = parseDate(ymd);
  if (!parts) return ymd;
  return `${weekdayName(parts)}, ${monthName(parts)} ${parts.day}`;
}

/** "Nov 21, 2026" */
export function formatDate(ymd: string): string {
  const parts = parseDate(ymd);
  if (!parts) return ymd;
  return `${monthName(parts)} ${parts.day}, ${parts.year}`;
}

/** "Nov 2026" */
export function formatMonth(ymd: string): string {
  const parts = parseDate(ymd);
  if (!parts) return ymd;
  return `${monthName(parts)} ${parts.year}`;
}

/** "November 2026" */
export function formatMonthLong(ymd: string): string {
  const parts = parseDate(ymd);
  if (!parts) return ymd;
  return `${MONTHS_LONG[parts.month - 1] ?? ''} ${parts.year}`;
}

/** "Jan 7 – Dec 29, 2024", or "Jun 13, 2020 – Nov 21, 2026" when the years differ. */
export function formatSpan(from: string, to: string): string {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return [from, to].filter((part) => part !== '').join(' – ');
  if (from === to) return formatDate(from);
  if (a.year === b.year) return `${monthName(a)} ${a.day} – ${monthName(b)} ${b.day}, ${b.year}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

/** "Jun 2020 – Nov 2026", "Jan – Dec 2024", or "Aug 2026" when both ends are in the same month. */
export function formatMonthSpan(from: string, to: string): string {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return [from, to].filter((part) => part !== '').join(' – ');
  if (a.year === b.year && a.month === b.month) return formatMonth(to);
  if (a.year === b.year) return `${monthName(a)} – ${monthName(b)} ${b.year}`;
  return `${formatMonth(from)} – ${formatMonth(to)}`;
}

/**
 * "today", "3 days ago", "6 weeks ago", "16 months ago", "4 years ago" from a count of whole days.
 * Months run up to two years ("16 months ago" says more than "1 year ago").
 */
export function ago(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '';
  const whole = Math.floor(days);
  if (whole === 0) return 'today';
  if (whole === 1) return 'yesterday';
  if (whole < 14) return `${whole} days ago`;
  if (whole < 61) return `${Math.floor(whole / 7)} weeks ago`;
  const months = Math.floor(whole / 30.4375);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(whole / 365.25)} years ago`;
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd" */
export function ordinal(n: number): string {
  const whole = Math.trunc(n);
  const lastTwo = Math.abs(whole) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 13) return `${whole}th`;
  if (last === 1) return `${whole}st`;
  if (last === 2) return `${whole}nd`;
  if (last === 3) return `${whole}rd`;
  return `${whole}th`;
}

/** The marker beside a game in the sessions table: "new" the first time, "3rd" later, nothing when it isn't counted. */
export function playMarker(play: number): string {
  if (!Number.isFinite(play) || play < 1) return '';
  return play === 1 ? 'new' : ordinal(play);
}

/** "first time", "14th time" */
export function nthTime(play: number): string {
  if (!Number.isFinite(play) || play < 1) return '';
  return play === 1 ? 'first time' : `${ordinal(play)} time`;
}

/** 1284 -> "1,284" */
export function count(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 session", "271 sessions", "1 game", "23 games" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** A whole-number share: "72%", "<1%" for a sliver, "–" when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  if (!(whole > 0) || !Number.isFinite(part)) return '–';
  const share = (part / whole) * 100;
  if (share > 0 && share < 0.5) return '<1%';
  if (share < 100 && share > 99.5) return '>99%';
  return `${Math.round(share)}%`;
}

/** Joins the parts that aren't empty with " · ". */
export function dotted(...parts: (string | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' · ');
}
