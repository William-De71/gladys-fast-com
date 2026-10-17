// -----------------------------------------------------------------------------
// Scene triggers: what HAPPENS, one event per occurrence, never a snapshot.
//
//   test_completed       a test ended, with its values as variables (a
//                        threshold such as "download below 100 Mbit/s" is a
//                        condition on the device, not a trigger);
//   test_failed          a test could not run: Internet unreachable
//                        (`offline`), Fast.com refusing or changed
//                        (`service`), or no byte measured (`measurement`);
//   connection_restored  Fast.com answers again after failed tests (checked
//                        every few minutes while it fails, a few kilobytes).
//
// Tests started by a scene action never raise an event: a scene must not
// start scenes in turn (the action returns the values itself).
// -----------------------------------------------------------------------------

const TRIGGERS = {
  TEST_COMPLETED: 'test_completed',
  TEST_FAILED: 'test_failed',
  CONNECTION_RESTORED: 'connection_restored',
};

// Who started a test: the timer, a person (widget button, configuration
// action) or a scene action (no event).
const ORIGINS = { SCHEDULE: 'schedule', MANUAL: 'manual', SCENE: 'scene' };
const EVENT_ORIGINS = [ORIGINS.SCHEDULE, ORIGINS.MANUAL];

const REASONS = { OFFLINE: 'offline', SERVICE: 'service', MEASUREMENT: 'measurement' };

// Scalars of at most 1 000 characters (limit of a scene event value).
const MAX_VALUE = 1000;
const cut = (text) => String(text ?? '').slice(0, MAX_VALUE);

/**
 * @description The reason of a failure, from the error codes of fast-api.js
 * and speedtest.js.
 * @param {Error} err - The error.
 * @returns {string} A REASONS value.
 * @example
 * reasonOf({ code: 'unreachable' }); // -> 'offline'
 */
function reasonOf(err) {
  if (['unreachable', 'latency_failed'].includes(err?.code)) {
    return REASONS.OFFLINE;
  }
  if (['token_not_found', 'forbidden', 'bad_response', 'no_targets'].includes(err?.code)) {
    return REASONS.SERVICE;
  }
  return REASONS.MEASUREMENT;
}

/**
 * @description The data of a test_completed event, flat and bounded.
 * @param {object} result - The rounded result (app.js).
 * @param {string} origin - Who started it.
 * @returns {object} The event data.
 */
function completedEventData(result, origin) {
  return {
    origin,
    download_mbps: result.download_mbps,
    upload_mbps: result.upload_mbps,
    latency_ms: result.latency_ms,
    jitter_ms: result.jitter_ms,
    loaded_latency_ms: result.loaded_latency_ms,
    isp: cut(result.isp),
    client_city: cut(result.client_city),
    server_city: cut(result.server_city),
    server_country: cut(result.server_country),
    data_used_mb: result.data_used_mb,
    cpu_limited: result.cpu_limited,
    duration_s: result.duration_s,
    tested_at: new Date(result.at).toISOString(),
  };
}

/**
 * @description The data of a test_failed event.
 * @param {object} failure - `{ reason, message, at, since, count }`.
 * @param {string} origin - Who started the test.
 * @returns {object} The event data.
 */
function failedEventData(failure, origin) {
  return {
    origin,
    reason: failure.reason,
    message: cut(failure.message),
    consecutive_failures: failure.count,
    failing_since: new Date(failure.since).toISOString(),
    failed_at: new Date(failure.at).toISOString(),
  };
}

/**
 * @description The data of a connection_restored event.
 * @param {object} failure - The last failure `{ reason, since, count }`.
 * @param {number} now - When it answered again (ms).
 * @returns {object} The event data.
 */
function restoredEventData(failure, now) {
  return {
    reason: failure.reason,
    outage_minutes: Math.max(0, Math.round((now - failure.since) / 60000)),
    failed_tests: failure.count,
    failing_since: new Date(failure.since).toISOString(),
    restored_at: new Date(now).toISOString(),
  };
}

export {
  TRIGGERS,
  ORIGINS,
  EVENT_ORIGINS,
  REASONS,
  reasonOf,
  completedEventData,
  failedEventData,
  restoredEventData,
};
