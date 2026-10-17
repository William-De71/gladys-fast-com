import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTargets } from '../src/fast-api.js';
import {
  connectionsFor,
  jitter,
  measureLatency,
  measureThroughput,
  median,
  runSpeedtest,
  toMbps,
  DEFAULTS,
} from '../src/speedtest.js';
import { TARGETS, fakeTransport } from './helpers/fakes.js';

const { targets } = parseTargets({ client: {}, targets: TARGETS });
// Short durations: the fake transport serves bytes every 10 ms.
const FAST = {
  latencySamples: 5,
  latencySpacingMs: 1,
  minDurationMs: 400,
  maxDurationMs: 1200,
  sampleMs: 50,
  windowMs: 200,
  warmupMs: 100,
  resultSpanMs: 300,
  stableSamples: 4,
  stallMs: 600,
  loadedSpacingMs: 20,
};
const quiet = () => ({ stop: () => 0 });

test('statistics: median, jitter, Mbit/s, connections by speed', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(jitter([10, 12, 11]), 1.5);
  assert.equal(jitter([10]), 0);
  assert.equal(toMbps(1_250_000, 1000), 10);
  assert.equal(toMbps(5, 0), 0);
  assert.equal(connectionsFor(5, DEFAULTS), 2);
  assert.equal(connectionsFor(30, DEFAULTS), 4);
  assert.equal(connectionsFor(100, DEFAULTS), 6);
  assert.equal(connectionsFor(900, DEFAULTS), 8);
  assert.equal(connectionsFor(900, { minConnections: 1, maxConnections: 4 }), 4);
});

test('latency: the server with the lowest median wins, its jitter is kept', async () => {
  const transport = fakeTransport({
    latency: (host, index) => (host.startsWith('ipv4-c002') ? 8 + (index % 2) : 15),
  });
  const result = await measureLatency(
    transport,
    targets,
    { ...DEFAULTS, ...FAST },
    { now: () => performance.now() },
  );
  assert.equal(result.target.host, 'ipv4-c002-cdg001-ix.1.oca.nflxvideo.net');
  assert.ok(result.latency >= 8 && result.latency <= 9, `${result.latency}`);
  assert.equal(result.jitter, 1);
  // One pool per probed server, all closed.
  assert.equal(transport.state.pools, 3);
  assert.equal(transport.state.closed, 3);
});

test('latency: a dead server is skipped, all dead is latency_failed', async () => {
  const someDead = fakeTransport({ failProbe: (host) => host.startsWith('ipv4-c001') });
  const result = await measureLatency(
    someDead,
    targets,
    { ...DEFAULTS, ...FAST },
    { now: () => performance.now() },
  );
  assert.notEqual(result.target.host, targets[0].host);
  await assert.rejects(
    measureLatency(
      fakeTransport({ failProbe: () => true }),
      targets,
      { ...DEFAULTS, ...FAST },
      { now: () => performance.now() },
    ),
    { name: 'SpeedtestError', code: 'latency_failed' },
  );
});

test('throughput: measures the served rate, adds connections on a fast line, stops in time', async () => {
  const transport = fakeTransport({ downloadMbps: 400 });
  const started = performance.now();
  const result = await measureThroughput({
    request: (index, onBytes, signal) =>
      transport.download(`${targets[0].url.replace('/speedtest?', '/speedtest/range/0-1?')}`, {
        onBytes,
        signal,
      }),
    options: { ...DEFAULTS, ...FAST },
    now: () => performance.now(),
    code: 'download_failed',
  });
  const elapsed = performance.now() - started;
  // Timers are coarse in CI: a wide band around the served rate.
  assert.ok(result.mbps > 250 && result.mbps < 550, `${result.mbps} Mbit/s`);
  assert.equal(result.connections, 8, '> 200 Mbit/s: eight connections');
  assert.ok(elapsed < FAST.maxDurationMs + 500, `${elapsed} ms`);
  assert.ok(result.bytes > 0);
});

test('throughput: nothing transferred is an error, an abort is aborted', async () => {
  await assert.rejects(
    measureThroughput({
      request: async () => {
        throw new Error('HTTP 503');
      },
      options: { ...DEFAULTS, ...FAST },
      now: () => performance.now(),
      code: 'download_failed',
    }),
    (err) => err.code === 'download_failed' && /HTTP 503/.test(err.message),
  );
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const transport = fakeTransport();
  await assert.rejects(
    measureThroughput({
      request: (index, onBytes, signal) =>
        transport.download(targets[0].url.replace('/speedtest?', '/speedtest/range/0-1?'), {
          onBytes,
          signal,
        }),
      options: { ...DEFAULTS, ...FAST },
      signal: controller.signal,
      now: () => performance.now(),
      code: 'download_failed',
    }),
    { code: 'aborted' },
  );
});

test('a whole test: latency, download with probes under load, upload', async () => {
  const transport = fakeTransport({ downloadMbps: 300, uploadMbps: 60 });
  const phases = [];
  const result = await runSpeedtest({
    targets,
    transport,
    options: FAST,
    onPhase: (phase) => phases.push(phase),
    monitor: quiet,
  });
  assert.deepEqual(phases, ['latency', 'download', 'upload']);
  assert.ok(result.download_mbps > 150 && result.download_mbps < 450, `${result.download_mbps}`);
  assert.ok(result.upload_mbps > 30 && result.upload_mbps < 90, `${result.upload_mbps}`);
  assert.equal(result.latency_ms, 10);
  assert.equal(result.loaded_latency_ms, 25, 'probes while the download runs');
  assert.equal(result.cpu_limited, false);
  assert.ok(result.download_bytes > 0 && result.upload_bytes > 0);
  assert.ok(result.server.host.endsWith('.oca.nflxvideo.net'));
  assert.ok(transport.state.closed >= transport.state.pools, 'every pool closed');
});

test('download only; a starved process drops the latency under load', async () => {
  const transport = fakeTransport();
  const result = await runSpeedtest({
    targets,
    transport,
    upload: false,
    options: FAST,
    monitor: () => ({ stop: () => 185 }),
  });
  assert.equal(result.upload_mbps, null);
  assert.equal(result.upload_bytes, 0);
  assert.equal(transport.state.uploads, 0);
  assert.equal(result.cpu_limited, true);
  assert.equal(result.loaded_latency_ms, null, 'the probes were delayed by the process');
});

test('a failing upload fails the test with upload_failed', async () => {
  await assert.rejects(
    runSpeedtest({
      targets,
      transport: fakeTransport({ failUpload: true }),
      options: FAST,
      monitor: quiet,
    }),
    { code: 'upload_failed' },
  );
});
