import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { type HistoryServerOptions, createHistoryHandler, loadClientFiles } from './server.ts';
import type { HistoryData } from './types.ts';

const INDEX_HTML = '<!doctype html>\n<title>Sessions</title>\n<link rel="stylesheet" href="/styles.css">\n<script type="module" src="/main.ts"></script>\n';
const MAIN_TS = `import type { Point } from './types.d.ts';
import { double } from './util.ts';

interface Options {
  label: string;
  scale?: number;
}

export function label(point: Point, options: Options): string {
  const scale: number = options.scale ?? 1;
  return \`\${options.label}: \${double(point.x * scale)}\`;
}

export const total = <T extends number>(values: T[]): number => values.reduce((sum: number, v) => sum + v, 0);
`;
const UTIL_TS = 'export function double(n: number): number {\n  return n * 2;\n}\n';
const STYLES_CSS = 'body { font-family: sans-serif; }\n';
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>\n';
const LOGO_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
const FAVICON_ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

const tempDirs: string[] = [];

/**
 * A made-up page folder, <temp>/client, with files that must and must not be served. Its parent
 * holds a package.json and a stylesheet, for the requests that try to climb out of the folder.
 */
function makeClientDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'history-server-'));
  tempDirs.push(root);
  writeFileSync(join(root, 'package.json'), '{ "name": "outside-the-folder" }\n');
  writeFileSync(join(root, 'secret.css'), '.outside { color: red; }\n');

  const dir = join(root, 'client');
  mkdirSync(dir);
  writeFileSync(join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(join(dir, 'main.ts'), MAIN_TS);
  writeFileSync(join(dir, 'util.ts'), UTIL_TS);
  writeFileSync(join(dir, 'styles.css'), STYLES_CSS);
  writeFileSync(join(dir, 'favicon.svg'), FAVICON_SVG);
  writeFileSync(join(dir, 'logo.png'), LOGO_PNG);
  writeFileSync(join(dir, 'favicon.ico'), FAVICON_ICO);
  // Not served:
  writeFileSync(join(dir, 'notes.md'), '# Notes\n');
  writeFileSync(join(dir, 'tsconfig.json'), '{ "compilerOptions": { "lib": ["dom"] } }\n');
  writeFileSync(join(dir, '.env'), 'TOKEN=made-up\n');
  writeFileSync(join(dir, '.hidden.css'), 'body { display: none; }\n');
  writeFileSync(join(dir, 'main.test.ts'), "import { label } from './main.ts';\nvoid label;\n");
  writeFileSync(join(dir, 'types.d.ts'), 'export interface Point {\n  x: number;\n}\n');
  writeFileSync(join(dir, 'main.ts.map'), '{}\n');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'inner.ts'), 'export const inner = 1;\n');
  mkdirSync(join(dir, 'folder.css'));
  symlinkSync(join(root, 'secret.css'), join(dir, 'linked.css'));
  return dir;
}

const data: HistoryData = {
  title: 'Test Club',
  generatedAt: '2031-03-08T19:00:00.000Z',
  today: '2031-03-08',
  sessions: [
    {
      session: 'TC12',
      date: '2031-03-01',
      day: 'Saturday',
      status: 'Played',
      games: [{ name: 'Pokémon Unite', play: 1 }],
      planned: [],
      styles: ['Arena'],
      auto: false,
    },
  ],
  games: [],
  slices: [],
  years: [],
  styles: ['Arena'],
  overdue: [],
  milestones: [],
  notes: [],
};

const servers: http.Server[] = [];

/** Starts a server on a free local port and returns its base URL. */
async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Serves the made-up page folder (or `options.clientDir`) and returns the base URL. */
function serve(options: Partial<HistoryServerOptions> = {}): Promise<string> {
  return listen(createHistoryHandler({ clientDir: options.clientDir ?? makeClientDir(), getData: async () => data, ...options }));
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** True when the request went out on a connection an earlier one had used (keep-alive). */
  reusedSocket: boolean;
}

/** Sends `path` exactly as written: fetch would tidy up ".." segments before sending them. */
function raw(base: string, path: string, method = 'GET', extra: { headers?: Record<string, string>; agent?: http.Agent } = {}): Promise<RawResponse> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method, agent: extra.agent ?? false, headers: extra.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), reusedSocket: req.reusedSocket }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dataUrl = (js: string) => `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;

function expectSecurityHeaders(headers: Headers | http.IncomingHttpHeaders): void {
  const get = (name: string) => (headers instanceof Headers ? headers.get(name) : headers[name]);
  expect(get('content-security-policy')).toBe(
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(get('x-content-type-options')).toBe('nosniff');
  expect(get('referrer-policy')).toBe('no-referrer');
  expect(get('x-robots-tag')).toBe('noindex, nofollow');
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadClientFiles', () => {
  it('lists the page at "/" and only the files with a servable extension', () => {
    const files = loadClientFiles(makeClientDir());
    expect([...files.keys()].sort()).toEqual(['/', '/favicon.ico', '/favicon.svg', '/logo.png', '/main.ts', '/styles.css', '/util.ts']);
    expect(files.get('/')).toMatchObject({ type: 'text/html; charset=utf-8', body: Buffer.from(INDEX_HTML) });
    expect(files.get('/logo.png')).toMatchObject({ type: 'image/png', body: LOGO_PNG });
  });

  it('gives each file a quoted hash of what is served as its ETag', () => {
    const dir = makeClientDir();
    const before = loadClientFiles(dir);
    expect(before.get('/styles.css')?.etag).toMatch(/^"[A-Za-z0-9_-]{20,}"$/);
    expect(before.get('/styles.css')?.etag).not.toBe(before.get('/util.ts')?.etag);
    expect(loadClientFiles(dir).get('/styles.css')?.etag).toBe(before.get('/styles.css')?.etag);

    writeFileSync(join(dir, 'styles.css'), 'body { color: teal; }\n');
    expect(loadClientFiles(dir).get('/styles.css')?.etag).not.toBe(before.get('/styles.css')?.etag);
  });

  it('strips the types from .ts files and keeps their import specifiers', () => {
    const files = loadClientFiles(makeClientDir());
    const main = files.get('/main.ts')?.body.toString('utf8') ?? '';
    expect(files.get('/main.ts')?.type).toBe('text/javascript; charset=utf-8');
    expect(main).toContain("import { double } from './util.ts';");
    expect(main).not.toContain('import type');
    expect(main).not.toContain('interface');
    expect(main).not.toMatch(/: (number|string|Point|Options)/);
  });

  it('serves JavaScript that runs', async () => {
    const files = loadClientFiles(makeClientDir());
    const util = files.get('/util.ts')?.body.toString('utf8') ?? '';
    const main = files.get('/main.ts')?.body.toString('utf8') ?? '';
    // A data: URL has no folder to resolve './util.ts' against, so point the import at util's own data: URL.
    const linked = main.replace("'./util.ts'", JSON.stringify(dataUrl(util)));
    expect(linked).not.toBe(main);

    const module = (await import(/* @vite-ignore */ dataUrl(linked))) as {
      label(point: { x: number }, options: { label: string; scale?: number }): string;
      total(values: number[]): number;
    };
    expect(module.label({ x: 4 }, { label: 'Width', scale: 3 })).toBe('Width: 24');
    expect(module.total([1, 2, 3])).toBe(6);
  });

  it('throws when the folder has no index.html', () => {
    const dir = makeClientDir();
    rmSync(join(dir, 'index.html'));
    expect(() => loadClientFiles(dir)).toThrow(/no index\.html/);
    expect(() => createHistoryHandler({ clientDir: dir, getData: async () => data })).toThrow(/no index\.html/);
  });

  it('throws, naming the file, when a .ts file has a syntax error', () => {
    const dir = makeClientDir();
    writeFileSync(join(dir, 'broken.ts'), 'export const count: number = ;\n');
    expect(() => loadClientFiles(dir)).toThrow(/broken\.ts/);
    expect(() => createHistoryHandler({ clientDir: dir, getData: async () => data })).toThrow(/broken\.ts/);
  });

  it('throws when a .ts file uses syntax that stripping cannot remove', () => {
    const dir = makeClientDir();
    writeFileSync(join(dir, 'colors.ts'), 'export enum Color {\n  Red,\n}\n');
    expect(() => loadClientFiles(dir)).toThrow(/colors\.ts/);
  });

  it('does not read the files it will not serve', () => {
    const dir = makeClientDir();
    writeFileSync(join(dir, 'broken.test.ts'), 'this is not ( typescript\n');
    writeFileSync(join(dir, 'broken.d.ts'), 'nor } is this\n');
    expect(() => loadClientFiles(dir)).not.toThrow();
  });

  it('never lists test or declaration files, however their names are capitalised', () => {
    const dir = makeClientDir();
    // Neither is a script: stripping them would throw.
    writeFileSync(join(dir, 'Chart.TEST.ts'), 'this is not ( typescript\n');
    writeFileSync(join(dir, 'shapes.D.ts'), 'nor } is this\n');
    const files = loadClientFiles(dir);
    expect(files.has('/Chart.TEST.ts')).toBe(false);
    expect(files.has('/shapes.D.ts')).toBe(false);
  });

  it('skips symlinks even when they point inside the folder', () => {
    const dir = makeClientDir();
    symlinkSync(join(dir, 'styles.css'), join(dir, 'alias.css'));
    symlinkSync('util.ts', join(dir, 'relative.ts'));
    const files = loadClientFiles(dir);
    expect(files.has('/alias.css')).toBe(false);
    expect(files.has('/relative.ts')).toBe(false);
  });

  it('throws when index.html is a symlink or a folder', () => {
    const linked = makeClientDir();
    rmSync(join(linked, 'index.html'));
    writeFileSync(join(linked, 'page.txt'), INDEX_HTML);
    symlinkSync(join(linked, 'page.txt'), join(linked, 'index.html'));
    expect(() => loadClientFiles(linked)).toThrow(/no index\.html/);

    const folder = makeClientDir();
    rmSync(join(folder, 'index.html'));
    mkdirSync(join(folder, 'index.html'));
    expect(() => loadClientFiles(folder)).toThrow(/no index\.html/);
  });

  it('throws, naming the folder, when the folder is missing', () => {
    const missing = join(makeClientDir(), 'nowhere');
    expect(() => loadClientFiles(missing)).toThrow(missing);
    expect(() => createHistoryHandler({ clientDir: missing, getData: async () => data })).toThrow(missing);
  });

  it('reads empty files as empty, and a file of types only as no code', () => {
    const dir = makeClientDir();
    writeFileSync(join(dir, 'blank.ts'), '');
    writeFileSync(join(dir, 'blank.css'), '');
    writeFileSync(join(dir, 'shapes.ts'), 'export interface Shape {\n  sides: number;\n}\n');
    const files = loadClientFiles(dir);
    expect(files.get('/blank.ts')?.body.length).toBe(0);
    expect(files.get('/blank.css')?.body.length).toBe(0);
    expect(files.get('/blank.css')?.etag).toMatch(/^"[A-Za-z0-9_-]{20,}"$/);
    expect(files.get('/shapes.ts')?.body.toString('utf8').trim()).toBe('');
  });

  it('lists a file with an awkward name under the path a browser asks for', () => {
    const dir = makeClientDir();
    const names = ['my chart.css', 'straße.svg', '日本語.png', '🎲.svg', 'a+b (1).css', '50%.css', 'what?.css', 'tag#1.css', 'back\\slash.css'];
    for (const name of names) writeFileSync(join(dir, name), '');
    const routes = [...loadClientFiles(dir).keys()];
    expect(routes).toEqual(
      expect.arrayContaining([
        '/my%20chart.css',
        '/stra%C3%9Fe.svg',
        '/%E6%97%A5%E6%9C%AC%E8%AA%9E.png',
        '/%F0%9F%8E%B2.svg',
        '/a+b%20(1).css',
        '/50%25.css',
        '/what%3F.css',
        '/tag%231.css',
        '/back%5Cslash.css',
      ]),
    );
    // One route per file, each a single path segment.
    expect(routes).toHaveLength(7 + names.length);
    for (const route of routes) expect(route.lastIndexOf('/')).toBe(0);
  });
});

describe('createHistoryHandler: the page and its files', () => {
  it('serves the page at "/"', async () => {
    const res = await fetch(`${await serve()}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(INDEX_HTML)));
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe(INDEX_HTML);
  });

  it('serves .ts files as JavaScript', async () => {
    const res = await fetch(`${await serve()}/main.ts`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expectSecurityHeaders(res.headers);
    const body = await res.text();
    expect(body).toContain("from './util.ts'");
    expect(body).not.toContain(': number');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
  });

  it.each([
    ['/util.ts', 'text/javascript; charset=utf-8'],
    ['/styles.css', 'text/css; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/logo.png', 'image/png'],
    ['/favicon.ico', 'image/x-icon'],
  ])('serves %s as %s', async (path, type) => {
    const res = await fetch(`${await serve()}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(type);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toBeTruthy();
    expectSecurityHeaders(res.headers);
  });

  it('serves files byte for byte', async () => {
    const base = await serve();
    expect(await (await fetch(`${base}/styles.css`)).text()).toBe(STYLES_CSS);
    expect(await (await fetch(`${base}/favicon.svg`)).text()).toBe(FAVICON_SVG);
    expect(Buffer.from(await (await fetch(`${base}/logo.png`)).arrayBuffer())).toEqual(LOGO_PNG);
  });

  it('ignores the query string', async () => {
    const base = await serve();
    expect((await fetch(`${base}/styles.css?v=3`)).status).toBe(200);
    expect(await (await fetch(`${base}/?range=2030`)).text()).toBe(INDEX_HTML);
    expect((await fetch(`${base}/notes.md?file=styles.css`)).status).toBe(404);
    expect((await fetch(`${base}/nope?/styles.css`)).status).toBe(404);
    expect((await fetch(`${base}/api/history.json?range=all&x=../../etc`)).status).toBe(200);
    expect(await (await fetch(`${base}/healthz?`)).text()).toBe('ok');
  });

  it('answers /healthz', async () => {
    const res = await fetch(`${await serve()}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-length')).toBe('2');
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe('ok');
  });

  it('reads the folder once by default', async () => {
    const clientDir = makeClientDir();
    const base = await serve({ clientDir });
    writeFileSync(join(clientDir, 'styles.css'), 'body { color: teal; }\n');
    writeFileSync(join(clientDir, 'extra.css'), 'p { margin: 0; }\n');
    expect(await (await fetch(`${base}/styles.css`)).text()).toBe(STYLES_CSS);
    expect((await fetch(`${base}/extra.css`)).status).toBe(404);
  });

  it('serves files whose names need percent-encoding', async () => {
    const clientDir = makeClientDir();
    writeFileSync(join(clientDir, 'my chart.css'), 'p { margin: 0; }\n');
    writeFileSync(join(clientDir, 'straße.svg'), FAVICON_SVG);
    writeFileSync(join(clientDir, '日本語.png'), LOGO_PNG);
    writeFileSync(join(clientDir, '🎲.svg'), FAVICON_SVG);
    writeFileSync(join(clientDir, 'what?.css'), 'q { margin: 0; }\n');
    const base = await serve({ clientDir });

    // fetch spells these the way a browser does: "/my%20chart.css", "/stra%C3%9Fe.svg", …
    const spaced = await fetch(`${base}/my chart.css`);
    expect(spaced.status).toBe(200);
    expect(spaced.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await spaced.text()).toBe('p { margin: 0; }\n');
    expect(await (await fetch(`${base}/straße.svg`)).text()).toBe(FAVICON_SVG);
    expect(Buffer.from(await (await fetch(`${base}/日本語.png`)).arrayBuffer())).toEqual(LOGO_PNG);
    expect((await fetch(`${base}/🎲.svg`)).status).toBe(200);
    expect((await raw(base, '/%F0%9F%8E%B2.svg')).status).toBe(200);

    expect(await (await fetch(`${base}/what%3F.css`)).text()).toBe('q { margin: 0; }\n');
    // Unescaped, "?" starts the query string, and what is left is not a route.
    expect((await fetch(`${base}/what?.css`)).status).toBe(404);
    expect((await fetch(`${base}/what`)).status).toBe(404);
  });

  it('serves empty and very large files whole', async () => {
    const clientDir = makeClientDir();
    const large = `/* ${'x'.repeat(3_000_000)} */\n`;
    writeFileSync(join(clientDir, 'blank.css'), '');
    writeFileSync(join(clientDir, 'large.css'), large);
    const base = await serve({ clientDir });

    const blank = await fetch(`${base}/blank.css`);
    expect(blank.status).toBe(200);
    expect(blank.headers.get('content-length')).toBe('0');
    expect(await blank.text()).toBe('');

    const res = await fetch(`${base}/large.css`);
    expect(res.headers.get('content-length')).toBe(String(large.length));
    expect((await res.text()) === large).toBe(true);
  });

  it('resolves "." and ".." segments before the lookup, so they only ever reach a listed file', async () => {
    const base = await serve();
    expect((await raw(base, '/sub/../styles.css')).body).toBe(STYLES_CSS);
    expect((await raw(base, '/./styles.css')).body).toBe(STYLES_CSS);
    expect((await raw(base, '/sub/../../../secret.css')).status).toBe(404);
  });

  it('writes nothing when a response was already sent', async () => {
    const warnings: string[] = [];
    const handler = createHistoryHandler({ clientDir: makeClientDir(), getData: async () => data, log: { warn: (message) => warnings.push(message) } });
    const base = await listen((req, res) => {
      res.writeHead(503, { 'Content-Length': 4 });
      res.end('busy');
      handler(req, res);
    });
    for (const path of ['/', '/api/history.json', '/nope']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('busy');
    }
    await pause(20);
    expect(warnings).toEqual([]);
  });
});

describe('createHistoryHandler: the data', () => {
  it('serves the data as JSON, never cached', async () => {
    const res = await fetch(`${await serve()}/api/history.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    expectSecurityHeaders(res.headers);
    const body = await res.text();
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    expect(JSON.parse(body)).toEqual(data);
  });

  it('asks for the data on every request', async () => {
    let calls = 0;
    const base = await serve({ getData: async () => ({ ...data, title: `Call ${++calls}` }) });
    expect(((await (await fetch(`${base}/api/history.json`)).json()) as HistoryData).title).toBe('Call 1');
    expect(((await (await fetch(`${base}/api/history.json`)).json()) as HistoryData).title).toBe('Call 2');
  });

  it('answers 500 without the details when the data cannot be built, and logs them', async () => {
    const failure = new Error('sessions.csv: bad date on row 7 of /volume1/made-up');
    const warnings: { message: string; err: unknown }[] = [];
    const base = await serve({
      getData: () => Promise.reject(failure),
      log: { warn: (message, err) => warnings.push({ message, err }) },
    });

    const res = await fetch(`${base}/api/history.json`);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expectSecurityHeaders(res.headers);
    const body = await res.text();
    expect(body).toBe('Something went wrong');
    expect(res.headers.get('content-length')).toBe(String(body.length));
    expect(body).not.toMatch(/sessions\.csv|row 7|volume1|\bat /);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('/api/history.json');
    expect(warnings[0]?.err).toBe(failure);

    // The page itself doesn't need the data, and the server carries on.
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('answers 500 when getData throws instead of rejecting, with or without a log', async () => {
    const base = await serve({
      getData: () => {
        throw new Error('thrown before any promise');
      },
    });
    const res = await fetch(`${base}/api/history.json`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Something went wrong');
  });

  it('still answers when the log itself throws', async () => {
    const base = await serve({
      getData: () => Promise.reject(new Error('no data')),
      log: {
        warn: () => {
          throw new Error('log is broken');
        },
      },
    });
    expect((await fetch(`${base}/api/history.json`)).status).toBe(500);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('answers 500 when getData resolves with nothing', async () => {
    const base = await serve({ getData: (async () => undefined) as never });
    const res = await fetch(`${base}/api/history.json`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Something went wrong');
  });

  it('serves awkward text in the data unchanged, with its length in bytes', async () => {
    const awkward: HistoryData = {
      ...data,
      title: '</script><script>alert(1)</script> "Sat & Sun" \\ 🎲 日本語 Ünïcödé \u2028 \r\n',
      notes: [
        { kind: 'warning', text: 'javascript:alert(1)' },
        { kind: 'info', text: 'é'.repeat(200_000) },
      ],
    };
    const res = await fetch(`${await serve({ getData: async () => awkward })}/api/history.json`);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(awkward);
  });

  it('carries on when a visitor hangs up before the data is ready', async () => {
    let asked = (): void => {};
    const asking = new Promise<void>((resolve) => (asked = resolve));
    let finish = (): void => {};
    const warnings: string[] = [];
    const base = await serve({
      getData: () => {
        asked();
        return new Promise((resolve) => (finish = () => resolve(data)));
      },
      log: { warn: (message) => warnings.push(message) },
    });

    const { hostname, port } = new URL(base);
    const socket = net.connect(Number(port), hostname);
    socket.on('error', () => {});
    socket.write('GET /api/history.json HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await asking;
    await new Promise((resolve) => socket.once('close', resolve).destroy());
    await pause(20);
    finish();
    await pause(20);

    expect(warnings).toEqual([]);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe('createHistoryHandler: what is not served', () => {
  it.each([
    '/index.html',
    '/notes.md',
    '/tsconfig.json',
    '/.env',
    '/.hidden.css',
    '/main.test.ts',
    '/types.d.ts',
    '/main.ts.map',
    '/main.js',
    '/main',
    '/MAIN.TS',
    '/main.ts/',
    '/sub/inner.ts',
    '/sub%2finner.ts',
    '/inner.ts',
    '/sub',
    '/folder.css',
    '/linked.css',
    '/secret.css',
    '/api',
    '/api/history',
    '/api/history.json/',
    '/healthz/',
    '/sessions.csv',
    '/package.json',
    // Climbing out of the folder, in every spelling. All sent as written.
    '/../package.json',
    '/../secret.css',
    '/sub/../../package.json',
    '/..%2f..%2fpackage.json',
    '/..%2fpackage.json',
    '/%2e%2e/package.json',
    '/%2e%2e%2fpackage.json',
    '/.%2e/secret.css',
    '/..\\package.json',
    '/..%5cpackage.json',
    '/%252e%252e/package.json',
    '//etc/passwd',
    '/etc/passwd',
    '/%00',
    '/styles.css%00.md',
    '/styles.css;v=1',
    '/styles%2Ecss',
    '/%',
    '/%zz',
    '/*',
    // Names every object has.
    '/constructor',
    '/__proto__',
    '/toString',
    '/hasOwnProperty',
    // An attempt to smuggle a header in. Nothing of the request is ever echoed.
    '/%0d%0aX-Injected:%20yes',
    // Another scheme with no path at all: the pathname is empty.
    'foo://elsewhere.example',
  ])('answers 404 for %s', async (path) => {
    const res = await raw(await serve(), path);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['content-length']).toBe('9');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-injected']).toBeUndefined();
    expect(res.body).toBe('Not found');
  });

  it('answers 404 for a very long path', async () => {
    const res = await raw(await serve(), `/${'a'.repeat(8000)}/../${'b'.repeat(4000)}.css`);
    expect(res.status).toBe(404);
    expect(res.body).toBe('Not found');
  });

  it('answers 404, with the security headers, for encoded traversal sent by fetch', async () => {
    const base = await serve();
    for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/nope']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expectSecurityHeaders(res.headers);
      expect(await res.text()).toBe('Not found');
    }
  });

  it('answers 400 for a URL that cannot be parsed', async () => {
    const res = await raw(await serve(), '//');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    // Our own answer, not one from Node's HTTP parser.
    expectSecurityHeaders(res.headers);
    expect(res.headers['content-length']).toBe('11');
    expect(res.body).toBe('Bad request');
    for (const path of ['///', 'http://[/styles.css']) expect((await raw(await serve(), path)).status).toBe(400);
  });

  it('does not log the requests it turns away', async () => {
    const warnings: string[] = [];
    const base = await serve({ log: { warn: (message) => warnings.push(message) } });
    expect((await raw(base, '/%0d%0aforged-log-line')).status).toBe(404);
    expect((await raw(base, '//')).status).toBe(400);
    expect((await raw(base, '/', 'DELETE')).status).toBe(405);
    expect(warnings).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('answers 405 for %s', async (method) => {
    const base = await serve();
    for (const path of ['/', '/api/history.json', '/nope']) {
      const res = await fetch(`${base}${path}`, { method, body: method === 'OPTIONS' ? undefined : 'x=1' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expectSecurityHeaders(res.headers);
      expect(await res.text()).toBe('Method not allowed');
    }
  });
});

describe('createHistoryHandler: HEAD and ETags', () => {
  it('answers HEAD like GET, without a body', async () => {
    const base = await serve({ downloads: { 'sessions.csv': () => 'Date,Games\n' } });
    for (const path of ['/', '/main.ts', '/api/history.json', '/sessions.csv', '/healthz', '/nope']) {
      const get = await raw(base, path);
      const head = await raw(base, path, 'HEAD');
      expect(head.status).toBe(get.status);
      expect(head.body).toBe('');
      // Everything but the clock, which may tick between the two requests.
      expect({ ...head.headers, date: '' }).toEqual({ ...get.headers, date: '' });
      expect(head.headers['content-length']).toBe(String(Buffer.byteLength(get.body)));
    }
  });

  it('answers 304 without a body when If-None-Match has the file’s ETag', async () => {
    const base = await serve();
    const first = await fetch(`${base}/main.ts`);
    const etag = first.headers.get('etag') ?? '';
    const length = first.headers.get('content-length');
    await first.text();

    // W/…: a proxy that compresses the file weakens its ETag.
    for (const header of [etag, `W/${etag}`, `"something-else", ${etag}`, '*']) {
      const res = await fetch(`${base}/main.ts`, { headers: { 'If-None-Match': header } });
      expect(res.status).toBe(304);
      expect(res.headers.get('etag')).toBe(etag);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('content-length')).toBe(length);
      expectSecurityHeaders(res.headers);
      expect(await res.text()).toBe('');
    }

    const head = await fetch(`${base}/main.ts`, { method: 'HEAD', headers: { 'If-None-Match': etag } });
    expect(head.status).toBe(304);
  });

  it('sends the file again when the ETag is a different one', async () => {
    const base = await serve();
    const other = (await fetch(`${base}/util.ts`)).headers.get('etag') ?? '';
    for (const header of [other, '"stale"', 'not-an-etag']) {
      const res = await fetch(`${base}/main.ts`, { headers: { 'If-None-Match': header } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('./util.ts');
    }
  });

  it('never answers 304 for the data', async () => {
    const res = await fetch(`${await serve()}/api/history.json`, { headers: { 'If-None-Match': '*' } });
    expect(res.status).toBe(200);
  });

  it('ignores an If-None-Match that only resembles the ETag', async () => {
    const base = await serve();
    const etag = (await fetch(`${base}/styles.css`)).headers.get('etag') ?? '';
    const bare = etag.slice(1, -1);
    for (const header of [bare, `"${bare}`, `"${bare}x"`, `W/${bare}`, `w/${etag}`, '""', ',', ' , ,', `${etag}${etag}`]) {
      const res = await raw(base, '/styles.css', 'GET', { headers: { 'If-None-Match': header } });
      expect(res.status).toBe(200);
      expect(res.body).toBe(STYLES_CSS);
    }
  });

  it('keeps the connection usable after a 304 and after a HEAD', async () => {
    const base = await serve();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const etag = String((await raw(base, '/styles.css', 'GET', { agent })).headers.etag);
      const unchanged = await raw(base, '/styles.css', 'GET', { agent, headers: { 'If-None-Match': etag } });
      expect(unchanged.status).toBe(304);
      expect(unchanged.body).toBe('');

      const head = await raw(base, '/main.ts', 'HEAD', { agent });
      expect(head.reusedSocket).toBe(true);
      expect(head.status).toBe(200);
      expect(head.body).toBe('');

      // Had either answer been framed wrongly, this one would be read from the wrong place.
      const next = await raw(base, '/util.ts', 'GET', { agent });
      expect(next.reusedSocket).toBe(true);
      expect(next.status).toBe(200);
      expect(next.body).toContain('export function double');
    } finally {
      agent.destroy();
    }
  });
});

describe('createHistoryHandler: downloads', () => {
  const csv = (d: HistoryData) => `Date,Games\n${d.sessions.map((s) => `${s.date},${s.games.map((g) => g.name).join(';')}`).join('\n')}\n`;

  it('serves a .csv download with a byte-order mark, built from the data', async () => {
    const res = await fetch(`${await serve({ downloads: { 'sessions.csv': csv } })}/sessions.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="sessions.csv"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectSecurityHeaders(res.headers);

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('Date,Games\n2031-03-01,Pokémon Unite\n');
  });

  it('does not add a second byte-order mark', async () => {
    const res = await fetch(`${await serve({ downloads: { 'games.csv': () => '\uFEFFGame\n' } })}/games.csv`);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('\uFEFFGame\n'));
  });

  it('serves other downloads as plain text, without the mark', async () => {
    const res = await fetch(`${await serve({ downloads: { 'summary.txt': (d) => `${d.title}: ${d.sessions.length} session` } })}/summary.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="summary.txt"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('Test Club: 1 session'));
  });

  it('only serves a download at its exact name', async () => {
    const base = await serve({ downloads: { 'sessions.csv': csv } });
    expect((await fetch(`${base}/Sessions.csv`)).status).toBe(404);
    expect((await fetch(`${base}/sessions.csv/`)).status).toBe(404);
    expect((await fetch(`${base}/games.csv`)).status).toBe(404);
  });

  it.each([
    '',
    '.hidden.csv',
    '.',
    '..',
    'a/b.csv',
    '../sessions.csv',
    'api/history.json',
    'my sessions.csv',
    'a"b.csv',
    'a\r\nb.csv',
    'séances.csv',
    'a%2fb.csv',
    'sessions.csv\n',
    ' sessions.csv',
    'sessions.csv ',
    'a\\b.csv',
    'a\tb.csv',
    'a\u0000b.csv',
    '\u202Evsc.snoisses',
    'a;b.csv',
    "a'b.csv",
    'a,b.csv',
    'a?b.csv',
    'a#b.csv',
    'a:b.csv',
    '🎲.csv',
  ])(
    'rejects the download name %j when the handler is created',
    (name) => {
      expect(() => createHistoryHandler({ clientDir: makeClientDir(), getData: async () => data, downloads: { [name]: csv } })).toThrow(/bad download name/);
    },
  );

  it.each(['styles.css', 'main.ts', 'favicon.svg', 'index.html', 'healthz'])('rejects the download name %s, which the page already uses', (name) => {
    expect(() => createHistoryHandler({ clientDir: makeClientDir(), getData: async () => data, downloads: { [name]: csv } })).toThrow(/already taken/);
  });

  it('allows names of files the folder has but does not serve', async () => {
    const res = await fetch(`${await serve({ downloads: { 'notes.md': () => 'From the download' } })}/notes.md`);
    expect(await res.text()).toBe('From the download');
  });

  it.each(['a', '-', '_', 'a..b', 'sessions-2031_v2.txt', 'constructor', '__proto__'])('accepts the download name %s', async (name) => {
    const res = await fetch(`${await serve({ downloads: { [name]: () => 'made-up text' } })}/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${name}"`);
    expect(await res.text()).toBe('made-up text');
  });

  it('treats .CSV like .csv', async () => {
    const res = await fetch(`${await serve({ downloads: { 'SESSIONS.CSV': () => 'Date\n' } })}/SESSIONS.CSV`);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('\uFEFFDate\n'));
  });

  it('serves an empty download', async () => {
    const base = await serve({ downloads: { 'sessions.csv': () => '', 'summary.txt': () => '' } });
    const emptyCsv = await fetch(`${base}/sessions.csv`);
    expect(emptyCsv.status).toBe(200);
    expect(emptyCsv.headers.get('content-length')).toBe('3');
    expect([...Buffer.from(await emptyCsv.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf]);

    const emptyText = await fetch(`${base}/summary.txt`);
    expect(emptyText.status).toBe(200);
    expect(emptyText.headers.get('content-length')).toBe('0');
    expect(await emptyText.text()).toBe('');
  });

  it('sends the text exactly as it was built (escaping cells is the job of whoever writes the CSV)', async () => {
    const text = 'Game,Notes\r\n"=HYPERLINK(""http://example.invalid"")","+1, -2, @everyone"\r\n日本語 🎲,"line one\nline two"\r\n';
    const res = await fetch(`${await serve({ downloads: { 'sessions.csv': () => text } })}/sessions.csv`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(bytes.subarray(3).toString('utf8')).toBe(text);
  });

  it('answers 500 and logs the real error when a download function rejects', async () => {
    const failure = new Error('could not write row 9');
    const warnings: { message: string; err: unknown }[] = [];
    const rejecting = (() => Promise.reject(failure)) as never;
    const base = await serve({
      downloads: { 'sessions.csv': rejecting, 'summary.txt': rejecting },
      log: { warn: (message, err) => warnings.push({ message, err }) },
    });

    for (const path of ['/sessions.csv', '/summary.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-disposition')).toBeNull();
      expect(await res.text()).toBe('Something went wrong');
    }
    expect(warnings).toEqual([
      { message: expect.stringContaining('/sessions.csv'), err: failure },
      { message: expect.stringContaining('/summary.txt'), err: failure },
    ]);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('answers 500 when a download function returns something other than text', async () => {
    const base = await serve({
      downloads: {
        'nothing.csv': (() => undefined) as never,
        'nothing.txt': (() => undefined) as never,
        'bytes.txt': (() => [72, 105]) as never,
        'object.txt': (() => ({ length: 2 })) as never,
      },
    });
    for (const path of ['/nothing.csv', '/nothing.txt', '/bytes.txt', '/object.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Something went wrong');
    }
  });

  it('answers 500 without the details when a download cannot be built, and logs them', async () => {
    const failure = new Error('row 3 has a stray quote');
    const warnings: { message: string; err: unknown }[] = [];
    const base = await serve({
      downloads: {
        'sessions.csv': () => {
          throw failure;
        },
        'games.csv': () => 'Game\n',
      },
      log: { warn: (message, err) => warnings.push({ message, err }) },
    });

    const res = await fetch(`${base}/sessions.csv`);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBeNull();
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe('Something went wrong');
    expect(warnings).toEqual([{ message: expect.stringContaining('/sessions.csv'), err: failure }]);

    expect((await fetch(`${base}/games.csv`)).status).toBe(200);
  });

  it('answers 500 for a download when the data cannot be built', async () => {
    const base = await serve({ getData: () => Promise.reject(new Error('no data')), downloads: { 'sessions.csv': csv } });
    const res = await fetch(`${base}/sessions.csv`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Something went wrong');
  });
});

describe('createHistoryHandler: reload', () => {
  it('picks up changed, new and removed files', async () => {
    const clientDir = makeClientDir();
    const base = await serve({ clientDir, reload: true });
    const before = await fetch(`${base}/styles.css`);
    expect(await before.text()).toBe(STYLES_CSS);

    writeFileSync(join(clientDir, 'styles.css'), 'body { color: teal; }\n');
    writeFileSync(join(clientDir, 'charts.ts'), 'export const bars: number[] = [1, 2];\n');
    rmSync(join(clientDir, 'favicon.svg'));

    const after = await fetch(`${base}/styles.css`, { headers: { 'If-None-Match': before.headers.get('etag') ?? '' } });
    expect(after.status).toBe(200);
    expect(await after.text()).toBe('body { color: teal; }\n');
    expect(after.headers.get('etag')).not.toBe(before.headers.get('etag'));
    expect(await (await fetch(`${base}/charts.ts`)).text()).toBe('export const bars           = [1, 2];\n');
    expect((await fetch(`${base}/favicon.svg`)).status).toBe(404);
  });

  it('answers 500 and logs while a .ts file is broken, then recovers', async () => {
    const clientDir = makeClientDir();
    const warnings: { message: string; err: unknown }[] = [];
    const base = await serve({ clientDir, reload: true, log: { warn: (message, err) => warnings.push({ message, err }) } });

    writeFileSync(join(clientDir, 'main.ts'), 'export function label(point: {\n');
    const res = await fetch(`${base}/main.ts`);
    expect(res.status).toBe(500);
    expectSecurityHeaders(res.headers);
    expect(await res.text()).toBe('Something went wrong');
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.err)).toContain('main.ts');

    writeFileSync(join(clientDir, 'main.ts'), MAIN_TS);
    expect((await fetch(`${base}/main.ts`)).status).toBe(200);
  });

  it('answers 500 and logs while the page itself is missing, then recovers', async () => {
    const clientDir = makeClientDir();
    const warnings: string[] = [];
    const base = await serve({ clientDir, reload: true, log: { warn: (message) => warnings.push(message) } });

    rmSync(join(clientDir, 'index.html'));
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Something went wrong');
    expect(warnings).toHaveLength(1);

    writeFileSync(join(clientDir, 'index.html'), INDEX_HTML);
    expect(await (await fetch(`${base}/`)).text()).toBe(INDEX_HTML);
  });

  it('lets a file added to the folder win over a download of the same name', async () => {
    const clientDir = makeClientDir();
    const base = await serve({ clientDir, reload: true, downloads: { 'extra.css': () => 'from the download' } });
    expect(await (await fetch(`${base}/extra.css`)).text()).toBe('from the download');

    writeFileSync(join(clientDir, 'extra.css'), 'p { margin: 0; }\n');
    const res = await fetch(`${base}/extra.css`);
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await res.text()).toBe('p { margin: 0; }\n');
  });
});

describe('createHistoryHandler: every response', () => {
  it('has a Content-Length, is never chunked, and carries the security headers', async () => {
    const base = await serve({
      downloads: {
        'sessions.csv': () => 'Date,Games\n2031-03-01,Pokémon Unite\n',
        'broken.csv': () => {
          throw new Error('made-up failure');
        },
      },
    });
    const cases: [method: string, path: string, status: number][] = [
      ['GET', '/', 200],
      ['GET', '/styles.css', 200],
      ['GET', '/api/history.json', 200],
      ['GET', '/sessions.csv', 200],
      ['GET', '/healthz', 200],
      ['GET', '//', 400],
      ['GET', '/nope', 404],
      ['POST', '/', 405],
      ['DELETE', '/nope', 405],
      ['OPTIONS', '*', 405],
      ['GET', '/broken.csv', 500],
      ['HEAD', '/', 200],
      ['HEAD', '//', 400],
      ['HEAD', '/nope', 404],
      ['HEAD', '/broken.csv', 500],
    ];
    for (const [method, path, status] of cases) {
      const res = await raw(base, path, method);
      expect([method, path, res.status]).toEqual([method, path, status]);
      expect(res.headers['transfer-encoding']).toBeUndefined();
      expect(res.headers['content-length']).toMatch(/^\d+$/);
      if (method !== 'HEAD') expect(res.headers['content-length']).toBe(String(Buffer.byteLength(res.body)));
      expectSecurityHeaders(res.headers);
    }
  });
});

describe('the Host header', () => {
  /** GET / with the given Host header; resolves to the status code. */
  function statusFor(base: string, host: string): Promise<number> {
    const { port } = new URL(base);
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/', headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on('error', reject);
    });
  }

  it('answers under an IP address or localhost, and refuses other names (DNS rebinding)', async () => {
    const base = await serve();
    for (const host of ['127.0.0.1:8480', '192.168.1.20', 'localhost:8480', 'LOCALHOST', '[::1]:8480']) {
      expect(await statusFor(base, host), host).toBe(200);
    }
    for (const host of ['evil.example:8480', 'nas.local', '127.0.0.1.evil.example', 'localhost.evil.example']) {
      expect(await statusFor(base, host), host).toBe(421);
    }
  });

  it('answers under the names the owner allowed', async () => {
    const base = await serve({ allowedHosts: ['nas.local'] });
    expect(await statusFor(base, 'nas.local:8480')).toBe(200);
    expect(await statusFor(base, 'NAS.local')).toBe(200);
    expect(await statusFor(base, 'other.local')).toBe(421);
  });
});
