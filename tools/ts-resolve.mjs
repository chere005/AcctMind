/**
 * A resolver hook so Node can import `packages/core` directly.
 *
 * Core is written for a bundler: `moduleResolution: "Bundler"`, so its
 * internal imports are extensionless (`./money`), which is what Metro needs
 * and what Node's ESM resolver refuses. Rather than give core a build step —
 * the whole point is that six surfaces consume the same source — this hook
 * appends `.ts` for relative specifiers that have no extension.
 *
 * Synchronous hooks via `registerHooks`, not the older async `register`:
 * the async form is deprecated as of Node 26 and prints a warning into the
 * output of every tool that uses it.
 *
 *   node --import ./tools/register-ts.mjs script.mjs
 */
export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    try {
      return next(specifier + '.ts', context);
    } catch {
      // Fall through: a directory import, or something that genuinely has no
      // extension, should fail with ITS error rather than this one.
    }
  }
  return next(specifier, context);
}
