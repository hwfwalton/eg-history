// next.json: the upcoming session, written by the bot (eg-discord-bot) from #announcements and the
// game night schedule. Its shape is NextSession plus `updatedAt`:
//
//   { "updatedAt": "2026-11-25T19:00:00.000Z", "date": "2026-11-28", "start": "10:30am",
//     "status": "announced", "session": "EG290", "games": ["Spellsworn"] }
//
// The file is optional (game night may be off, or the bot not running yet), so anything wrong with
// it just means there is no next session to show: never an error on the page.
import type { NextSession } from './types.ts';

export const NEXT_FILE = 'next.json';

const STATUSES: readonly NextSession['status'][] = ['announced', 'cancelled', 'unannounced'];

/**
 * The upcoming session in next.json's text, or undefined if the text isn't a valid one or its date
 * is before `today` (a file the bot stopped updating mustn't announce a session that is over).
 */
export function parseNext(text: string, today: string): NextSession | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { date, start, status, session, games } = value as Record<string, unknown>;

  if (typeof date !== 'string' || !isDate(date) || date < today) return undefined;
  if (typeof start !== 'string') return undefined;
  if (typeof status !== 'string' || !STATUSES.includes(status as NextSession['status'])) return undefined;
  if (session !== undefined && typeof session !== 'string') return undefined;
  if (!Array.isArray(games) || !games.every((game) => typeof game === 'string')) return undefined;

  const label = session?.trim();
  return {
    date,
    start: start.trim(),
    status: status as NextSession['status'],
    ...(label && { session: label }),
    // Games only mean something for an announced session.
    games: status === 'announced' ? games.map((game: string) => game.trim()).filter(Boolean) : [],
  };
}

/** A real calendar date written YYYY-MM-DD (not 2026-02-30). */
function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
}
