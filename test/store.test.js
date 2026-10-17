import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore, parseState, FILE } from '../src/store.js';
import { normalizeConfig, readLanguage, readOption, readBoolean } from '../src/config.js';
import { buildResult, summaryOf, serverOf } from '../src/result.js';
import { reasonOf, completedEventData } from '../src/events.js';
import { RAW_RESULT, NOW, silent, recordingLogger } from './helpers/fakes.js';

test('the state survives a restart in DATA_DIR, without IP address', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fast-com-'));
  try {
    const store = createStore({ dir, logger: silent });
    assert.deepEqual(await store.load(), { last: null, failure: null }, 'no file yet');
    const last = buildResult(RAW_RESULT, {
      client: { ip: '82.66.249.84', isp: 'Free', city: 'Bordeaux', country: 'FR' },
      at: NOW,
      origin: 'schedule',
    });
    const failure = {
      reason: 'offline',
      code: 'unreachable',
      message: 'x',
      at: NOW,
      since: NOW,
      count: 2,
    };
    await store.save({ last, failure });
    const text = await readFile(join(dir, FILE), 'utf8');
    assert.doesNotMatch(text, /82\.66/);
    assert.deepEqual(await createStore({ dir, logger: silent }).load(), { last, failure });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a broken or foreign file is ignored; an unwritable directory warns once', async () => {
  assert.deepEqual(parseState('{nope'), { last: null, failure: null });
  assert.deepEqual(parseState('{"version":99,"last":{}}'), { last: null, failure: null });
  assert.deepEqual(parseState('{"version":1,"last":{"at":"x"}}'), { last: null, failure: null });
  const dir = await mkdtemp(join(tmpdir(), 'fast-com-'));
  try {
    await writeFile(join(dir, 'blocker'), '');
    const logger = recordingLogger();
    // A file where the directory should be: every write fails.
    const store = createStore({ dir: join(dir, 'blocker', 'data'), logger });
    await store.save({ last: null, failure: null });
    await store.save({ last: null, failure: null });
    assert.equal(logger.lines.filter((line) => line.startsWith('warn')).length, 1);
    await chmod(dir, 0o755);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('configuration: defaults, select values, booleans from the form', () => {
  assert.deepEqual(normalizeConfig(), {
    intervalMinutes: 180,
    maxDurationSeconds: 15,
    measureUpload: true,
    language: 'auto',
  });
  assert.deepEqual(
    normalizeConfig({
      test_interval: 0,
      max_duration: '30',
      measure_upload: 'false',
      language: 'es',
    }),
    { intervalMinutes: 0, maxDurationSeconds: 30, measureUpload: false, language: 'es' },
  );
  // Values outside the options fall back to the defaults.
  assert.equal(normalizeConfig({ test_interval: '5' }).intervalMinutes, 180);
  assert.equal(normalizeConfig({ max_duration: 300 }).maxDurationSeconds, 15);
  assert.equal(readOption(null, ['a'], 'a'), 'a');
  assert.equal(readBoolean(undefined, true), true);
  assert.equal(readBoolean(0, true), false);
  assert.equal(readLanguage({ last_language: 'de' }, 'en'), 'de');
  assert.equal(readLanguage({ last_language: 'it' }, 'en'), 'en');
});

test('results: rounded, summarized, failures classified', () => {
  const result = buildResult(RAW_RESULT, { client: { isp: 'Free' }, at: NOW, origin: 'manual' });
  assert.equal(result.download_mbps, 923.6);
  assert.equal(result.jitter_ms, 0.4);
  assert.equal(result.data_used_mb, 1312);
  assert.equal(summaryOf(result), '↓ 923.6 Mbit/s · ↑ 717.6 Mbit/s · 10.5 ms');
  assert.equal(serverOf(result), 'Saint-Denis (FR)');
  assert.equal(serverOf({ server_city: '', server_country: '', server_host: 'h' }), 'h');
  const noUpload = buildResult(
    { ...RAW_RESULT, upload_mbps: null, loaded_latency_ms: null },
    {
      at: NOW,
      origin: 'scene',
    },
  );
  assert.equal(noUpload.upload_mbps, null);
  assert.equal(noUpload.loaded_latency_ms, null);
  assert.equal(summaryOf(noUpload), '↓ 923.6 Mbit/s · 10.5 ms');
  assert.equal(completedEventData(noUpload, 'manual').upload_mbps, null);
  assert.equal(reasonOf({ code: 'unreachable' }), 'offline');
  assert.equal(reasonOf({ code: 'latency_failed' }), 'offline');
  assert.equal(reasonOf({ code: 'forbidden' }), 'service');
  assert.equal(reasonOf({ code: 'token_not_found' }), 'service');
  assert.equal(reasonOf({ code: 'download_failed' }), 'measurement');
  assert.equal(reasonOf(new Error('x')), 'measurement');
});
