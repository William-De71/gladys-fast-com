// -----------------------------------------------------------------------------
// What survives a restart, in /data/state.json (the only writable place of
// the container): the last result (the widget shows it at once, and the next
// automatic test is planned from its date instead of running at every
// restart) and the failure in progress (connection_restored needs its start).
//
// No IP address is stored, only what the widget shows (provider, cities).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'state.json';
const VERSION = 1;

/**
 * @description Read and check the stored state.
 * @param {string} text - The file content.
 * @returns {{ last: object|null, failure: object|null }} The state.
 */
function parseState(text) {
  const empty = { last: null, failure: null };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!raw || raw.version !== VERSION) {
    return empty;
  }
  const last =
    raw.last && Number.isFinite(raw.last.at) && Number.isFinite(raw.last.download_mbps)
      ? raw.last
      : null;
  const failure =
    raw.failure && Number.isFinite(raw.failure.at) && Number.isFinite(raw.failure.since)
      ? raw.failure
      : null;
  return { last, failure };
}

/**
 * @description The store of the state.
 * @param {object} [options] - Options.
 * @param {string} [options.dir] - The directory (DATA_DIR, default /data).
 * @param {object} [options.logger] - Logger.
 * @returns {{ load: Function, save: Function }} The store.
 */
function createStore({ dir = process.env.DATA_DIR || '/data', logger = console } = {}) {
  const path = join(dir, FILE);
  let warned = false;

  return {
    /** @returns {Promise<{ last: object|null, failure: object|null }>} The stored state. */
    async load() {
      try {
        return parseState(await readFile(path, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Unable to read ${path}: ${err.message}`);
        }
        return { last: null, failure: null };
      }
    },

    /**
     * @param {{ last: object|null, failure: object|null }} state - The state.
     * @returns {Promise<void>}
     */
    async save({ last, failure }) {
      try {
        await mkdir(dir, { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: VERSION, last, failure }));
        await rename(temporary, path);
      } catch (err) {
        // Kept in memory anyway: only a restart loses it.
        if (!warned) {
          warned = true;
          logger.warn(`Unable to write ${path}: ${err.message}`);
        }
      }
    },
  };
}

export { FILE, VERSION, parseState, createStore };
