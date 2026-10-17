import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { TRIGGERS, EVENT_ORIGINS, REASONS } from '../src/events.js';
import { SCENE_ACTIONS, ACTIONS } from '../src/app.js';
import { WIDGETS, CHARTS, INTERVALS, DEFAULT_INTERVAL } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  TEST_INTERVALS,
  DEFAULT_INTERVAL as DEFAULT_TEST_INTERVAL,
  MAX_DURATIONS,
  DEFAULT_MAX_DURATION,
} from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Fast.com');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-fast-com:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-fast-com/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-fast-com');
  assert.deepEqual(manifest.categories, ['network', 'services']);
});

test('cloud transport only, no permission, Gladys 5.1.0 for the widget and the scenes', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.doesNotMatch(source('../src/app.js'), /GLADYS_PREFER_LOCAL/);
  for (const key of ['location', 'network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  // No button form (that would need 5.2.0).
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/);
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((x) => x.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((x) => x.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((x) => x.key).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual(
    manifest.actions.map((x) => x.key),
    Object.values(ACTIONS),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(\\s*WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(\\s*WIDGETS\\.${key}`), key);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(\\s*SCENE_ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(\\s*ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(TRIGGERS)) {
    assert.match(app, new RegExp(`TRIGGERS\\.${key}`), key);
  }
});

test('mirrors the options and defaults of the code', () => {
  const config = byKey(manifest.config_schema);
  assert.deepEqual(values(config.get('test_interval')), TEST_INTERVALS);
  assert.equal(config.get('test_interval').default, DEFAULT_TEST_INTERVAL);
  assert.deepEqual(values(config.get('max_duration')), MAX_DURATIONS);
  assert.equal(config.get('max_duration').default, DEFAULT_MAX_DURATION);
  assert.equal(config.get('measure_upload').type, 'boolean');
  assert.equal(config.get('measure_upload').default, true);
  // No account: nothing secret in the form.
  assert.ok(manifest.config_schema.every((field) => !['secret', 'oauth2'].includes(field.type)));
  const settings = byKey(byKey(manifest.widgets).get('speedtest').settings);
  assert.deepEqual(values(settings.get('chart')).sort(), Object.values(CHARTS).sort());
  assert.deepEqual(values(settings.get('interval')), INTERVALS);
  assert.equal(settings.get('interval').default, DEFAULT_INTERVAL);
  const triggers = byKey(manifest.scene_triggers);
  for (const key of [TRIGGERS.TEST_COMPLETED, TRIGGERS.TEST_FAILED]) {
    assert.deepEqual(values(byKey(triggers.get(key).fields).get('origin')), EVENT_ORIGINS);
  }
  assert.deepEqual(
    values(byKey(triggers.get(TRIGGERS.TEST_FAILED).fields).get('reason')),
    Object.values(REASONS),
  );
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok((action.outputs ?? []).length <= 20, action.key);
  }
  // A whole test is bounded by 110 s: the scene and configuration actions wait 120 s.
  assert.equal(byKey(manifest.scene_actions).get('run_test').timeout_seconds, 120);
  assert.equal(byKey(manifest.actions).get('run_test').timeout_seconds, 120);
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('no host other than Fast.com, Netflix and GitHub in the code', () => {
  const hosts = new Set();
  for (const file of ['fast-api.js', 'speedtest.js', 'app.js', 'widgets.js', 'store.js']) {
    for (const [, host] of source(`../src/${file}`).matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), [
    // the example of a doc comment
    'a.example',
    'api.fast.com',
    'fast.com',
    // the User-Agent points at the repository
    'github.com',
  ]);
});
