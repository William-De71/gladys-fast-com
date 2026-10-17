// -----------------------------------------------------------------------------
// The Fast.com integration, wired to a Gladys client.
//
// `createApp(gladys)` registers every handler on the client it receives:
// `new GladysIntegration()` in production (index.js), the fake Gladys of the
// SDK in the tests. Nothing here connects: the caller does, once the
// handlers are registered.
//
// Flow: an internal timer runs a test every `test_interval` minutes (never
// `should_poll`: Gladys polls every 60 s at most, a test moves hundreds of
// megabytes). One test at a time: a second request joins or is refused.
// Each test publishes the five values, a scene event (unless a scene asked
// for it), the connection status and a widget refresh. While tests fail,
// a light check (the server list, a few kilobytes) runs every 5 minutes to
// tell when the connection is back.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { AUTO_LANGUAGE, INTERNAL_KEYS, normalizeConfig, readLanguage } from './config.js';
import { createFastApi } from './fast-api.js';
import { createHttpsTransport, runSpeedtest } from './speedtest.js';
import { createStore } from './store.js';
import { buildResult, serverOf, summaryOf } from './result.js';
import { FEATURES, idsOf, buildDevice, buildStates } from './device.js';
import {
  TRIGGERS,
  ORIGINS,
  EVENT_ORIGINS,
  REASONS,
  reasonOf,
  completedEventData,
  failedEventData,
  restoredEventData,
} from './events.js';
import { WIDGETS, WIDGET_ACTIONS, buildSpeedtestWidget } from './widgets.js';
import { t, all, each, clockTime } from './i18n.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-fast-com/${version} (+https://github.com/William-De71/gladys-fast-com)`;

const ACTIONS = { RUN_TEST: 'run_test', DIAGNOSTIC: 'diagnostic' };
const SCENE_ACTIONS = { RUN_TEST: 'run_test' };

const MINUTE = 60 * 1000;
// The first automatic test after a start without any stored result.
const FIRST_DELAY_MS = MINUTE;
// The light check while tests fail.
const RECOVERY_MS = 5 * MINUTE;
// A whole test (server list, latency, both directions) never lasts longer:
// the scene and configuration actions wait 120 s at most.
const TEST_DEADLINE_MS = 110 * 1000;
const WIDGET_REFRESH_MIN_MS = 10 * 1000;
// setTimeout holds 24.8 days at most.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - The GladysIntegration instance (or the fake one).
 * @param {object} [options] - Options (tests).
 * @param {object} [options.api] - The Fast.com client (fast-api.js).
 * @param {Function} [options.runTest] - `(params) => Promise<raw result>` (runSpeedtest).
 * @param {object} [options.store] - The state store (store.js).
 * @param {Function} [options.now] - Clock.
 * @param {string} [options.timeZone] - Time zone of the clock times (default: TZ).
 * @param {object} [options.logger] - Logger.
 * @returns {object} What the tests look into.
 */
export function createApp(
  gladys,
  {
    api = createFastApi({ userAgent: USER_AGENT }),
    runTest = (params) =>
      runSpeedtest({ ...params, transport: createHttpsTransport({ userAgent: USER_AGENT }) }),
    store,
    now = Date.now,
    timeZone = process.env.TZ,
    logger = sdkLogger,
  } = {},
) {
  const state = store ?? createStore({ logger });
  let config = normalizeConfig();
  let lastLanguage = 'en';
  let createdFeatures = new Set();
  let last = null;
  let failure = null;
  let running = null;
  let nextAt = null;
  let testTimer = null;
  let recoveryTimer = null;
  let lastStatus = null;
  let transport = null;
  let started = false;
  let offered = '';
  const shutdown = new AbortController();
  const widgetRefreshedAt = new Map();
  const widgetTrailing = new Map();

  // --- Helpers ---------------------------------------------------------------------

  /**
   * @description The language of the texts written outside a widget request.
   * @returns {string} The language.
   */
  function textLanguage() {
    return config.language === AUTO_LANGUAGE ? lastLanguage : config.language;
  }

  /**
   * @description Remember the language of a widget request.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (typeof next !== 'string' || !/^(en|fr|de|es)$/.test(next) || next === lastLanguage) {
      return;
    }
    lastLanguage = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
    if (config.language === AUTO_LANGUAGE) {
      // The feature names follow the language of the dashboard.
      offerDevice().catch(() => {});
    }
  }

  /**
   * @description Ask Gladys to refresh the widget: at most once every 10 s,
   * the last request of a burst being sent at the end of the 10 s (the end of
   * a test must always reach the dashboard).
   * @param {string} [key] - The widget key.
   */
  function refreshWidget(key = WIDGETS.SPEEDTEST) {
    const wait = (widgetRefreshedAt.get(key) ?? -Infinity) + WIDGET_REFRESH_MIN_MS - now();
    if (wait > 0) {
      if (!widgetTrailing.has(key)) {
        const timer = setTimeout(() => {
          widgetTrailing.delete(key);
          refreshWidget(key);
        }, wait);
        timer.unref?.();
        widgetTrailing.set(key, timer);
      }
      return;
    }
    widgetRefreshedAt.set(key, now());
    try {
      gladys.requestWidgetRefresh(key);
    } catch (err) {
      logger.debug?.(`Widget refresh not sent: ${err.message}`);
    }
  }

  /**
   * @description Refresh the external ids of the features the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdFeatures = new Set(
        devices.flatMap((device) => (device.features ?? []).map((feature) => feature.external_id)),
      );
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  const deviceCreated = () => createdFeatures.has(idsOf(gladys).feature('download'));

  /**
   * @description The created features by key, null when the device is not added.
   * @returns {object|null} `{ download: 'ext:…', … }`.
   */
  function createdFeatureIds() {
    const ids = idsOf(gladys);
    const found = Object.fromEntries(
      FEATURES.map((feature) => [feature.key, ids.feature(feature.key)]).filter(([, id]) =>
        createdFeatures.has(id),
      ),
    );
    return Object.keys(found).length > 0 ? found : null;
  }

  /**
   * @description Publish a scene event, never failing the caller.
   * @param {string} key - The trigger.
   * @param {object} data - The data.
   */
  function fire(key, data) {
    logger.info(`Scene event ${key}`);
    gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Unable to publish the scene event ${key}: ${err.message}`));
  }

  // --- Publishing ---------------------------------------------------------------------

  /**
   * @description Offer the device on the Discovery screen (again when its
   * feature names change language, or on a scan).
   * @param {boolean} [force] - Even if unchanged.
   * @returns {Promise<void>}
   */
  async function offerDevice(force = false) {
    const device = buildDevice(gladys, textLanguage());
    const signature = JSON.stringify(device.features.map((feature) => feature.name));
    if (!force && signature === offered) {
      return;
    }
    await gladys.publishDiscoveredDevices([device]);
    offered = signature;
  }

  /**
   * @description Publish the values of a result, for the created features.
   * Every test is a new point of the history: all of them, changed or not.
   * @param {object} result - The result.
   * @returns {Promise<void>}
   */
  async function publishResult(result) {
    const states = buildStates(gladys, result, createdFeatures);
    if (states.length === 0) {
      return;
    }
    try {
      await gladys.publishStates(states);
    } catch (err) {
      logger.warn(`Unable to publish the states: ${err.message}`);
    }
  }

  /**
   * @description Publish the transport badge of the device, on change: cloud,
   * or unreachable while Internet is.
   * @returns {Promise<void>}
   */
  async function publishTransport() {
    if (!deviceCreated()) {
      return;
    }
    const next =
      failure?.reason === REASONS.OFFLINE ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
    if (next === transport) {
      return;
    }
    try {
      await gladys.publishTransports([{ external_id: idsOf(gladys).device, transport: next }]);
      transport = next;
    } catch (err) {
      logger.warn(`Unable to publish the transport: ${err.message}`);
    }
  }

  /**
   * @description The connection status of the Configuration screen, from the
   * last result and the failure in progress.
   * @returns {Promise<void>}
   */
  async function reportStatus() {
    const at = (instant) => (language) => clockTime(instant, now(), language, timeZone);
    let connected = true;
    let message;
    if (failure) {
      connected = false;
      const since = at(failure.since);
      message = each((language) =>
        t(
          {
            [REASONS.OFFLINE]: 'statusOffline',
            [REASONS.SERVICE]: 'statusService',
            [REASONS.MEASUREMENT]: 'statusMeasurement',
          }[failure.reason],
          language,
          { since: since(language), count: failure.count, reason: failure.code || failure.reason },
        ),
      );
    } else if (last) {
      const when = at(last.at);
      message = each((language) =>
        t('statusOk', language, { when: when(language), summary: summaryOf(last) }),
      );
    } else {
      message = all(config.intervalMinutes === 0 ? 'statusManual' : 'statusFirst');
    }
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  // --- Tests -----------------------------------------------------------------------------

  /**
   * @description The connection works again after failed tests.
   * @param {object} previous - The failure that ended.
   */
  function restored(previous) {
    logger.info(`Fast.com answers again after ${previous.count} failed test(s)`);
    fire(TRIGGERS.CONNECTION_RESTORED, restoredEventData(previous, now()));
  }

  /**
   * @description Record a failed test (not for a scene test: a scene gets
   * its error, the status of the integration does not change).
   * @param {Error} err - The error.
   * @param {string} origin - Who started it.
   * @returns {Promise<void>}
   */
  async function recordFailure(err, origin) {
    const at = now();
    failure = {
      reason: reasonOf(err),
      code: String(err.code ?? 'error').slice(0, 40),
      message: String(err.message).slice(0, 200),
      at,
      since: failure?.since ?? at,
      count: (failure?.count ?? 0) + 1,
    };
    await state.save({ last, failure });
    if (EVENT_ORIGINS.includes(origin)) {
      fire(TRIGGERS.TEST_FAILED, failedEventData(failure, origin));
    }
    startRecoveryChecks();
  }

  /**
   * @description Run one test. A second request while one runs gets the
   * running one (`{ joined: true }`).
   * @param {string} origin - ORIGINS value.
   * @param {object} [params] - `{ upload }` (default: the configuration).
   * @returns {{ promise: Promise<object>, joined: boolean }} The test.
   */
  function startTest(origin, { upload = config.measureUpload } = {}) {
    if (running) {
      return { promise: running.promise, joined: true };
    }
    const current = { origin, phase: 'latency', promise: null };
    running = current;
    current.promise = (async () => {
      refreshWidget();
      logger.info(`Test started (${origin}${upload ? '' : ', download only'})`);
      try {
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(TEST_DEADLINE_MS)]);
        const { client, targets } = await api.getTargets();
        const raw = await runTest({
          targets,
          upload,
          signal,
          options: { maxDurationMs: config.maxDurationSeconds * 1000 },
          onPhase: (phase) => {
            current.phase = phase;
            refreshWidget();
          },
        });
        const result = buildResult(raw, { client, at: now(), origin });
        logger.info(
          `Test done: ${summaryOf(result)}, under load ${result.loaded_latency_ms ?? '-'} ms, jitter ${result.jitter_ms} ms, server ${result.server_host}, ${result.data_used_mb} MB in ${result.duration_s} s${result.cpu_limited ? ', LIMITED BY THE CPU' : ''}`,
        );
        last = result;
        const previous = origin === ORIGINS.SCENE ? null : failure;
        if (previous) {
          failure = null;
          stopRecoveryChecks();
        }
        await state.save({ last, failure });
        await publishResult(result);
        if (previous) {
          restored(previous);
        }
        if (EVENT_ORIGINS.includes(origin)) {
          fire(TRIGGERS.TEST_COMPLETED, completedEventData(result, origin));
        }
        return result;
      } catch (err) {
        if (shutdown.signal.aborted) {
          throw err;
        }
        logger.warn(`Test failed (${origin}): ${err.message}`);
        if (origin !== ORIGINS.SCENE) {
          await recordFailure(err, origin);
        }
        throw err;
      } finally {
        running = null;
        if (!shutdown.signal.aborted) {
          await publishTransport();
          await reportStatus();
          refreshWidget();
          scheduleNext();
        }
      }
    })();
    return { promise: current.promise, joined: false };
  }

  /**
   * @description Plan the next automatic test, from the last one (a restart
   * does not run a test, unless the planned one is already past).
   */
  function scheduleNext() {
    clearTimeout(testTimer);
    testTimer = null;
    nextAt = null;
    if (!started || config.intervalMinutes === 0 || shutdown.signal.aborted) {
      return;
    }
    const lastAt = Math.max(last?.at ?? 0, failure?.at ?? 0);
    const planned = lastAt ? lastAt + config.intervalMinutes * MINUTE : 0;
    nextAt = Math.max(planned, now() + FIRST_DELAY_MS);
    testTimer = setTimeout(
      () => {
        testTimer = null;
        if (running) {
          scheduleNext();
          return;
        }
        startTest(ORIGINS.SCHEDULE).promise.catch(() => {});
      },
      Math.min(MAX_TIMER_MS, nextAt - now()),
    );
    testTimer.unref?.();
  }

  /** While tests fail: ask for the server list every 5 minutes (a few kilobytes). */
  function startRecoveryChecks() {
    if (recoveryTimer || shutdown.signal.aborted) {
      return;
    }
    recoveryTimer = setInterval(() => {
      if (running || !failure) {
        return;
      }
      api
        .getTargets()
        .then(async () => {
          if (!failure || running) {
            return;
          }
          const previous = failure;
          failure = null;
          stopRecoveryChecks();
          await state.save({ last, failure });
          restored(previous);
          await publishTransport();
          await reportStatus();
          refreshWidget();
        })
        .catch((err) => logger.debug?.(`Still failing: ${err.message}`));
    }, RECOVERY_MS);
    recoveryTimer.unref?.();
  }

  /** Stop the light checks. */
  function stopRecoveryChecks() {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }

  /** Stop the timers. */
  function stopTimers() {
    clearTimeout(testTimer);
    stopRecoveryChecks();
    widgetTrailing.forEach((timer) => clearTimeout(timer));
    widgetTrailing.clear();
    testTimer = null;
  }

  // --- Devices --------------------------------------------------------------------------

  gladys.onSetValue(async () => {
    throw new Error('The Fast.com values are read-only: run a test instead');
  });

  gladys.onScanRequest(async () => {
    await offerDevice(true);
    logger.info('Scan: the Fast.com device is offered');
  });

  // Gladys drops the states of a feature that does not exist yet: publish
  // the last result once the device is created, and refresh the widget.
  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    if (last) {
      await publishResult(last);
    }
    transport = null;
    await publishTransport();
    widgetRefreshedAt.clear();
    refreshWidget();
  });

  gladys.onDeviceDeleted(async () => {
    transport = null;
    await refreshCreatedDevices();
    refreshWidget();
  });

  // --- Dashboard widget -----------------------------------------------------------------

  gladys.onWidgetGet(WIDGETS.SPEEDTEST, async ({ settings = {}, language }) => {
    rememberLanguage(language);
    return buildSpeedtestWidget({
      last,
      failure,
      phase: running?.phase ?? null,
      features: createdFeatureIds(),
      settings,
      language,
      now: now(),
      nextAt,
      timeZone,
    });
  });

  gladys.onWidgetAction(WIDGETS.SPEEDTEST, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.RUN_TEST) {
      throw new Error(`Unknown action ${actionKey}`);
    }
    // The result arrives with the widget refresh: no 30-second spinner.
    const { promise, joined } = startTest(ORIGINS.MANUAL);
    promise.catch(() => {});
    return all(joined ? 'testRunning' : 'testStarted');
  });

  // --- Scene action -----------------------------------------------------------------------
  // A scene gets the values as outputs and never raises a scene event.

  gladys.onSceneAction(SCENE_ACTIONS.RUN_TEST, async (fields = {}) => {
    const upload = fields.upload === undefined ? config.measureUpload : fields.upload !== false;
    const result = await startTest(ORIGINS.SCENE, { upload }).promise;
    return {
      download_mbps: result.download_mbps,
      ...(result.upload_mbps === null ? {} : { upload_mbps: result.upload_mbps }),
      latency_ms: result.latency_ms,
      jitter_ms: result.jitter_ms,
      ...(result.loaded_latency_ms === null ? {} : { loaded_latency_ms: result.loaded_latency_ms }),
      isp: result.isp,
      server_city: result.server_city,
      data_used_mb: result.data_used_mb,
      cpu_limited: result.cpu_limited,
      summary: summaryOf(result),
    };
  });

  // --- Configuration screen actions -------------------------------------------------------

  gladys.onAction(ACTIONS.RUN_TEST, async () => {
    try {
      const result = await startTest(ORIGINS.MANUAL).promise;
      return all('testDone', { summary: summaryOf(result), server: serverOf(result) });
    } catch (err) {
      return each((language) =>
        t('testFailed', language, { reason: t(`reason_${reasonOf(err)}`, language) }),
      );
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    // Gladys passes no DEBUG variable to the container: this writes a summary
    // in the logs (Settings -> Supervision) instead. No IP address.
    const iso = (instant) => (instant ? new Date(instant).toISOString() : 'never');
    const token = api.tokenState();
    const memory = process.memoryUsage();
    logger.info(`[diagnostic] gladys-fast-com ${version}, Node ${process.version}`);
    logger.info(
      `[diagnostic] every ${config.intervalMinutes || 'never (on demand)'} min, ${config.maxDurationSeconds} s per direction at most, upload ${config.measureUpload}, next test ${iso(nextAt)}, running ${running ? `${running.origin}/${running.phase}` : 'no'}`,
    );
    logger.info(
      `[diagnostic] token ${token.present ? `cached since ${iso(token.at)}` : 'not fetched yet'}; device added ${deviceCreated()}, transport ${transport ?? 'not published'}; time zone ${timeZone ?? 'system'}`,
    );
    logger.info(
      `[diagnostic] last test ${last ? `${iso(last.at)} (${last.origin}): ${summaryOf(last)}, under load ${last.loaded_latency_ms ?? '-'} ms, jitter ${last.jitter_ms} ms, ${last.isp || '?'} -> ${last.server_host}, ${last.data_used_mb} MB in ${last.duration_s} s, CPU limited ${last.cpu_limited}` : 'none'}`,
    );
    logger.info(
      `[diagnostic] failure ${failure ? `${failure.reason}/${failure.code} since ${iso(failure.since)}, ${failure.count} test(s), last ${iso(failure.at)}: ${failure.message}` : 'none'}; memory ${Math.round(memory.rss / 1e6)} MB RSS`,
    );
    return all('diagnosticDone');
  });

  // --- Configuration ------------------------------------------------------------------------

  /**
   * @description Reload the configuration.
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      lastLanguage = readLanguage(raw, lastLanguage);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const before = JSON.stringify(config);
    await loadConfig(rawConfig);
    if (before !== JSON.stringify(config)) {
      logger.info(
        `Configuration: every ${config.intervalMinutes || 'never'} min, ${config.maxDurationSeconds} s, upload ${config.measureUpload}`,
      );
      scheduleNext();
      await offerDevice().catch(() => {});
      await reportStatus();
      refreshWidget();
    }
  });

  // --- Connection lifecycle -----------------------------------------------------------------

  gladys.on('connected', async () => {
    await loadConfig();
    if (!started) {
      ({ last, failure } = await state.load());
      started = true;
      if (failure) {
        startRecoveryChecks();
      }
    }
    await refreshCreatedDevices();
    await offerDevice().catch((err) => logger.warn(`Unable to offer the device: ${err.message}`));
    lastStatus = null;
    await publishTransport();
    await reportStatus();
    if (!running) {
      scheduleNext();
    }
    refreshWidget();
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    shutdown.abort();
    stopTimers();
  });

  return {
    startTest,
    scheduleNext,
    stop: stopTimers,
    get last() {
      return last;
    },
    get failure() {
      return failure;
    },
    get nextAt() {
      return nextAt;
    },
    get running() {
      return running;
    },
  };
}

export { ACTIONS, SCENE_ACTIONS, USER_AGENT, RECOVERY_MS, TEST_DEADLINE_MS, FIRST_DELAY_MS };
