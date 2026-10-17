// The whole integration against the fake Gladys of the SDK (which checks the
// discovered devices and the states like the host API does), a fake Fast.com
// and a fake measurement engine.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, SCENE_ACTIONS, RECOVERY_MS, FIRST_DELAY_MS } from '../src/app.js';
import { createFastApi } from '../src/fast-api.js';
import { SpeedtestError } from '../src/speedtest.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  NOW,
  TZ,
  RAW_RESULT,
  silent,
  recordingLogger,
  fakeFastCom,
  fakeEngine,
  memoryStore,
} from './helpers/fakes.js';

const PREFIX = 'ext:test-integration';
const DEVICE = `${PREFIX}:speedtest:fast`;
const MINUTE = 60000;
const manifest = JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL('../gladys-assistant-integration.json', import.meta.url),
    'utf8',
  ),
);
const declared = (list, key, field) =>
  manifest[list].find((entry) => entry.key === key)[field].map((entry) => entry.key);

/**
 * @description The integration on a fake Gladys, a fake Fast.com, a fake engine.
 * @param {object} [options] - `{ config, stored, manual, logger }`.
 * @returns {Promise<object>} `{ gladys, app, fast, engine, store, clock }`.
 */
async function startApp({ config = {}, stored, manual = false, logger = silent } = {}) {
  const clock = { now: NOW };
  const fast = fakeFastCom();
  const engine = fakeEngine({ manual });
  const store = memoryStore(stored);
  const gladys = createFakeGladys({ config: { ...config } });
  const app = createApp(gladys, {
    api: createFastApi({ fetchImpl: fast }),
    runTest: engine,
    store,
    now: () => clock.now,
    timeZone: TZ,
    logger,
  });
  await gladys.connect();
  return { gladys, app, fast, engine, store, clock };
}

/**
 * @description Add the offered device, as the user does.
 * @param {object} gladys - The fake Gladys.
 * @returns {Promise<object>} The device.
 */
async function create(gladys) {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE);
  assert.ok(device, 'the device is offered');
  await gladys.fake.deviceCreated(device);
  return device;
}

const widget = async (gladys, options = {}) => {
  const ack = await gladys.fake.widgetGet(WIDGETS.SPEEDTEST, options);
  assert.equal(ack.success, true, ack.error);
  const { content } = ack.data;
  assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
  return content;
};
const texts = (content) =>
  content.components.flatMap((c) => [
    c.text ?? '',
    ...(c.items ?? []).map((item) => `${item.label}=${item.value}`),
  ]);

test('connect: offers the Fast.com device, plans the first test in a minute', async () => {
  const { gladys, app, engine } = await startApp({ config: { language: 'fr' } });
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Fast.com');
  assert.equal(device.external_id, DEVICE);
  assert.deepEqual(
    device.features.map((feature) => feature.name),
    ['Débit descendant', 'Débit montant', 'Latence au repos', 'Gigue', 'Latence en charge'],
  );
  assert.equal(app.nextAt, NOW + FIRST_DELAY_MS);
  assert.equal(engine.calls.length, 0, 'nothing measured at start');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.fr, /premier test/);
  app.stop();
});

test('automatic tests disabled: nothing planned, the status says so', async () => {
  const { gladys, app } = await startApp({ config: { test_interval: '0' } });
  assert.equal(app.nextAt, null);
  assert.match(gladys.fake.connectionStatus.message.en, /Automatic tests disabled/);
  const content = await widget(gladys, { language: 'en' });
  assert.ok(texts(content).includes('Next test=on demand'));
  assert.ok(texts(content).some((text) => /No test yet/.test(text)));
  app.stop();
});

test('the widget button runs one test at a time and the result arrives by refresh', async () => {
  const { gladys, app, engine, store } = await startApp({ manual: true });
  const first = await gladys.fake.widgetAction(WIDGETS.SPEEDTEST, WIDGET_ACTIONS.RUN_TEST);
  assert.match(first.data.message.en, /Test started/);
  assert.equal(
    LANGUAGES.every((language) => first.data.message[language]),
    true,
  );
  const second = await gladys.fake.widgetAction(WIDGETS.SPEEDTEST, WIDGET_ACTIONS.RUN_TEST);
  assert.match(second.data.message.fr, /déjà en cours/);
  // While it runs, the widget says so and asks to be read again soon.
  const runningContent = await widget(gladys, { language: 'fr' });
  assert.equal(runningContent.ttl_seconds, 10);
  assert.match(runningContent.components[0].text, /Test en cours/);
  const promise = app.running.promise;
  engine.release();
  await promise;
  assert.equal(engine.calls.length, 1, 'one test only');
  assert.equal(engine.calls[0].upload, true);
  assert.equal(engine.calls[0].options.maxDurationMs, 15000);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGETS.SPEEDTEST));
  assert.equal(app.last.download_mbps, 923.6);
  assert.equal(app.last.isp, 'Free');
  assert.equal(store.data.last.download_mbps, 923.6, 'kept for a restart');
  assert.doesNotMatch(JSON.stringify(store.data), /82\.66/, 'no IP address stored');
  // A person started it: the scene trigger fires, with the values.
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, TRIGGERS.TEST_COMPLETED);
  assert.equal(event.data.origin, 'manual');
  assert.equal(event.data.download_mbps, 923.6);
  assert.equal(event.data.upload_mbps, 717.6);
  assert.equal(event.data.loaded_latency_ms, 21.5);
  assert.equal(event.data.data_used_mb, 1312);
  // Nothing published before the device is added: Gladys would drop it.
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(app.nextAt, NOW + 180 * MINUTE, 'next one from this test');
  assert.match(gladys.fake.connectionStatus.message.en, /Last test \(10:00 AM\): ↓ 923\.6 Mbit\/s/);
  app.stop();
});

test('adding the device publishes the last result, then every test publishes all values', async () => {
  const { gladys, app } = await startApp();
  await app.startTest('manual').promise;
  await create(gladys);
  const values = Object.fromEntries(
    gladys.fake.states.map((state) => [state.device_feature_external_id, state.state]),
  );
  assert.deepEqual(values, {
    [`${DEVICE}:download`]: 923.6,
    [`${DEVICE}:upload`]: 717.6,
    [`${DEVICE}:latency`]: 10.5,
    [`${DEVICE}:jitter`]: 0.4,
    [`${DEVICE}:loaded_latency`]: 21.5,
  });
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'cloud',
  });
  const before = gladys.fake.states.length;
  await app.startTest('schedule').promise;
  assert.equal(gladys.fake.states.length, before + 5, 'same values again: a new point');
  // The widget now binds its chart to the features.
  const content = await widget(gladys, {
    language: 'en',
    settings: { chart: 'latency', interval: 'last-month' },
  });
  const chart = content.components.find((c) => c.type === 'chart');
  assert.deepEqual(chart.device_features, [
    `${DEVICE}:latency`,
    `${DEVICE}:loaded_latency`,
    `${DEVICE}:jitter`,
  ]);
  assert.equal(chart.interval, 'last-month');
  app.stop();
});

test('scene action: declared outputs only, no scene event, the upload on demand', async () => {
  const { gladys, app, engine } = await startApp({ config: { measure_upload: false } });
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_TEST, { upload: true });
  assert.equal(ack.success, true, ack.error);
  const { outputs } = ack.data;
  const allowed = declared('scene_actions', 'run_test', 'outputs');
  assert.deepEqual(
    Object.keys(outputs).filter((key) => !allowed.includes(key)),
    [],
  );
  assert.equal(outputs.download_mbps, 923.6);
  assert.equal(outputs.upload_mbps, 717.6);
  assert.equal(outputs.summary, '↓ 923.6 Mbit/s · ↑ 717.6 Mbit/s · 10.5 ms');
  for (const value of Object.values(outputs)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
  assert.equal(gladys.fake.sceneEvents.length, 0, 'a scene never starts scenes');
  // Without the field: the configuration (upload off), and no upload output.
  const download = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_TEST, {});
  assert.equal(engine.calls.at(-1).upload, false);
  assert.equal(download.data.outputs.upload_mbps, undefined);
  assert.equal(download.data.outputs.summary, '↓ 923.6 Mbit/s · 10.5 ms');
  assert.equal(gladys.fake.sceneEvents.length, 0);
  app.stop();
});

test('a failed scene test fails the action only: no event, no status change', async () => {
  const { gladys, app, engine } = await startApp();
  engine.queue.push(new SpeedtestError('No byte transferred', 'download_failed'));
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_TEST, {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /No byte/);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(app.failure, null);
  app.stop();
});

test('Internet down: test_failed, unreachable badge, checks every 5 min, connection_restored', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { gladys, app, fast, clock } = await startApp();
    await create(gladys);
    fast.state.apiDown = true;
    fast.state.pageDown = true;
    await assert.rejects(app.startTest('schedule').promise, { code: 'unreachable' });
    const failed = gladys.fake.sceneEvents.at(-1);
    assert.equal(failed.key, TRIGGERS.TEST_FAILED);
    assert.equal(failed.data.reason, 'offline');
    assert.equal(failed.data.consecutive_failures, 1);
    assert.equal(failed.data.origin, 'schedule');
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.match(gladys.fake.connectionStatus.message.fr, /Internet injoignable depuis 10:00/);
    assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
    const content = await widget(gladys, { language: 'en' });
    assert.ok(texts(content).some((text) => /Last test failed just now/.test(text)));
    // Still down at the first check.
    clock.now += RECOVERY_MS;
    mock.timers.tick(RECOVERY_MS);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.failure.count, 1);
    // Back: the light check sees it.
    fast.state.apiDown = false;
    fast.state.pageDown = false;
    clock.now += RECOVERY_MS;
    mock.timers.tick(RECOVERY_MS);
    for (let i = 0; i < 20 && app.failure; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(app.failure, null);
    const restored = gladys.fake.sceneEvents.at(-1);
    assert.equal(restored.key, TRIGGERS.CONNECTION_RESTORED);
    assert.equal(restored.data.outage_minutes, 10);
    assert.equal(restored.data.failed_tests, 1);
    assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
    assert.equal(gladys.fake.connectionStatus.connected, true);
    app.stop();
  } finally {
    mock.timers.reset();
  }
});

test('a successful test after failures restores the connection, then completes', async () => {
  const { gladys, app, engine } = await startApp();
  engine.queue.push(
    new SpeedtestError('No byte transferred (3 failed requests)', 'download_failed'),
  );
  await assert.rejects(app.startTest('manual').promise);
  assert.equal(gladys.fake.sceneEvents.at(-1).data.reason, 'measurement');
  assert.match(gladys.fake.connectionStatus.message.en, /measured nothing/);
  await app.startTest('schedule').promise;
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.TEST_FAILED, TRIGGERS.CONNECTION_RESTORED, TRIGGERS.TEST_COMPLETED],
  );
  assert.equal(app.failure, null);
  app.stop();
});

test('a restart plans the next test from the stored one, never at once', async () => {
  const last = { ...(await startStoredResult()), at: NOW - 30 * MINUTE };
  const recent = await startApp({ stored: { last, failure: null } });
  assert.equal(recent.app.nextAt, last.at + 180 * MINUTE);
  assert.equal(recent.app.last.download_mbps, 923.6, 'the widget shows it at once');
  recent.app.stop();
  const old = await startApp({ stored: { last: { ...last, at: NOW - 5 * 60 * MINUTE } } });
  assert.equal(old.app.nextAt, NOW + FIRST_DELAY_MS);
  old.app.stop();
});

/**
 * @description A stored result, as the app saves it.
 * @returns {Promise<object>} The result.
 */
async function startStoredResult() {
  const { app } = await startApp();
  await app.startTest('manual').promise;
  app.stop();
  return app.last;
}

test('configuration actions: run a test and wait for it, diagnostic without IP address', async () => {
  const logger = recordingLogger();
  const { gladys, app } = await startApp({ logger });
  const ack = await gladys.fake.action(ACTIONS.RUN_TEST);
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    'Test terminé : ↓ 923.6 Mbit/s · ↑ 717.6 Mbit/s · 10.5 ms (serveur : Saint-Denis (FR)).',
  );
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.match(diagnostic.data.message.en, /Diagnostic written/);
  const logs = logger.lines.join('\n');
  assert.match(logs, /\[diagnostic\] last test .*↓ 923\.6/);
  assert.match(logs, /token cached/);
  assert.doesNotMatch(logs, /82\.66\.249\.84/);
  app.stop();
});

test('configuration: a new interval re-plans, a new language renames the features', async () => {
  const { gladys, app } = await startApp();
  await app.startTest('manual').promise;
  await gladys.fake.configUpdated({ test_interval: '60', language: 'de' });
  assert.equal(app.nextAt, NOW + 60 * MINUTE);
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Download-Geschwindigkeit');
  await gladys.fake.configUpdated({ test_interval: '0', language: 'de' });
  assert.equal(app.nextAt, null);
  app.stop();
});

test('widget contents are valid in every state and language', async () => {
  const { gladys, app, engine } = await startApp();
  for (const language of LANGUAGES) {
    await widget(gladys, { language });
  }
  engine.queue.push({ ...RAW_RESULT, cpu_limited: true, loaded_latency_ms: null });
  await app.startTest('manual').promise;
  for (const language of LANGUAGES) {
    const content = await widget(gladys, { language });
    assert.ok(content.components.length <= 8);
    assert.equal(content.ttl_seconds, 300);
  }
  const limited = await widget(gladys, { language: 'en' });
  assert.ok(texts(limited).some((text) => /processor of Gladys limited/.test(text)));
  assert.ok(texts(limited).includes('Under load=not measured'));
  await create(gladys);
  for (const settings of [{}, { chart: 'latency' }, { chart: 'none' }, { chart: 'bogus' }]) {
    for (const language of LANGUAGES) {
      await widget(gladys, { language, settings });
    }
  }
  const unknown = await gladys.fake.widgetAction(WIDGETS.SPEEDTEST, 'nope');
  assert.equal(unknown.success, false);
  app.stop();
});

test('scene events stay flat and bounded', async () => {
  const { gladys, app, engine } = await startApp();
  await app.startTest('schedule').promise;
  engine.queue.push(new SpeedtestError('x'.repeat(5000), 'upload_failed'));
  await assert.rejects(app.startTest('manual').promise);
  const allowed = Object.fromEntries(
    manifest.scene_triggers.map((trigger) => [trigger.key, trigger.variables.map((v) => v.key)]),
  );
  for (const { key, data } of gladys.fake.sceneEvents) {
    const entries = Object.entries(data);
    assert.ok(entries.length <= 30, key);
    for (const [name, value] of entries) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `${key}.${name}`,
      );
      assert.ok(typeof value !== 'string' || value.length <= 1000, `${key}.${name}`);
      assert.ok(allowed[key].includes(name), `${key}.${name} is declared`);
    }
  }
  app.stop();
});

test('read-only values; shutdown stops the timers', async () => {
  const { gladys, app } = await startApp();
  const device = await create(gladys);
  const ack = await gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
  await gladys.fake.shutdown();
  assert.equal(app.nextAt, NOW + FIRST_DELAY_MS);
});
