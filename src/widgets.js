// -----------------------------------------------------------------------------
// The dashboard widget (pure builder: app.js serves it and runs the button).
//
//   speedtest  the last result (download, upload, latency tiles), the
//              history chart of the device features (speeds or latency,
//              over a day to three months), latency under load, jitter,
//              server, data used, next test, and "Run a test".
//
// The tiles come from the last result (shown even before the device is
// added); the chart reads the history of the device features, so it needs
// the device to be added (the widget says so otherwise).
// -----------------------------------------------------------------------------

import { t, ago, clockTime, formatData, formatNumber, LANGUAGES } from './i18n.js';
import { serverOf } from './result.js';

const WIDGETS = { SPEEDTEST: 'speedtest' };
const WIDGET_ACTIONS = { RUN_TEST: 'run_test' };
const CHARTS = { SPEEDS: 'speeds', LATENCY: 'latency', NONE: 'none' };
const INTERVALS = ['last-day', 'last-three-days', 'last-week', 'last-month', 'last-three-months'];
const DEFAULT_INTERVAL = 'last-week';
// While a test runs the content changes every few seconds; otherwise only
// at the end of a test, which asks for a refresh itself.
const TTL_SECONDS = { running: 10, idle: 300 };
const UNIT_RATE = 'Mbit/s';
const UNIT_DELAY = 'ms';

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const allLanguages = (key) => Object.fromEntries(LANGUAGES.map((lang) => [lang, t(key, lang)]));

/**
 * @description The run button.
 * @returns {object} The button.
 */
const runButton = () => ({
  type: 'button',
  label: allLanguages('buttonRun'),
  icon: 'play',
  style: 'primary',
  action: { key: WIDGET_ACTIONS.RUN_TEST },
});

/**
 * @description The `speedtest` widget.
 * @param {object} params - Parameters.
 * @param {object|null} params.last - The last result (result.js).
 * @param {object|null} params.failure - The failure in progress `{ reason, at, since, count }`.
 * @param {string|null} params.phase - The phase of the running test, null when idle.
 * @param {object|null} params.features - The external ids of the created
 *   features by key (`{ download: 'ext:…' }`), null when the device is not added.
 * @param {object} [params.settings] - `{ chart, interval }`.
 * @param {string} params.language - The language.
 * @param {number} params.now - Now (ms).
 * @param {number|null} params.nextAt - The next automatic test, null when on demand.
 * @param {string} [params.timeZone] - The time zone of the clock times.
 * @returns {object} The content.
 */
function buildSpeedtestWidget({
  last,
  failure,
  phase,
  features,
  settings = {},
  language,
  now,
  nextAt,
  timeZone,
}) {
  const chart = Object.values(CHARTS).includes(settings.chart) ? settings.chart : CHARTS.SPEEDS;
  const interval = INTERVALS.includes(settings.interval) ? settings.interval : DEFAULT_INTERVAL;
  const components = [];

  // 1. what this is about: running, or the provider and the date of the last test
  if (phase) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(`${t('running', language)} ${t(`phase_${phase}`, language)}`, 80),
    });
  } else if (last) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(
        t('captionResult', language, {
          isp: last.isp || 'Fast.com',
          ago: ago(last.at, now, language),
        }),
        80,
      ),
    });
  }

  // 2. the last values
  if (last) {
    components.push({
      type: 'value',
      label: t('tileDownload', language),
      value: last.download_mbps,
      unit: UNIT_RATE,
      icon: 'download',
    });
    if (last.upload_mbps !== null) {
      components.push({
        type: 'value',
        label: t('tileUpload', language),
        value: last.upload_mbps,
        unit: UNIT_RATE,
        icon: 'upload',
      });
    }
    components.push({
      type: 'value',
      label: t('tileLatency', language),
      value: last.latency_ms,
      unit: UNIT_DELAY,
      icon: 'clock',
    });
  }

  // 3. the history of the device
  const series =
    chart === CHARTS.SPEEDS
      ? [features?.download, features?.upload]
      : [features?.latency, features?.loaded_latency, features?.jitter];
  const bound = series.filter(Boolean);
  if (chart !== CHARTS.NONE && bound.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: t(chart === CHARTS.SPEEDS ? 'chartSpeeds' : 'chartLatency', language),
      device_features: bound,
      interval,
    });
  }

  // 4. the one thing to know
  const failedLast = failure && (!last || failure.at > last.at);
  let body = null;
  if (failedLast) {
    body = t('lastFailed', language, {
      ago: ago(failure.at, now, language),
      reason: t(`reason_${failure.reason}`, language),
    });
  } else if (!last && !phase) {
    body = t('noResult', language);
  } else if (last?.cpu_limited) {
    body = t('cpuLimited', language);
  } else if (chart !== CHARTS.NONE && bound.length === 0 && last) {
    body = t('addDevice', language);
  }
  if (body) {
    components.push({ type: 'text', variant: 'body', text: clip(body, 300) });
  }

  // 5. the details
  const rows = [];
  if (failedLast) {
    rows.push({
      label: t('rowStatus', language),
      value: clip(t(`reason_${failure.reason}`, language), 40),
      color: 'danger',
    });
  }
  if (last) {
    rows.push({
      label: t('rowLoaded', language),
      value:
        last.loaded_latency_ms === null
          ? t('notMeasured', language)
          : `${formatNumber(last.loaded_latency_ms, language)} ${UNIT_DELAY}`,
      icon: 'activity',
    });
    rows.push({
      label: t('rowJitter', language),
      value: `${formatNumber(last.jitter_ms, language)} ${UNIT_DELAY}`,
      icon: 'bar-chart-2',
    });
    rows.push({
      label: t('rowServer', language),
      value: clip(serverOf(last), 40),
      icon: 'server',
    });
    rows.push({
      label: t('rowData', language),
      value: formatData(last.data_used_mb, language),
      icon: 'hard-drive',
    });
  }
  rows.push({
    label: t('rowNext', language),
    value: nextAt ? clockTime(nextAt, now, language, timeZone) : t('onDemand', language),
    icon: 'calendar',
  });
  components.push({ type: 'status', items: rows });

  // 6. the action
  components.push(runButton());
  return { ttl_seconds: phase ? TTL_SECONDS.running : TTL_SECONDS.idle, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  CHARTS,
  INTERVALS,
  DEFAULT_INTERVAL,
  TTL_SECONDS,
  buildSpeedtestWidget,
};
