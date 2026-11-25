import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEXT_FILE } from './next.ts';
import { GAMES_FILE, SESSIONS_FILE, createHistoryStore, type HistoryStoreOptions } from './store.ts';

const TIMEZONE = 'America/Los_Angeles';

const HEADER = 'Session,Date,Start,Status,Games,Planned,Cost,Announced by,Source,Notes';
const RECORD = `${HEADER}
EG1,2031-01-04,10:30am,Played,Duck Game,,Free,Robin,#announcements,
EG2,2031-01-11,10:30am,Played,Duck Game,,Free,Robin,#announcements,
`;
const GAMES = `Game,Style,Mode,Where,Link,Tags,Developer
Duck Game,2D platform fighter,Competitive,Steam,https://store.steampowered.com/app/312530/,"Multiplayer, Funny",Landon Podbielski
`;
const NEXT = {
  updatedAt: '2031-01-20T19:00:00.000Z',
  date: '2031-01-25',
  start: '10:30am',
  status: 'announced',
  session: 'EG3',
  games: ['Sky Noon'],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'history-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function store(options: Partial<HistoryStoreOptions> & { at: string }) {
  const { at, ...rest } = options;
  return createHistoryStore({ dir, title: 'Card Club', timezone: TIMEZONE, now: () => new Date(at), ...rest });
}

const write = (file: string, text: string) => writeFileSync(join(dir, file), text);

describe('the record', () => {
  it('shows the files as they are', async () => {
    write(SESSIONS_FILE, RECORD);
    write(GAMES_FILE, GAMES);
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();

    expect(data.title).toBe('Card Club');
    expect(data.today).toBe('2031-01-20');
    expect(data.timezone).toBe('PT');
    expect(data.sessions.map((s) => s.session)).toEqual(['EG1', 'EG2']);
    expect(data.games[0]).toMatchObject({ name: 'Duck Game', plays: 2, style: '2D platform fighter' });
    expect(data.next).toBeUndefined();
    expect(data.notes).toEqual([]);
  });

  it('says so when there is no sessions.csv yet, and passes on problems in the files', async () => {
    const empty = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(empty.sessions).toEqual([]);
    expect(empty.notes).toEqual([{ kind: 'info', text: 'There is no sessions.csv in the history folder yet.' }]);

    write(SESSIONS_FILE, `${HEADER}\nEG1,13/45/2031,,Played,Duck Game,,,,,\n`);
    const bad = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(bad.notes.map((n) => n.text).join(' ')).toContain('13/45/2031');
  });

  it('warns about rows dated after today, and still shows them', async () => {
    write(SESSIONS_FILE, `${RECORD}EG9,2062-01-18,10:30am,Played,Duck Game,,,,,\n`);
    write(GAMES_FILE, GAMES);
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(data.sessions.map((x) => x.date)).toEqual(['2031-01-04', '2031-01-11', '2062-01-18']);
    expect(data.notes).toEqual([{ kind: 'warning', text: 'sessions.csv has a row dated after today (2062-01-18). Check the year.' }]);

    write(SESSIONS_FILE, `${RECORD}EG9,2062-01-18,,Played,,,,,,\nEG10,2062-01-25,,Played,,,,,,\n`);
    const two = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(two.notes[0]?.text).toBe('sessions.csv has 2 rows dated after today (2062-01-18). Check the year.');
  });

  it('"today" follows the timezone, not UTC', async () => {
    write(SESSIONS_FILE, RECORD);
    // 03:00 UTC on the 21st is still the evening of the 20th in California.
    expect((await store({ at: '2031-01-21T03:00:00Z' }).getData()).today).toBe('2031-01-20');
  });

  it('reuses what it computed for a while, then reads the files again', async () => {
    write(SESSIONS_FILE, RECORD);
    let at = Date.parse('2031-01-20T20:00:00Z');
    const s = createHistoryStore({ dir, title: 'Card Club', timezone: TIMEZONE, now: () => new Date(at), maxAgeMs: 30_000 });
    expect((await s.getData()).sessions).toHaveLength(2);

    write(SESSIONS_FILE, `${RECORD}EG3,2031-01-18,10:30am,Played,Duck Game,,,,,\n`);
    at += 10_000;
    expect((await s.getData()).sessions).toHaveLength(2);
    at += 30_000;
    expect((await s.getData()).sessions).toHaveLength(3);
  });

  it('reads the files again right away after invalidate()', async () => {
    write(SESSIONS_FILE, RECORD);
    const s = store({ at: '2031-01-20T20:00:00Z' });
    await s.getData();
    write(SESSIONS_FILE, `${RECORD}EG3,2031-01-18,10:30am,Played,Duck Game,,,,,\n`);
    s.invalidate();
    expect((await s.getData()).sessions).toHaveLength(3);
  });

  it("fails a load it can't read, and doesn't keep the failure", async () => {
    // Not run as root (which can read anything), so the permission really is refused.
    if (process.getuid?.() === 0) return;
    write(SESSIONS_FILE, RECORD);
    chmodSync(join(dir, SESSIONS_FILE), 0o000);
    const s = store({ at: '2031-01-20T20:00:00Z' });
    await expect(s.getData()).rejects.toThrow(/EACCES/);

    chmodSync(join(dir, SESSIONS_FILE), 0o644);
    expect((await s.getData()).sessions).toHaveLength(2);
  });
});

describe('next.json', () => {
  beforeEach(() => write(GAMES_FILE, GAMES));

  it('shows the upcoming session the bot wrote', async () => {
    write(SESSIONS_FILE, RECORD);
    write(NEXT_FILE, JSON.stringify(NEXT));
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(data.next).toEqual({ date: '2031-01-25', start: '10:30am', status: 'announced', session: 'EG3', games: ['Sky Noon'] });
    expect(data.notes).toEqual([]);
  });

  it('ignores a session that is over by now', async () => {
    write(SESSIONS_FILE, RECORD);
    write(NEXT_FILE, JSON.stringify(NEXT));
    // The day after, in California (the 26th in UTC already from 08:00 on).
    expect((await store({ at: '2031-01-26T09:00:00Z' }).getData()).next).toBeUndefined();
    // Late on the day itself it is still shown.
    expect((await store({ at: '2031-01-26T07:00:00Z' }).getData()).next?.date).toBe('2031-01-25');
  });

  it.each([
    ['is not JSON', '{"date": "2031-01-25", "start":'],
    ['has the wrong shape', JSON.stringify({ ...NEXT, status: 'soon' })],
    ['is empty', ''],
  ])('ignores a file that %s, without a note', async (_, text) => {
    write(SESSIONS_FILE, RECORD);
    write(NEXT_FILE, text);
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(data.next).toBeUndefined();
    expect(data.notes).toEqual([]);
    expect(data.sessions).toHaveLength(2);
  });

  it("does without it when it is missing or can't be read", async () => {
    write(SESSIONS_FILE, RECORD);
    expect((await store({ at: '2031-01-20T20:00:00Z' }).getData()).next).toBeUndefined();

    mkdirSync(join(dir, NEXT_FILE)); // a folder by that name: reading it fails with EISDIR
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(data.next).toBeUndefined();
    expect(data.notes).toEqual([]);
  });

  it('is read again with the rest of the record', async () => {
    write(SESSIONS_FILE, RECORD);
    const s = store({ at: '2031-01-20T20:00:00Z' });
    expect((await s.getData()).next).toBeUndefined();
    write(NEXT_FILE, JSON.stringify({ ...NEXT, status: 'cancelled', games: [] }));
    s.invalidate();
    expect((await s.getData()).next?.status).toBe('cancelled');
  });
});
