/**
 * The suite's clock, pinned where every platform can read it.
 *
 * The `test` script used to be `TZ=America/Chicago vitest` — a POSIX env
 * prefix, which cmd.exe does not understand. On the Windows runner npm ran it
 * through `cmd /d /s /c` and the whole job died with
 *
 *     'TZ' is not recognized as an internal or external command
 *
 * so the core suite never ran there at all. Setting it here instead works the
 * same on every shell: this file is loaded in vitest's main process before any
 * worker forks, and the workers inherit the environment.
 *
 * WHY PIN IT AT ALL, given the suite passes under UTC today: the server keeps
 * America/Chicago, and CalMind lost an evening to a server that did not — the
 * widget called tomorrow "today" between 7pm Chicago and midnight UTC. A local
 * run that agrees with the server is how that class of bug shows up here
 * rather than in production. `test/timezone.test.ts` asserts the pin actually
 * took, because a pin that silently stops applying is worse than none.
 */
process.env.TZ = 'America/Chicago';

import { defineConfig } from 'vitest/config';

export default defineConfig({});
