/** Installs tools/ts-resolve.mjs. See its header for why core needs one. */
import { registerHooks } from 'node:module';
import { resolve } from './ts-resolve.mjs';

registerHooks({ resolve });
