import { describe, it, expect } from 'vitest';

/**
 * The pin took.
 *
 * vitest.config.ts sets TZ, and nothing else checks that it worked. It has
 * already failed once in a way nobody would have noticed from a green suite:
 * on Windows the old `TZ=... vitest` prefix was not a variable assignment at
 * all, it was a command name, and the job died. Set the pin some other way —
 * a shell prefix, a CI `env:` block, a config that stops being loaded — and
 * the tests would simply run in whatever zone the machine happened to be in,
 * quietly, with dates an hour or six off the server's.
 */
describe('the test clock', () => {
  it('is America/Chicago, whatever the machine is set to', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Chicago');
  });

  it('and Date agrees — not just Intl', () => {
    // A fixed instant: 2026-01-15T12:00:00Z is 06:00 in Chicago (CST, UTC-6).
    expect(new Date('2026-01-15T12:00:00Z').getHours()).toBe(6);
  });
});
