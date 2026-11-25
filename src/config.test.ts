import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('defaults to port 8480 on this machine only, the data folder and a generic title', () => {
    expect(loadConfig({})).toEqual({
      port: 8480,
      host: '127.0.0.1',
      dataDir: 'data',
      title: 'Game night history',
      timezone: 'America/Los_Angeles',
      allowedHosts: [],
      reload: false,
    });
    // Blank counts as unset (a .env line like "PORT=").
    expect(loadConfig({ PORT: ' ', HOST: '', DATA_DIR: ' ', TITLE: ' ', TIMEZONE: ' ' })).toEqual(loadConfig({}));
  });

  it('reads the port, host, folder and title', () => {
    const env = { PORT: ' 9000 ', HOST: '0.0.0.0', DATA_DIR: ' /srv/history ', TITLE: ' Board Game Club ' };
    expect(loadConfig(env)).toMatchObject({ port: 9000, host: '0.0.0.0', dataDir: '/srv/history', title: 'Board Game Club' });
  });

  it("reads the timezone, and rejects one that doesn't exist", () => {
    expect(loadConfig({ TIMEZONE: 'Europe/Berlin' }).timezone).toBe('Europe/Berlin');
    expect(() => loadConfig({ TIMEZONE: 'Mars/Olympus' })).toThrow('TIMEZONE "Mars/Olympus" isn\'t a valid timezone (e.g. America/Los_Angeles).');
  });

  it('reads the allowed host names, in lower case', () => {
    expect(loadConfig({ ALLOWED_HOSTS: ' NAS.local, games.example.org ,' }).allowedHosts).toEqual(['nas.local', 'games.example.org']);
  });

  it("rejects a PORT that isn't a port number", () => {
    for (const bad of ['0', '65536', '80a', '-1', '8080.5', 'http']) {
      expect(() => loadConfig({ PORT: bad }), bad).toThrow(`PORT "${bad}" isn't a port number (1-65535).`);
    }
  });

  it('reloads the page only for RELOAD=1', () => {
    expect(loadConfig({ RELOAD: '1' }).reload).toBe(true);
    expect(loadConfig({ RELOAD: '0' }).reload).toBe(false);
    expect(loadConfig({ RELOAD: 'yes' }).reload).toBe(false);
  });
});
