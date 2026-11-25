// Kept identical to src/features/history/record.ts in eg-discord-bot, which writes these files.
//
// Reads and writes the record's two CSV files, sessions.csv and games.csv. Pure functions: the
// caller reads and writes the files.
//
// The owner edits both files by hand, usually in a spreadsheet app, so reading is forgiving
// (columns in any order, older header names, dates the spreadsheet rewrote) and problems become
// notes for the page instead of errors. The bot only ever adds rows at the end (appendSessions,
// appendGames) and leaves every existing character alone.
import { type DataNote, type GameInfo, SESSION_STATUSES, type SessionRow, type SessionStatus } from './types.ts';

export interface ParsedFile<T> {
  rows: T[];
  notes: DataNote[];
}

// ---------------------------------------------------------------------------------------------
// CSV text
// ---------------------------------------------------------------------------------------------

const BOM = '\uFEFF';

interface CsvRow {
  cells: string[];
  /** The 1-based line of the file the row starts on. */
  line: number;
}

interface CsvFile {
  rows: CsvRow[];
  /** The line a quote opens on when it is never closed (the rest of the file is then one cell). */
  unclosedQuoteLine?: number;
}

/** parseCsv, plus where each row is in the file, for notes that point at a line. */
function readCsv(text: string): CsvFile {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ cells, line: rowLine });
    cells = [];
    cell = '';
  };

  for (let i = text.startsWith(BOM) ? 1 : 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === '\r' || char === '\n') {
      // CRLF is one line break. Inside quotes a line break is part of the cell, but still a new line.
      const lineBreak = char === '\r' && text.charAt(i + 1) === '\n' ? '\r\n' : char;
      i += lineBreak.length - 1;
      line++;
      if (quoted) cell += lineBreak;
      else {
        endRow();
        rowLine = line;
      }
    } else if (quoted) {
      if (char !== '"') cell += char;
      else if (text.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && cell === '') {
      // A quote only opens a quoted cell at the cell's start: 5" disk is plain text.
      quoted = true;
      quoteLine = line;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  endRow();
  return { rows, ...(quoted && { unclosedQuoteLine: quoteLine }) };
}

/**
 * Reads CSV text (RFC 4180) into rows of cells. Cells keep their whitespace; rows with nothing in
 * them (blank lines, or only commas and spaces) are dropped.
 */
export function parseCsv(text: string): string[][] {
  return readCsv(text).rows.map((row) => row.cells);
}

// Leading or trailing whitespace is quoted too, because some apps trim unquoted cells.
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function formatCell(cell: string): string {
  return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function formatCsv(rows: string[][], eol: '\n' | '\r\n' = '\n'): string {
  return rows.map((row) => row.map(formatCell).join(',') + eol).join('');
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

interface Column<F> {
  field: F;
  /** The header the bot writes. */
  header: string;
  /** Other headers for the same column, so older exports still load. */
  alsoCalled?: string[];
  /** Any header that starts with `header` counts, e.g. "Start (PT)". */
  prefix?: boolean;
}

// Both lists are in the canonical column order.
const SESSION_COLUMNS: Column<keyof SessionRow>[] = [
  { field: 'session', header: 'Session', alsoCalled: ['EG'] },
  { field: 'date', header: 'Date' },
  { field: 'start', header: 'Start', prefix: true },
  { field: 'status', header: 'Status' },
  { field: 'games', header: 'Games', alsoCalled: ['Game(s) played', 'Game(s)'] },
  { field: 'planned', header: 'Planned', alsoCalled: ['Planned instead'] },
  { field: 'cost', header: 'Cost', prefix: true },
  { field: 'announcedBy', header: 'Announced by' },
  { field: 'source', header: 'Source' },
  { field: 'notes', header: 'Notes' },
];

const GAME_COLUMNS: Column<keyof GameInfo>[] = [
  { field: 'name', header: 'Game', alsoCalled: ['Name'] },
  { field: 'style', header: 'Style' },
  { field: 'mode', header: 'Mode', alsoCalled: ['Co-op or competitive'] },
  { field: 'where', header: 'Where' },
  { field: 'link', header: 'Link', alsoCalled: ['Steam link'] },
  { field: 'tags', header: 'Tags', alsoCalled: ['Steam tags'] },
  { field: 'developer', header: 'Developer' },
];

/** How headers and statuses are compared: ignoring case and stray spaces. */
function key(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fieldFor<F>(columns: Column<F>[], header: string): F | undefined {
  const name = key(header);
  const column = columns.find(
    (c) =>
      [c.header, ...(c.alsoCalled ?? [])].some((known) => key(known) === name) ||
      (c.prefix === true && name.startsWith(key(c.header))),
  );
  return column?.field;
}

/**
 * The field each column of a header row holds. Undefined for a column the code doesn't know, and
 * for a second column of the same field (the first one is the one that's read).
 */
function readHeader<F>(columns: Column<F>[], header: string[]): (F | undefined)[] {
  const seen = new Set<F>();
  return header.map((cell) => {
    const field = fieldFor(columns, cell);
    if (field === undefined || seen.has(field)) return undefined;
    seen.add(field);
    return field;
  });
}

// A spreadsheet app runs a cell that starts with = + - or @ as a formula, and the bot writes text
// from Discord (a game's name, the announcer's name) into files the owner opens in one. So a cell
// the bot writes that starts that way gets an apostrophe in front, which makes it plain text
// there, and reading takes that apostrophe off again: '=1+1 in the file is =1+1 on the page.
// Cells the owner typed are never rewritten. One that starts '= '+ '- or '@ loses its apostrophe
// when read, the price of bot-written cells coming back exactly as they were.
const FORMULA_START = /^'*[=+\-@]/;
const GUARDED_FORMULA = /^'+[=+\-@]/;

/** A cell as it's written. Some apps skip a tab or line break before the sign, so that goes too (reading trims). */
function guardFormula(cell: string): string {
  const text = cell.trimStart();
  return FORMULA_START.test(text) ? `'${text}` : cell;
}

function unguardFormula(cell: string): string {
  return GUARDED_FORMULA.test(cell) ? cell.slice(1) : cell;
}

/** Looks up a row's cells by field: trimmed, and '' when the file has no such column. */
function cellReader<F>(fields: (F | undefined)[], cells: string[]): (field: F) => string {
  return (field) => {
    const index = fields.indexOf(field);
    return index < 0 ? '' : unguardFormula((cells[index] ?? '').trim());
  };
}

function splitList(cell: string, separator: string): string[] {
  return cell
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

// A file a spreadsheet mangled can have a problem on every row; the page only needs the gist.
const MAX_ROW_NOTES = 20;

function warning(text: string): DataNote {
  return { kind: 'warning', text };
}

/** A cell's text inside a note: on one line, and cut short if someone pasted a paragraph. */
function quote(value: string): string {
  const flat = value.replace(/\s+/g, ' ');
  if (flat.length <= 80) return `"${flat}"`;
  // Not through the middle of an emoji (two UTF-16 units): half of one is not a character.
  const cut = /[\uD800-\uDBFF]/.test(flat.charAt(79)) ? 79 : 80;
  return `"${flat.slice(0, cut)}…"`;
}

function capNotes(problems: DataNote[], others: (count: number) => string): DataNote[] {
  const extra = problems.length - MAX_ROW_NOTES;
  return extra > 0 ? [...problems.slice(0, MAX_ROW_NOTES), warning(others(extra))] : problems;
}

function unclosedQuoteNotes(file: string, csv: CsvFile): DataNote[] {
  if (csv.unclosedQuoteLine === undefined) return [];
  return [
    warning(
      `${file} line ${csv.unclosedQuoteLine}: a quote (") opens on this line and is never closed, ` +
        'so everything after it was read as one cell.',
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// sessions.csv
// ---------------------------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/;

/**
 * Reads a date cell as YYYY-MM-DD, or undefined if it isn't a date.
 *
 * Spreadsheet apps rewrite date cells when they save a CSV (2031-03-09 comes back as 3/9/2031 or
 * 3/9/31), and the owner edits these files in one. So the US forms are accepted too: month first,
 * and a two-digit year means 20YY.
 */
export function parseDate(raw: string): string | undefined {
  const text = raw.trim();
  const iso = text.match(ISO_DATE);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[3]), Number(iso[4]));
  const us = text.match(US_DATE);
  if (us) return calendarDate(Number(us[3]) + (us[3]?.length === 2 ? 2000 : 0), Number(us[1]), Number(us[2]));
  return undefined;
}

/** YYYY-MM-DD, if that day exists in the calendar (no Feb 30). */
function calendarDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const STATUS_SPELLINGS = new Map<string, SessionStatus>([
  ...SESSION_STATUSES.map((status): [string, SessionStatus] => [key(status), status]),
  ['no eg', 'No session'],
  ['off', 'No session'],
  ['skipped', 'No session'],
  ['canceled', 'Cancelled'],
]);

/** A blank status is filled in: a row that names a session or a game was played, otherwise it was an off week. */
function readStatus(raw: string, namesSomething: boolean): SessionStatus | undefined {
  if (raw === '') return namesSomething ? 'Played' : 'No session';
  return STATUS_SPELLINGS.get(key(raw));
}

/**
 * Reads sessions.csv. Rows come back oldest first (rows with the same date keep their file order).
 * A row whose date or status can't be read is skipped, with a note that names its line.
 */
export function parseSessions(text: string): ParsedFile<SessionRow> {
  const csv = readCsv(text);
  const notes = unclosedQuoteNotes('sessions.csv', csv);
  const [header, ...lines] = csv.rows;
  if (!header) return { rows: [], notes };
  const fields = readHeader(SESSION_COLUMNS, header.cells);
  if (!fields.includes('date')) {
    return { rows: [], notes: [...notes, warning('sessions.csv has no "Date" column, so no sessions were read.')] };
  }

  const rows: SessionRow[] = [];
  const skipped: DataNote[] = [];
  for (const { cells, line } of lines) {
    const cell = cellReader(fields, cells);
    const skip = (problem: string) => {
      skipped.push(warning(`sessions.csv line ${line}: ${problem}, so this row was skipped.`));
    };

    const date = parseDate(cell('date'));
    if (!date) {
      skip(cell('date') === '' ? 'there is no date' : `can't read the date ${quote(cell('date'))}`);
      continue;
    }
    const session = cell('session');
    const games = [...new Set(splitList(cell('games'), ';'))];
    const status = readStatus(cell('status'), session !== '' || games.length > 0);
    if (!status) {
      skip(`can't read the status ${quote(cell('status'))}`);
      continue;
    }
    const start = cell('start');
    const cost = cell('cost');
    const announcedBy = cell('announcedBy');
    const source = cell('source');
    const rowNotes = cell('notes');
    // An empty cell leaves its property out.
    rows.push({
      ...(session && { session }),
      date,
      ...(start && { start }),
      status,
      games,
      planned: [...new Set(splitList(cell('planned'), ';'))],
      ...(cost && { cost }),
      ...(announcedBy && { announcedBy }),
      ...(source && { source }),
      ...(rowNotes && { notes: rowNotes }),
    });
  }

  // Array.prototype.sort is stable, so same-date rows stay in file order.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const others = (count: number) =>
    `sessions.csv: ${count} more ${count === 1 ? 'row was' : 'rows were'} skipped for the same kinds of problem.`;
  return { rows, notes: [...notes, ...capNotes(skipped, others)] };
}

function sessionCells(row: SessionRow): Record<keyof SessionRow, string> {
  return {
    session: row.session ?? '',
    date: row.date,
    start: row.start ?? '',
    status: row.status,
    games: row.games.join('; '),
    planned: row.planned.join('; '),
    cost: row.cost ?? '',
    announcedBy: row.announcedBy ?? '',
    source: row.source ?? '',
    notes: row.notes ?? '',
  };
}

/**
 * A whole sessions.csv under the canonical header:
 * Session,Date,Start,Status,Games,Planned,Cost,Announced by,Source,Notes
 */
export function sessionsToCsv(rows: SessionRow[]): string {
  return formatCsv(canonicalTable(SESSION_COLUMNS, rows.map(sessionCells)));
}

/**
 * Adds rows to the end of sessions.csv, in the file's own column order and line ending, without
 * changing anything that's already there. An empty file gets the canonical header first.
 */
export function appendSessions(text: string, rows: SessionRow[]): string {
  return appendRecords(text, SESSION_COLUMNS, 'date', rows.map(sessionCells));
}

// ---------------------------------------------------------------------------------------------
// games.csv
// ---------------------------------------------------------------------------------------------

/** Only http(s) links may reach the page: a "javascript:" link would run when it's clicked. */
function isWebLink(link: string): boolean {
  if (!URL.canParse(link)) return false;
  const { protocol } = new URL(link);
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Reads games.csv, in file order. A game listed twice keeps its first row, and a link that isn't
 * http(s) is left out; both get a note that names the line.
 */
export function parseGames(text: string): ParsedFile<GameInfo> {
  const csv = readCsv(text);
  const notes = unclosedQuoteNotes('games.csv', csv);
  const [header, ...lines] = csv.rows;
  if (!header) return { rows: [], notes };
  const fields = readHeader(GAME_COLUMNS, header.cells);
  if (!fields.includes('name')) {
    return { rows: [], notes: [...notes, warning('games.csv has no "Game" column, so no games were read.')] };
  }

  const rows: GameInfo[] = [];
  const problems: DataNote[] = [];
  const firstLine = new Map<string, number>();
  for (const { cells, line } of lines) {
    const cell = cellReader(fields, cells);
    const problem = (what: string) => {
      problems.push(warning(`games.csv line ${line}: ${what}`));
    };

    const name = cell('name');
    if (name === '') continue;
    const listedOn = firstLine.get(name.toLowerCase());
    if (listedOn !== undefined) {
      problem(`${quote(name)} is already listed on line ${listedOn}, so this second row was ignored.`);
      continue;
    }
    firstLine.set(name.toLowerCase(), line);

    const style = cell('style');
    const mode = cell('mode');
    const where = cell('where');
    const developer = cell('developer');
    const link = cell('link');
    const linkOk = link !== '' && isWebLink(link);
    if (link !== '' && !linkOk) {
      problem(`can't use the link ${quote(link)} (it isn't an http or https address), so it was left out.`);
    }
    rows.push({
      name,
      ...(style && { style }),
      ...(mode && { mode }),
      ...(where && { where }),
      ...(linkOk && { link }),
      tags: splitList(cell('tags'), ','),
      ...(developer && { developer }),
    });
  }

  const others = (count: number) =>
    `games.csv: ${count} more ${count === 1 ? 'row has a problem' : 'rows have problems'} like these.`;
  return { rows, notes: [...notes, ...capNotes(problems, others)] };
}

function gameCells(game: GameInfo): Record<keyof GameInfo, string> {
  return {
    name: game.name,
    style: game.style ?? '',
    mode: game.mode ?? '',
    where: game.where ?? '',
    link: game.link ?? '',
    tags: game.tags.join(', '),
    developer: game.developer ?? '',
  };
}

/** A whole games.csv under the canonical header: Game,Style,Mode,Where,Link,Tags,Developer */
export function gamesToCsv(games: GameInfo[]): string {
  return formatCsv(canonicalTable(GAME_COLUMNS, games.map(gameCells)));
}

/** Like appendSessions, for games.csv. */
export function appendGames(text: string, games: GameInfo[]): string {
  return appendRecords(text, GAME_COLUMNS, 'name', games.map(gameCells));
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** One CSV row per record, with a cell for each column. A column the code doesn't know stays empty. */
function layOut<F extends string>(fields: (F | undefined)[], records: Record<F, string>[]): string[][] {
  return records.map((record) => fields.map((field) => (field === undefined ? '' : guardFormula(record[field]))));
}

function canonicalTable<F extends string>(columns: Column<F>[], records: Record<F, string>[]): string[][] {
  return [columns.map((c) => c.header), ...layOut(columns.map((c) => c.field), records)];
}

/** The file's own line ending, going by its first line break. */
function lineEndingOf(text: string): '\n' | '\r\n' {
  return /^[^\r\n]*\r\n/.test(text) ? '\r\n' : '\n';
}

function appendRecords<F extends string>(
  text: string,
  columns: Column<F>[],
  required: F,
  records: Record<F, string>[],
): string {
  if (records.length === 0) return text;
  const csv = readCsv(text);
  const header = csv.rows[0];
  const fields = header ? readHeader(columns, header.cells) : columns.map((c) => c.field);
  // Leave the file alone if the new rows couldn't be read back from it (an unclosed quote would
  // swallow them; so would a header without the one column every row needs). Otherwise the bot
  // would never see its own rows and add them again on every run.
  if (csv.unclosedQuoteLine !== undefined || !fields.includes(required)) return text;

  const eol = lineEndingOf(text);
  const rows = layOut(fields, records);
  if (!header) rows.unshift(columns.map((c) => c.header));
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const gap = body === '' || /[\r\n]$/.test(body) ? '' : eol;
  return text + gap + formatCsv(rows, eol);
}
