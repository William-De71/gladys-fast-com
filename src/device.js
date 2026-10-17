// -----------------------------------------------------------------------------
// The "Fast.com" device: one per Gladys instance, offered on the Discovery
// screen, with five read-only sensors kept in history:
//
//   download        datarate/rate      Mbit/s   (icon "activity")
//   upload          datarate/rate      Mbit/s
//   latency         duration/decimal   ms       at rest (idle line)
//   jitter          duration/decimal   ms
//   loaded_latency  duration/decimal   ms       while the download fills the line
//
// They feed the dashboard tiles, the history charts and the scene conditions
// ("download below 100 Mbit/s"): a threshold is a state, not a trigger.
//
// External ids: ext:<selector>:speedtest:fast[:<feature>]. Nothing of the
// server or of the internet provider in it: they change from a test to the
// next one, the device stays the same.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const DEVICE_TYPE = 'speedtest';
const DEVICE_ID = 'fast';
const DEVICE_NAME = 'Fast.com';

const RATE = {
  category: CATEGORIES.DATARATE,
  type: TYPES.DATARATE.RATE,
  unit: UNITS.MEGABITS_PER_SECOND,
  min: 0,
  // 100 Gbit/s: far above any home line.
  max: 100000,
};
const DELAY = {
  category: CATEGORIES.DURATION,
  type: TYPES.DURATION.DECIMAL,
  unit: UNITS.MILLISECONDS,
  min: 0,
  max: 10000,
};

// Every feature: its key (forever), its name, its value in a result.
const FEATURES = [
  { key: 'download', name: 'featureDownload', spec: RATE, value: (r) => r.download_mbps },
  { key: 'upload', name: 'featureUpload', spec: RATE, value: (r) => r.upload_mbps },
  { key: 'latency', name: 'featureLatency', spec: DELAY, value: (r) => r.latency_ms },
  { key: 'jitter', name: 'featureJitter', spec: DELAY, value: (r) => r.jitter_ms },
  {
    key: 'loaded_latency',
    name: 'featureLoadedLatency',
    spec: DELAY,
    value: (r) => r.loaded_latency_ms,
  },
];

/**
 * @description The external ids of the device.
 * @param {object} gladys - The GladysIntegration instance.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys) => gladys.externalIds(DEVICE_TYPE, DEVICE_ID);

/**
 * @description Build the device.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} language - The language of the feature names.
 * @returns {object} The discovered device.
 */
function buildDevice(gladys, language) {
  const ids = idsOf(gladys);
  return {
    name: DEVICE_NAME,
    external_id: ids.device,
    // Tested by an internal timer (minutes to hours), never polled by Gladys.
    should_poll: false,
    features: FEATURES.map((feature) => ({
      name: t(feature.name, language),
      external_id: ids.feature(feature.key),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...feature.spec,
    })),
  };
}

/**
 * @description The states of a result: the measured values only (an upload
 * not measured, or a latency under load set aside, publishes nothing).
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} result - The rounded result (app.js).
 * @param {Set<string>|null} [only] - Feature external ids to keep (the created ones).
 * @returns {Array<{ device_feature_external_id: string, state: number }>} The states.
 */
function buildStates(gladys, result, only = null) {
  const ids = idsOf(gladys);
  return FEATURES.map((feature) => ({
    device_feature_external_id: ids.feature(feature.key),
    state: feature.value(result),
  })).filter(
    (state) =>
      typeof state.state === 'number' &&
      Number.isFinite(state.state) &&
      (!only || only.has(state.device_feature_external_id)),
  );
}

export { DEVICE_TYPE, DEVICE_ID, DEVICE_NAME, FEATURES, idsOf, buildDevice, buildStates };
