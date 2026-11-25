// Dates in the community's timezone. The same helpers as the bot's live.ts, minus what only the bot
// needs: "today" decides which sessions count as past and whether next.json is still current.

/** Whether Intl knows the timezone, e.g. "America/Los_Angeles". */
export function isTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD in that timezone. Throws for a timezone Intl doesn't know. */
export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * A short name for the timezone: "PT" for America/Los_Angeles. Zones with no year-round
 * abbreviation get their short name at that moment ("GMT+1", "UTC"). Undefined if Intl can't say.
 */
export function timezoneLabel(timezone: string, at: Date): string | undefined {
  const name = (style: 'shortGeneric' | 'short') =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  try {
    // Outside North America the generic name is spelled out ("Germany Time"), which isn't short.
    const generic = name('shortGeneric');
    return generic && /^[A-Z]{2,5}$/.test(generic) ? generic : name('short');
  } catch {
    return undefined; // not a timezone Intl knows
  }
}
