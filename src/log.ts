// Minimal timestamped logger. Docker captures stdout/stderr, so this is all we need for now.

function stamp(level: string, message: string): string {
  return `${new Date().toISOString()} ${level.padEnd(5)} ${message}`;
}

export const log = {
  info: (message: string) => console.log(stamp('INFO', message)),
  warn: (message: string, err?: unknown) => console.warn(stamp('WARN', message), ...(err ? [err] : [])),
  error: (message: string, err?: unknown) => console.error(stamp('ERROR', message), ...(err ? [err] : [])),
};
