// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// Made-up results (fixed date: Saturday 17 October 2026, 10:00 in Paris; a
// test every 3 hours over the last week, seeded random, an evening dip as on
// a shared line). The chart of the widget is bound to the device features in
// Gladys, which draws their history: here, that history is made up too and
// passed inline, named like the features.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildSpeedtestWidget } = await load('src/widgets.js');
const { buildResult } = await load('src/result.js');
const { FEATURES } = await load('src/device.js');
const { LANGUAGES, t } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-17T08:00:00Z');
const TZ = 'Europe/Paris';
const HOUR = 3600000;

// Mulberry32: the same images at every run.
let seed = 20261017;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const around = (value, spread) => value + (random() - 0.5) * 2 * spread;
const round1 = (value) => Math.round(value * 10) / 10;

// One test every 3 hours over 7 days.
const history = [];
for (let at = NOW - 7 * 24 * HOUR; at <= NOW - 3 * HOUR; at += 3 * HOUR) {
  const hour = new Date(at + 2 * HOUR).getUTCHours();
  const evening = hour >= 19 && hour <= 23 ? 0.72 : 1;
  history.push({
    at,
    download: round1(around(925 * evening, 25)),
    upload: round1(around(705 * (evening < 1 ? 0.9 : 1), 30)),
    latency: round1(around(evening < 1 ? 12.5 : 10.6, 0.6)),
    loaded_latency: round1(around(evening < 1 ? 31 : 20, 3)),
    jitter: round1(Math.max(0.2, around(evening < 1 ? 1.4 : 0.5, 0.3))),
  });
}

const last = buildResult(
  {
    download_mbps: 931.4,
    upload_mbps: 712.8,
    latency_ms: 10.4,
    jitter_ms: 0.4,
    loaded_latency_ms: 19.8,
    download_bytes: 655e6,
    upload_bytes: 612e6,
    duration_s: 16.2,
    cpu_limited: false,
    server: { host: 'ipv4-c070-cdg004-ix.1.oca.nflxvideo.net', city: 'Saint-Denis', country: 'FR' },
  },
  {
    client: { isp: 'Free', city: 'Bordeaux', country: 'FR' },
    at: NOW - 12 * 60000,
    origin: 'schedule',
  },
);
const features = Object.fromEntries(
  FEATURES.map((feature) => [feature.key, `ext:fast-com:speedtest:fast:${feature.key}`]),
);
const byId = Object.fromEntries(FEATURES.map((feature) => [features[feature.key], feature]));

/**
 * @description Replace the device-bound chart by the made-up history, named
 * like the features (what Gladys would draw).
 * @param {object} content - The widget content.
 * @param {string} language - The language.
 * @returns {object} The content.
 */
function withHistory(content, language) {
  return {
    ...content,
    components: content.components.map((component) => {
      if (component.type !== 'chart' || !component.device_features) {
        return component;
      }
      const { device_features: ids, ...chart } = component;
      return {
        ...chart,
        series: ids.map((id) => ({
          name: t(byId[id].name, language),
          points: history.map((point) => ({
            t: new Date(point.at).toISOString(),
            v: point[byId[id].key],
          })),
        })),
      };
    }),
  };
}

const contents = {};
for (const language of LANGUAGES) {
  const common = { last, failure: null, phase: null, features, language, now: NOW, timeZone: TZ };
  contents[language] = {
    speedtest: withHistory(
      buildSpeedtestWidget({
        ...common,
        settings: { chart: 'speeds', interval: 'last-week' },
        nextAt: NOW + 2 * HOUR + 48 * 60000,
      }),
      language,
    ),
    latency: withHistory(
      buildSpeedtestWidget({
        ...common,
        settings: { chart: 'latency', interval: 'last-week' },
        nextAt: NOW + 2 * HOUR + 48 * 60000,
      }),
      language,
    ),
  };
}
const [speedtest] = manifest.widgets;
const meta = { icon: speedtest.icon, label: speedtest.label };
writeFileSync(
  out,
  JSON.stringify({ now: NOW, widgets: { speedtest: meta, latency: meta }, contents }),
);
