// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids, the fields the Discovery "Update" button compares (category, type,
// unit, min, max, step), and every key of the manifest a scene, a widget or a
// saved configuration refers to.
//
// test/fixtures/discovery.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would have to delete
// and recreate the device, or would lose a scene or a widget setting: never
// update the baseline without a documented migration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { buildDevice } from '../src/device.js';
import { WIDGET_ACTIONS } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baseline = read('./fixtures/discovery.baseline.json');
const manifest = read('../gladys-assistant-integration.json');
const gladys = createFakeGladys();

const ETERNAL = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];
const pick = (feature) =>
  Object.fromEntries(
    ETERNAL.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
const keys = (list) => (list ?? []).map((entry) => entry.key);
const byKey = (list) => new Map((list ?? []).map((entry) => [entry.key, entry]));

test('the device keeps its external ids and the fields Discovery compares, in every language', () => {
  for (const language of LANGUAGES) {
    const device = buildDevice(gladys, language);
    assert.deepEqual(
      {
        external_id: device.external_id,
        should_poll: device.should_poll,
        poll_frequency: device.poll_frequency ?? null,
        features: device.features.map(pick),
      },
      baseline.device,
      language,
    );
    assert.equal(device.name, 'Fast.com');
  }
});

test('category / type / unit couples: datarate/rate in Mbit/s, duration/decimal in ms', () => {
  const units = new Set([UNITS.MEGABITS_PER_SECOND, UNITS.MILLISECONDS]);
  for (const feature of buildDevice(gladys, 'en').features) {
    const couple = `${feature.category}/${feature.type}`;
    assert.ok(
      [
        `${CATEGORIES.DATARATE}/${TYPES.DATARATE.RATE}`,
        `${CATEGORIES.DURATION}/${TYPES.DURATION.DECIMAL}`,
      ].includes(couple),
      couple,
    );
    assert.ok(units.has(feature.unit), feature.unit);
    assert.equal(
      feature.unit,
      feature.category === CATEGORIES.DATARATE ? UNITS.MEGABITS_PER_SECOND : UNITS.MILLISECONDS,
    );
    // Mandatory on every feature, or "Add" fails with 422.
    for (const key of ['min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
    }
    assert.equal(feature.read_only, true);
    assert.equal(feature.keep_history, true);
  }
});

test('no configuration key or action disappears or changes type', () => {
  assert.deepEqual(
    keys(manifest.actions).filter((key) => baseline.manifest.actions.includes(key)),
    baseline.manifest.actions,
  );
  const current = byKey(manifest.config_schema);
  for (const { key, type, options } of baseline.manifest.config_schema) {
    assert.equal(current.get(key)?.type, type, `config_schema.${key}`);
    const values = (current.get(key)?.options ?? []).map((option) => option.value);
    (options ?? []).forEach((value) => assert.ok(values.includes(value), `${key}: ${value}`));
  }
});

test('scene triggers keep their keys, filters, options and variables', () => {
  const current = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = current.get(trigger.key);
    assert.ok(now, `scene_triggers.${trigger.key}`);
    const fields = byKey(now.fields);
    for (const { key, options } of trigger.fields) {
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      const values = (fields.get(key)?.options ?? []).map((option) => option.value);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${trigger.key}.${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
});

test('scene actions keep their keys, fields and outputs; widgets their settings and actions', () => {
  const actions = byKey(manifest.scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = actions.get(action.key);
    assert.ok(now, action.key);
    action.fields.forEach((field) => assert.ok(keys(now.fields).includes(field), field));
    const outputs = byKey(now.outputs);
    for (const { key, type } of action.outputs) {
      assert.equal(outputs.get(key)?.type, type, `${action.key}.${key}`);
    }
  }
  const widgets = byKey(manifest.widgets);
  for (const widget of baseline.manifest.widgets) {
    const now = widgets.get(widget.key);
    assert.ok(now, widget.key);
    const settings = byKey(now.settings);
    for (const { key, options } of widget.settings) {
      assert.ok(settings.has(key), `${widget.key}.${key}`);
      const values = (settings.get(key)?.options ?? []).map((option) => option.value);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${widget.key}.${key}: ${value}`),
      );
    }
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), baseline.manifest.widget_actions);
});
