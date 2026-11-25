// The record on disk and the data the page shows.
//
// The record is a folder of files the site only reads: sessions.csv and games.csv (record.ts),
// which the owner can edit by hand and the bot appends each new week to, and next.json (next.ts),
// the upcoming session as the bot last saw it. What is computed from them is reused for a short
// while, so a busy page doesn't re-read the files on every request.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NEXT_FILE, parseNext } from './next.ts';
import { parseGames, parseSessions } from './record.ts';
import { buildHistory } from './stats.ts';
import { localDate, timezoneLabel } from './time.ts';
import type { DataNote, HistoryData, NextSession } from './types.ts';

export const SESSIONS_FILE = 'sessions.csv';
export const GAMES_FILE = 'games.csv';

export interface HistoryStoreOptions {
  /** Folder holding sessions.csv, games.csv and next.json. */
  dir: string;
  title: string;
  /** IANA timezone of the schedule: decides what "today" is. */
  timezone: string;
  /** How long computed data is reused before the files are read again. */
  maxAgeMs?: number;
  now?: () => Date;
}

export interface HistoryStore {
  getData(): Promise<HistoryData>;
  /** Forget what was computed, so the next request reads the files again. */
  invalidate(): void;
}

export function createHistoryStore(options: HistoryStoreOptions): HistoryStore {
  const { dir, title, timezone } = options;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const now = options.now ?? (() => new Date());

  let cached: { data: Promise<HistoryData>; at: number } | undefined;

  async function compute(): Promise<HistoryData> {
    const at = now();
    const notes: DataNote[] = [];
    const sessionsText = await readText(join(dir, SESSIONS_FILE));
    const gamesText = await readText(join(dir, GAMES_FILE));
    if (sessionsText === undefined) {
      notes.push({ kind: 'info', text: `There is no ${SESSIONS_FILE} in the history folder yet.` });
    }
    const parsedSessions = parseSessions(sessionsText ?? '');
    const parsedGames = parseGames(gamesText ?? '');
    notes.push(...parsedSessions.notes, ...parsedGames.notes);

    const today = localDate(at, timezone);
    // Most likely a typo in the year: the row is still shown, in date order.
    const future = parsedSessions.rows.filter((row) => row.date > today);
    if (future.length > 0) {
      notes.push({
        kind: 'warning',
        text: `${SESSIONS_FILE} has ${future.length === 1 ? 'a row' : `${future.length} rows`} dated after today (${future[0]?.date}). Check the year.`,
      });
    }
    const next = await readNext(join(dir, NEXT_FILE), today);

    return buildHistory({
      title,
      now: at,
      today,
      timezone: timezoneLabel(timezone, at),
      sessions: parsedSessions.rows,
      games: parsedGames.rows,
      notes,
      ...(next && { next }),
    });
  }

  return {
    getData() {
      const at = now().getTime();
      if (!cached || at - cached.at >= maxAgeMs) {
        const data = compute();
        cached = { data, at };
        // A failed load isn't kept: the next request tries again.
        data.catch(() => {
          if (cached?.data === data) cached = undefined;
        });
      }
      return cached.data;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

/** The file's text, or undefined when it doesn't exist. Any other problem (no permission) is an error. */
async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return undefined;
  }
}

/** next.json is optional: whatever is wrong with it, there is just no next session to show. */
async function readNext(path: string, today: string): Promise<NextSession | undefined> {
  try {
    return parseNext(await readFile(path, 'utf8'), today);
  } catch {
    return undefined;
  }
}
