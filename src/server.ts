// The web server behind the session history page: a fixed set of files from one folder, the page's
// data as JSON, and CSV downloads. It is read-only, and the only input it takes is the request's
// path, which is only ever compared with a table of known routes. No request path is joined onto a
// folder, so there is nothing to traverse.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join } from 'node:path';
import type { HistoryData } from './types.ts';

export interface ClientFile {
  type: string;
  body: Buffer;
  etag: string;
}

const INDEX_FILE = 'index.html';

/** The extensions served from the client folder (besides index.html). Everything else stays private. */
const CLIENT_TYPES = new Map([
  // The page's script is TypeScript with no build step: it is served with its types stripped, still
  // under its .ts name, because stripping leaves `import … from './charts.ts'` as written.
  ['.ts', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

/** The content type a file of the client folder is served with, or undefined if it isn't served. */
function clientType(name: string): string | undefined {
  if (name === INDEX_FILE) return 'text/html; charset=utf-8';
  // Tests and declarations are never the page's code, however the name is capitalised (Chart.Test.ts).
  if (name.startsWith('.') || /\.(test|d)\.ts$/i.test(name)) return undefined;
  return CLIENT_TYPES.get(extname(name));
}

/**
 * The path a browser asks for to get a file of the client folder: "/main.ts", and "/my%20chart.css"
 * or "/caf%C3%A9.svg" for a name with a space or an accent. The URL parser spells it, the same
 * one the handler reads requests with, so the two always agree and the lookup stays an exact match.
 */
function clientRoute(name: string): string {
  // Escaped first: these would end the path, split it, or be dropped by the parser.
  const segment = name.replace(/[%?#\\\t\n\r]/g, (char) => encodeURIComponent(char));
  return new URL(`http://localhost/${segment}`).pathname;
}

function stripTypes(name: string, source: string): Buffer {
  try {
    return Buffer.from(stripTypeScriptTypes(source));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`History page: ${name} can't be turned into JavaScript: ${reason}`, { cause: err });
  }
}

/** Reads the servable files of the client folder: route ("/", "/main.ts", "/styles.css") -> file. */
export function loadClientFiles(clientDir: string): Map<string, ClientFile> {
  const files = new Map<string, ClientFile>();
  for (const name of readdirSync(clientDir)) {
    const type = clientType(name);
    if (!type) continue;
    const path = join(clientDir, name);
    // lstat, not stat: a symlink could point anywhere, so only plain files are served.
    if (!lstatSync(path).isFile()) continue;
    const body = name.endsWith('.ts') ? stripTypes(name, readFileSync(path, 'utf8')) : readFileSync(path);
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    // The page is "/" and nothing else, so it has one address (and one cache entry).
    files.set(name === INDEX_FILE ? '/' : clientRoute(name), { type, body, etag });
  }
  if (!files.has('/')) throw new Error(`History page: no ${INDEX_FILE} in ${clientDir}`);
  return files;
}

export interface HistoryServerOptions {
  clientDir: string;
  getData: () => Promise<HistoryData>;
  /** File name -> its contents, built from the same data, e.g. { 'sessions.csv': (data) => '...' }. Served at /<name> as a download. */
  downloads?: Record<string, (data: HistoryData) => string>;
  /** Re-read the client folder on every request (development). Default: read once, when the handler is created. */
  reload?: boolean;
  /**
   * Host names the page may be opened under, besides IP addresses and "localhost". A request under
   * any other name is refused: that is how a web page elsewhere would try to read this one (DNS rebinding).
   */
  allowedHosts?: string[];
  log?: { warn(message: string, err?: unknown): void };
}

const DATA_ROUTE = '/api/history.json';
const HEALTH_ROUTE = '/healthz';

/** Download names become routes and go into a header, so they are kept to plain file names. */
const DOWNLOAD_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

// The page only ever loads its own files, so everything else is switched off.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** Said for every failure: what went wrong goes to the log, never to the visitor. */
const ERROR_TEXT = 'Something went wrong';

const BOM = '\uFEFF';

interface Reply {
  status: number;
  headers: Record<string, string>;
  /** What a GET is answered with. A HEAD or a 304 sends only its length. */
  body: Buffer;
}

function text(status: number, message: string, headers: Record<string, string> = {}): Reply {
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    body: Buffer.from(message),
  };
}

function json(data: HistoryData): Reply {
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: Buffer.from(JSON.stringify(data)),
  };
}

function download(name: string, content: string): Reply {
  const csv = name.toLowerCase().endsWith('.csv');
  // Excel only reads a CSV as UTF-8 (accents in game names) when it starts with a byte-order mark.
  const body = csv && !content.startsWith(BOM) ? BOM + content : content;
  return {
    status: 200,
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
    body: Buffer.from(body),
  };
}

/**
 * Whether an If-None-Match header names this ETag. A proxy that compresses the file marks the ETag
 * as weak (W/"…") on the way out, so the browser can send it back in that form.
 */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((part) => {
    const tag = part.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

function clientFileReply(file: ClientFile, ifNoneMatch: string | undefined): Reply {
  // no-cache: the browser keeps its copy but asks each time, so an updated page shows up at once.
  const headers = { 'Cache-Control': 'no-cache', ETag: file.etag };
  if (etagMatches(ifNoneMatch, file.etag)) return { status: 304, headers, body: file.body };
  return { status: 200, headers: { 'Content-Type': file.type, ...headers }, body: file.body };
}

/** Whether a Host header names this server: an IP address, localhost, or a name the owner listed. */
function hostAllowed(header: string | undefined, allowed: string[]): boolean {
  // HTTP/1.0 clients send no Host header; there is no name to object to.
  if (header === undefined) return true;
  const host = header.trim().toLowerCase().replace(/:\d+$/, '');
  if (host === 'localhost' || allowed.includes(host)) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:.]+\]$/.test(host);
}

/** The request's path without its query string, or undefined if the URL can't be parsed. */
function pathnameOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function send(req: IncomingMessage, res: ServerResponse, reply: Reply): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(reply.status, { ...SECURITY_HEADERS, ...reply.headers, 'Content-Length': reply.body.length });
  res.end(req.method === 'HEAD' || reply.status === 304 ? undefined : reply.body);
}

export function createHistoryHandler(options: HistoryServerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { clientDir, getData, log } = options;
  const loaded = loadClientFiles(clientDir);
  const clientFiles = options.reload ? () => loadClientFiles(clientDir) : () => loaded;

  // Everything that isn't a client file. Client files are looked up first, so not even one added
  // to the folder later (reload) can be hidden by a download.
  const routes = new Map<string, () => Promise<Reply>>([
    [DATA_ROUTE, async () => json(await getData())],
    [HEALTH_ROUTE, async () => text(200, 'ok')],
  ]);
  for (const [name, build] of Object.entries(options.downloads ?? {})) {
    if (!DOWNLOAD_NAME.test(name)) {
      throw new Error(`History page: bad download name ${JSON.stringify(name)} (use letters, digits, ".", "_" and "-", not starting with a dot)`);
    }
    const route = `/${name}`;
    if (name === INDEX_FILE || loaded.has(route) || routes.has(route)) {
      throw new Error(`History page: the download name "${name}" is already taken by the page`);
    }
    routes.set(route, async () => {
      // Awaited although it should be a string: a rejected promise nobody waits for would stop the server.
      const content: unknown = await build(await getData());
      if (typeof content !== 'string') throw new TypeError(`The download ${name} was not built as text`);
      return download(name, content);
    });
  }

  // A logger that throws mustn't take a request (or the process) down with it.
  const warn = (message: string, err: unknown): void => {
    try {
      log?.warn(message, err);
    } catch {
      // Nothing left to report it to.
    }
  };

  async function answer(req: IncomingMessage): Promise<Reply> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    if (!hostAllowed(req.headers.host, options.allowedHosts ?? [])) return text(421, 'This page is not served under that name');
    const pathname = pathnameOf(req.url);
    if (pathname === undefined) return text(400, 'Bad request');

    let files: Map<string, ClientFile>;
    try {
      files = clientFiles();
    } catch (err) {
      // Only in reload mode, e.g. a page script saved halfway through an edit.
      warn("History page: couldn't read the page's files", err);
      return text(500, ERROR_TEXT);
    }
    const file = files.get(pathname);
    if (file) return clientFileReply(file, req.headers['if-none-match']);

    const route = routes.get(pathname);
    if (!route) return text(404, 'Not found');
    try {
      return await route();
    } catch (err) {
      // `pathname` is one of our own route names here, so it is safe to log.
      warn(`History page: ${pathname} failed`, err);
      return text(500, ERROR_TEXT);
    }
  }

  return (req, res) => {
    // An 'error' event nobody listens for would be thrown, and stop the server.
    res.on('error', (err) => warn('History page: sending a response failed', err));
    answer(req)
      .then((reply) => send(req, res, reply))
      .catch((err: unknown) => {
        // answer() handles its own failures, so this is a bug. Close the connection rather than leave it waiting.
        warn('History page: request failed', err);
        res.destroy();
      });
  };
}
