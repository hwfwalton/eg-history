// The site: serves the session history page from the record's files (see README). Settings come
// from the environment (config.ts); `npm run dev` reads them from .env.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadConfig, type Config } from './config.ts';
import { log } from './log.ts';
import { formatCsv } from './record.ts';
import { createHistoryHandler } from './server.ts';
import { gamesExport, sessionsExport } from './stats.ts';
import { GAMES_FILE, SESSIONS_FILE, createHistoryStore } from './store.ts';

/** The page itself: index.html, styles.css and its TypeScript modules. */
const CLIENT_DIR = join(import.meta.dirname, 'client');

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  log.error(`Configuration error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', err));

const store = createHistoryStore({ dir: config.dataDir, title: config.title, timezone: config.timezone });
const handler = createHistoryHandler({
  clientDir: CLIENT_DIR,
  getData: () => store.getData(),
  downloads: {
    [SESSIONS_FILE]: (data) => formatCsv(sessionsExport(data)),
    [GAMES_FILE]: (data) => formatCsv(gamesExport(data)),
  },
  // While developing, pick up edits to the page without restarting.
  reload: config.reload,
  allowedHosts: config.allowedHosts,
  log,
});

const server = createServer(handler);
// The page only ever answers small GET requests, so slow or stuck clients are dropped early.
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.timeout = 30_000;
server.maxConnections = 64;
// Serving the page is all this program does, so not being able to is fatal (e.g. the port is in use).
server.on('error', (err) => {
  log.error(`Could not listen on ${config.host}:${config.port}`, err);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.info(`Serving http://${shownHost}:${config.port}/ (record in ${config.dataDir})`);
});

// Docker sends SIGTERM on stop/restart: finish the requests under way instead of being killed.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    // Keep-alive connections would hold close() open until they time out.
    server.closeIdleConnections();
    // Never hang on a stuck client.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
