import { isTimezone } from './time.ts';

export interface Config {
  /** Port the page is served on. */
  port: number;
  /** Interface to listen on. Only this machine can reach the default, 127.0.0.1. */
  host: string;
  /** Folder holding the record: sessions.csv, games.csv and (optionally) next.json. */
  dataDir: string;
  /** The page's heading, e.g. the community's name. */
  title: string;
  /** IANA timezone that decides what "today" is on the page. */
  timezone: string;
  /** Extra names the page may be opened under; IP addresses and localhost always work. */
  allowedHosts: string[];
  /** Re-read the page's files on every request (development). */
  reload: boolean;
}

export const DEFAULT_PORT = 8480;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_DATA_DIR = 'data';
export const DEFAULT_TITLE = 'Game night history';
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

type Env = Record<string, string | undefined>;

/** Reads the settings from environment variables. See .env.example for the full list. */
export function loadConfig(env: Env = process.env): Config {
  return {
    port: parsePort(env.PORT?.trim()),
    host: env.HOST?.trim() || DEFAULT_HOST,
    dataDir: env.DATA_DIR?.trim() || DEFAULT_DATA_DIR,
    title: env.TITLE?.trim() || DEFAULT_TITLE,
    timezone: parseTimezone(env.TIMEZONE?.trim()),
    allowedHosts: (env.ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    reload: env.RELOAD?.trim() === '1',
  };
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`PORT "${raw}" isn't a port number (1-65535).`);
  }
  return port;
}

function parseTimezone(raw: string | undefined): string {
  const timezone = raw || DEFAULT_TIMEZONE;
  if (!isTimezone(timezone)) {
    throw new Error(`TIMEZONE "${timezone}" isn't a valid timezone (e.g. America/Los_Angeles).`);
  }
  return timezone;
}
