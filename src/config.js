// -----------------------------------------------------------------------------
// Configuration of the Fast.com integration.
//
// Fields of the config_schema (no account, no key: Fast.com is public):
//   - `test_interval`   minutes between two automatic tests, `0` = only on
//                       demand (widget button, configuration action, scene).
//                       A test moves hundreds of megabytes on a fast line:
//                       every 3 hours by default, every 30 minutes at most;
//   - `max_duration`    seconds per direction at most (download, then
//                       upload): a test usually stops earlier, once the
//                       speed is stable;
//   - `measure_upload`  measure the upload too (half of the data);
//   - `language`        language of the feature names (`auto` = the
//                       language of the last widget displayed).
//
// Internal key, outside the config_schema: the language of the last widget
// request.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];
const AUTO_LANGUAGE = 'auto';

// Minutes; '0' = no automatic test. Strings: the values of a select.
const TEST_INTERVALS = ['30', '60', '120', '180', '360', '720', '1440', '0'];
const DEFAULT_INTERVAL = '180';
// Seconds per direction.
const MAX_DURATIONS = ['10', '15', '20', '30'];
const DEFAULT_MAX_DURATION = '15';

const INTERNAL_KEYS = { language: 'last_language' };

/**
 * @description Read a select value among its options.
 * @param {unknown} raw - The raw value (a string, or a number from an old form).
 * @param {string[]} options - The allowed values.
 * @param {string} fallback - The default.
 * @returns {string} The value.
 * @example
 * readOption(60, TEST_INTERVALS, '180'); // -> '60'
 */
function readOption(raw, options, fallback) {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  return options.includes(value) ? value : fallback;
}

/**
 * @description Read a boolean (the form may send 'true' / 'false').
 * @param {unknown} raw - The raw value.
 * @param {boolean} fallback - The default.
 * @returns {boolean} The value.
 * @example
 * readBoolean('false', true); // -> false
 */
function readBoolean(raw, fallback) {
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return fallback;
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {{ intervalMinutes: number, maxDurationSeconds: number, measureUpload: boolean, language: string }} The config.
 * @example
 * normalizeConfig({ test_interval: '60' }).intervalMinutes; // -> 60
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  return {
    intervalMinutes: Number(readOption(config.test_interval, TEST_INTERVALS, DEFAULT_INTERVAL)),
    maxDurationSeconds: Number(
      readOption(config.max_duration, MAX_DURATIONS, DEFAULT_MAX_DURATION),
    ),
    measureUpload: readBoolean(config.measure_upload, true),
    language: LANGUAGES.includes(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 * @example
 * readLanguage({ last_language: 'fr' }, 'en'); // -> 'fr'
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return typeof language === 'string' && LANGUAGES.includes(language) ? language : fallback;
}

export {
  LANGUAGES,
  AUTO_LANGUAGE,
  TEST_INTERVALS,
  DEFAULT_INTERVAL,
  MAX_DURATIONS,
  DEFAULT_MAX_DURATION,
  INTERNAL_KEYS,
  readOption,
  readBoolean,
  normalizeConfig,
  readLanguage,
};
