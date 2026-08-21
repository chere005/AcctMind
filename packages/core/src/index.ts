/**
 * @acctmind/core — everything AcctMind knows how to do.
 *
 * Consumed as TypeScript source with no build step, by every surface: the
 * Expo app (web, iOS, Android), the Tauri shells, and the test suites. If a
 * rule can be stated in a sentence, it lives in here and has a test; a
 * screen that decides something is a screen that has decided it five other
 * ways on five other platforms.
 */

export * from './types';
export * from './palette';
export * from './money';
export * from './budget';
export * from './day';
export * from './txn';
export * from './store';
export * from './merge';
export * from './sync';
export * from './peer';
export * from './watch';
