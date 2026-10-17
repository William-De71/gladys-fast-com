// -----------------------------------------------------------------------------
// The measurement, as the official Fast.com web client does it (read from its
// code on 2026-10-17), on the Netflix servers given by the API (fast-api.js):
//
//   latency   POST of an empty body on `…/speedtest/range/0-0` over a warm
//             keep-alive connection: one HTTP round trip (checked against an
//             ICMP ping: same value within 1 ms). The first answer opens the
//             connection (TLS) and is not counted. A few servers are probed,
//             the one with the lowest median wins: median = latency, mean
//             difference between consecutive samples = jitter.
//   download  GET `…/range/0-26214400` on several parallel connections; the
//             bytes are counted as they arrive and dropped at once (never
//             buffered: the container has 256 MB).
//   loaded    latency probes on the best server while the download runs:
//             how much the line delays traffic when it is full (bufferbloat).
//   upload    POST of 25 MB bodies on the same URLs, written chunk by chunk
//             from one shared random buffer, with backpressure.
//
// Each direction starts with few connections, adds some when the line is
// fast, and stops when the speed is stable (or at the maximum duration). The
// result is the rate over the last seconds, after the TCP ramp-up.
//
// The transport is injected: node:https here, a fake one in the tests.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { randomFillSync } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { rangeUrl } from './fast-api.js';

// What the Fast.com client asks for in one request (its MAX_PAYLOAD_BYTES).
const REQUEST_BYTES = 26_214_400;
const UPLOAD_CHUNK_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 3000;
// Event loop delay (90th percentile, beyond the timer resolution) above which
// the process, not the line, sets the pace: the container has 0.5 CPU, and a
// starved process both under-counts the bytes and delays the latency probes
// (measured: 0.1 CPU -> 454 instead of 930 Mb/s, 197 instead of 20 ms).
const CPU_LIMIT_DELAY_MS = 20;
const MONITOR_RESOLUTION_MS = 10;

const DEFAULTS = {
  // latency at rest
  latencyServers: 3,
  latencySamples: 12,
  latencySpacingMs: 80,
  latencyMaxMs: 5000,
  // throughput, per direction
  minDurationMs: 6000,
  maxDurationMs: 15_000,
  sampleMs: 250,
  windowMs: 2000,
  warmupMs: 1500,
  resultSpanMs: 3000,
  stableSamples: 8,
  stability: 0.05,
  minConnections: 2,
  maxConnections: 8,
  // no byte at all after this long: the line is down
  stallMs: 8000,
  // latency under load
  loadedSpacingMs: 250,
};

/** An error of the measurement, with a stable `code` for the user messages. */
class SpeedtestError extends Error {
  /**
   * @param {string} message - The message (logs).
   * @param {string} code - `aborted`, `latency_failed`, `download_failed`,
   *   `upload_failed`.
   */
  constructor(message, code) {
    super(message);
    this.name = 'SpeedtestError';
    this.code = code;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * @description The median of numbers.
 * @param {number[]} values - The values.
 * @returns {number} The median (NaN when empty).
 * @example
 * median([3, 1, 2]); // -> 2
 */
function median(values) {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * @description The jitter of latency samples: mean absolute difference between
 * consecutive samples (the definition of Speedtest.net and RFC 3550 in spirit).
 * @param {number[]} values - The samples, in order.
 * @returns {number} The jitter (0 with fewer than 2 samples).
 * @example
 * jitter([10, 12, 11]); // -> 1.5
 */
function jitter(values) {
  if (values.length < 2) {
    return 0;
  }
  let sum = 0;
  for (let index = 1; index < values.length; index += 1) {
    sum += Math.abs(values[index] - values[index - 1]);
  }
  return sum / (values.length - 1);
}

/**
 * @description Bytes over milliseconds, in megabits per second.
 * @param {number} bytes - The bytes.
 * @param {number} ms - The duration.
 * @returns {number} The speed.
 * @example
 * toMbps(1_250_000, 1000); // -> 10
 */
const toMbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / (ms * 1000) : 0);

/**
 * @description How many connections a measured speed deserves (the official
 * client goes from 1 to 8, more for faster lines).
 * @param {number} mbps - The current speed.
 * @param {{ minConnections: number, maxConnections: number }} options - Bounds.
 * @returns {number} The connections.
 */
function connectionsFor(mbps, { minConnections, maxConnections }) {
  let wanted = minConnections;
  if (mbps > 200) {
    wanted = 8;
  } else if (mbps > 50) {
    wanted = 6;
  } else if (mbps > 10) {
    wanted = 4;
  }
  return Math.max(minConnections, Math.min(maxConnections, wanted));
}

/**
 * @description Watch the event loop delay of the process during a phase.
 * @returns {{ stop: () => number }} `stop()` gives the 90th percentile of the
 *   delay beyond the timer resolution, in ms.
 */
function createLoopMonitor() {
  const histogram = monitorEventLoopDelay({ resolution: MONITOR_RESOLUTION_MS });
  histogram.enable();
  return {
    stop: () => {
      histogram.disable();
      const p90 = histogram.percentile(90) / 1e6;
      return Number.isFinite(p90) ? Math.max(0, p90 - MONITOR_RESOLUTION_MS) : 0;
    },
  };
}

/**
 * @description The HTTPS transport: streamed requests on keep-alive agents.
 * @param {object} [options] - Options.
 * @param {string} [options.userAgent] - The User-Agent.
 * @returns {object} The transport.
 */
function createHttpsTransport({ userAgent = '' } = {}) {
  const baseHeaders = userAgent ? { 'user-agent': userAgent } : {};
  // One random buffer for every upload: a body is never built in memory.
  const payload = randomFillSync(Buffer.alloc(UPLOAD_CHUNK_BYTES));

  /**
   * @description A request that settles once: resolves at the end of the
   * answer, rejects on an error, an HTTP error or the abort signal.
   * @param {string} url - The URL.
   * @param {object} options - https.request options.
   * @param {AbortSignal} signal - Stops it.
   * @param {Function} onResponse - `(res) => void`, the answer.
   * @param {Function} [write] - `async (req) => void`, writes the body.
   * @returns {Promise<void>}
   */
  function request(url, options, signal, onResponse, write) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new SpeedtestError('Aborted', 'aborted'));
        return;
      }
      const req = https.request(url, options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        onResponse(res);
        res.on('end', resolve);
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Answer aborted')));
      });
      const abort = () => {
        req.destroy();
        reject(new SpeedtestError('Aborted', 'aborted'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      req.on('error', reject);
      req.on('close', () => signal?.removeEventListener('abort', abort));
      if (write) {
        write(req).catch((err) => {
          req.destroy();
          reject(err);
        });
      } else {
        req.end();
      }
    });
  }

  return {
    /**
     * @param {number} maxSockets - Connections of the pool.
     * @returns {https.Agent} A keep-alive pool.
     */
    createPool: (maxSockets) => new https.Agent({ keepAlive: true, maxSockets }),

    /** @param {https.Agent} pool - The pool to close. */
    closePool: (pool) => pool.destroy(),

    /**
     * @description Download a range, counting the bytes as they arrive.
     * @param {string} url - The range URL.
     * @param {object} params - `{ pool, onBytes, signal }`.
     * @returns {Promise<void>}
     */
    download: (url, { pool, onBytes, signal }) =>
      request(url, { agent: pool, headers: baseHeaders }, signal, (res) =>
        res.on('data', (chunk) => onBytes(chunk.length)),
      ),

    /**
     * @description Upload `size` bytes, counting them as the socket takes them.
     * @param {string} url - The range URL.
     * @param {number} size - The body size.
     * @param {object} params - `{ pool, onBytes, signal }`.
     * @returns {Promise<void>}
     */
    upload: (url, size, { pool, onBytes, signal }) =>
      request(
        url,
        {
          method: 'POST',
          agent: pool,
          headers: {
            ...baseHeaders,
            'content-type': 'application/octet-stream',
            'content-length': String(size),
          },
        },
        signal,
        (res) => res.resume(),
        async (req) => {
          let written = 0;
          while (written < size) {
            if (signal?.aborted || req.destroyed) {
              return;
            }
            const length = Math.min(payload.length, size - written);
            written += length;
            const flushed = req.write(payload.subarray(0, length), () => onBytes(length));
            if (!flushed) {
              await new Promise((resolve) => {
                const done = () => {
                  req.off('drain', done);
                  req.off('close', done);
                  resolve();
                };
                req.on('drain', done);
                req.on('close', done);
              });
            }
          }
          req.end();
        },
      ),

    /**
     * @description One latency probe: an empty POST, timed to the end of the answer.
     * @param {string} url - The `range/0-0` URL.
     * @param {object} params - `{ pool, signal, now }`.
     * @returns {Promise<number>} The round trip, in ms.
     */
    probe: async (url, { pool, signal, now }) => {
      const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const start = now();
      await request(
        url,
        {
          method: 'POST',
          agent: pool,
          headers: { ...baseHeaders, 'content-length': '0' },
        },
        both,
        (res) => res.resume(),
      );
      return now() - start;
    },
  };
}

/**
 * @description Latency probes on one server: a first one to open the
 * connection, then `count` timed ones.
 * @param {object} transport - The transport.
 * @param {object} target - The server.
 * @param {object} params - `{ count, spacingMs, maxMs, signal, now }`: at most
 *   `count` samples and `maxMs` (a slow server gives fewer samples).
 * @returns {Promise<number[]>} The samples, in ms (empty if it never answered).
 */
async function probeServer(transport, target, { count, spacingMs, maxMs, signal, now }) {
  const pool = transport.createPool(1);
  const url = rangeUrl(target.url, 0);
  const samples = [];
  const start = now();
  try {
    await transport.probe(url, { pool, signal, now });
    for (let index = 0; index < count && !signal?.aborted && now() - start < maxMs; index += 1) {
      samples.push(await transport.probe(url, { pool, signal, now }));
      await sleep(spacingMs, signal);
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new SpeedtestError('Aborted', 'aborted');
    }
    // A server that stops answering keeps the samples it gave.
    if (samples.length === 0) {
      return [];
    }
    void err;
  } finally {
    transport.closePool(pool);
  }
  return samples;
}

/**
 * @description The latency at rest: a few servers in parallel, the best wins.
 * @param {object} transport - The transport.
 * @param {object[]} targets - The servers.
 * @param {object} options - The options.
 * @param {object} context - `{ signal, now }`.
 * @returns {Promise<{ latency: number, jitter: number, target: object }>} The result.
 */
async function measureLatency(transport, targets, options, { signal, now }) {
  const probed = targets.slice(0, options.latencyServers);
  const results = await Promise.all(
    probed.map((target) =>
      probeServer(transport, target, {
        count: options.latencySamples,
        spacingMs: options.latencySpacingMs,
        maxMs: options.latencyMaxMs,
        signal,
        now,
      }),
    ),
  );
  let best = null;
  results.forEach((samples, index) => {
    if (samples.length === 0) {
      return;
    }
    const value = median(samples);
    if (!best || value < best.latency) {
      best = { latency: value, jitter: jitter(samples), target: probed[index] };
    }
  });
  if (!best) {
    throw new SpeedtestError('No Netflix server answered the latency probes', 'latency_failed');
  }
  return best;
}

/**
 * @description One direction: parallel requests, speed sampled every
 * `sampleMs`, stop when stable or at `maxDurationMs`.
 * @param {object} params - Parameters.
 * @param {Function} params.request - `(index, onBytes, signal) => Promise`: one
 *   request of worker `index` (it loops on them).
 * @param {object} params.options - The options.
 * @param {AbortSignal} [params.signal] - Stops the whole test.
 * @param {Function} params.now - Clock (ms).
 * @param {Function} [params.onSample] - `(elapsedMs, mbps) => void`.
 * @param {string} params.code - Error code when nothing was measured.
 * @returns {Promise<{ mbps: number, bytes: number, durationMs: number, connections: number }>} The result.
 */
async function measureThroughput({ request, options, signal, now, onSample, code }) {
  const stop = new AbortController();
  const stopAll = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let bytes = 0;
  let failures = 0;
  let lastError = null;
  const onBytes = (count) => {
    bytes += count;
  };
  const workers = [];

  const startWorker = () => {
    const index = workers.length;
    const loop = async () => {
      while (!stopAll.aborted) {
        try {
          await request(index, onBytes, stopAll);
        } catch (err) {
          if (stopAll.aborted) {
            return;
          }
          failures += 1;
          lastError = err;
          await sleep(200, stopAll);
        }
      }
    };
    workers.push(loop());
  };

  const start = now();
  for (let index = 0; index < options.minConnections; index += 1) {
    startWorker();
  }
  const samples = [{ t: 0, bytes: 0 }];
  let elapsed = 0;
  try {
    while (!stopAll.aborted) {
      await sleep(options.sampleMs, stopAll);
      if (signal?.aborted) {
        break;
      }
      elapsed = now() - start;
      samples.push({ t: elapsed, bytes });
      const windowStart = samples.findLast((sample) => sample.t <= elapsed - options.windowMs);
      const from = windowStart ?? samples[0];
      const current = toMbps(bytes - from.bytes, elapsed - from.t);
      onSample?.(elapsed, current);
      if (bytes === 0 && elapsed >= options.stallMs) {
        break;
      }
      const wanted = connectionsFor(current, options);
      while (workers.length < wanted) {
        startWorker();
      }
      if (elapsed >= options.maxDurationMs) {
        break;
      }
      if (elapsed >= options.minDurationMs) {
        // Stable: the windowed speeds of the last samples stay within ±stability.
        const recent = samples.slice(-options.stableSamples).map((sample) => {
          const base = samples.findLast((other) => other.t <= sample.t - options.windowMs);
          return base ? toMbps(sample.bytes - base.bytes, sample.t - base.t) : 0;
        });
        const low = Math.min(...recent);
        const high = Math.max(...recent);
        if (
          recent.length >= options.stableSamples &&
          low > 0 &&
          high / low <= 1 + options.stability
        ) {
          break;
        }
      }
    }
  } finally {
    stop.abort();
    await Promise.allSettled(workers);
  }
  if (signal?.aborted) {
    throw new SpeedtestError('Aborted', 'aborted');
  }
  if (bytes === 0) {
    const reason = lastError ? `: ${lastError.message}` : '';
    throw new SpeedtestError(`No byte transferred (${failures} failed requests)${reason}`, code);
  }
  // The rate over the last seconds, the ramp-up left out.
  const last = samples[samples.length - 1];
  const spanStart = Math.max(options.warmupMs, last.t - options.resultSpanMs);
  const base =
    samples.findLast((sample) => sample.t <= spanStart) ?? samples[Math.min(1, samples.length - 1)];
  const mbps = last.t > base.t ? toMbps(last.bytes - base.bytes, last.t - base.t) : 0;
  return { mbps, bytes, durationMs: last.t, connections: workers.length };
}

/**
 * @description Run a whole test.
 * @param {object} params - Parameters.
 * @param {object[]} params.targets - The servers (fast-api.js).
 * @param {object} params.transport - The transport.
 * @param {boolean} [params.upload] - Measure the upload too.
 * @param {object} [params.options] - Overrides of DEFAULTS.
 * @param {AbortSignal} [params.signal] - Stops the test (shutdown).
 * @param {Function} [params.now] - Clock (ms).
 * @param {Function} [params.onPhase] - `(phase) => void`: latency, download, upload.
 * @param {Function} [params.monitor] - `() => ({ stop: () => delayMs })`: the
 *   event loop delay watch (createLoopMonitor).
 * @returns {Promise<object>} The result.
 */
async function runSpeedtest({
  targets,
  transport,
  upload = true,
  options: overrides = {},
  signal,
  now = () => performance.now(),
  onPhase,
  monitor = createLoopMonitor,
}) {
  const options = { ...DEFAULTS, ...overrides };
  const started = now();
  onPhase?.('latency');
  const rest = await measureLatency(transport, targets, options, { signal, now });

  // Download, with latency probes on the best server meanwhile.
  onPhase?.('download');
  const downloadPool = transport.createPool(options.maxConnections);
  const probePool = transport.createPool(1);
  const loadedSamples = [];
  const probeStop = new AbortController();
  const probeSignal = signal ? AbortSignal.any([signal, probeStop.signal]) : probeStop.signal;
  const probeUrl = rangeUrl(rest.target.url, 0);
  const prober = (async () => {
    try {
      // Opens the probe connection before the line is full, not counted.
      await transport.probe(probeUrl, { pool: probePool, signal: probeSignal, now });
      await sleep(options.warmupMs, probeSignal);
      while (!probeSignal.aborted) {
        loadedSamples.push(
          await transport.probe(probeUrl, { pool: probePool, signal: probeSignal, now }),
        );
        await sleep(options.loadedSpacingMs, probeSignal);
      }
    } catch {
      // A probe lost under load is not an error of the test.
    }
  })();
  let download;
  const downloadWatch = monitor();
  let downloadDelay;
  try {
    download = await measureThroughput({
      request: (index, onBytes, stopSignal) =>
        transport.download(rangeUrl(targets[index % targets.length].url, REQUEST_BYTES), {
          pool: downloadPool,
          onBytes,
          signal: stopSignal,
        }),
      options,
      signal,
      now,
      code: 'download_failed',
    });
  } finally {
    downloadDelay = downloadWatch.stop();
    probeStop.abort();
    await prober;
    transport.closePool(downloadPool);
    transport.closePool(probePool);
  }

  let up = null;
  let uploadDelay = 0;
  if (upload) {
    onPhase?.('upload');
    const uploadPool = transport.createPool(options.maxConnections);
    const uploadWatch = monitor();
    try {
      up = await measureThroughput({
        request: (index, onBytes, stopSignal) =>
          transport.upload(
            rangeUrl(targets[index % targets.length].url, REQUEST_BYTES),
            REQUEST_BYTES,
            {
              pool: uploadPool,
              onBytes,
              signal: stopSignal,
            },
          ),
        options,
        signal,
        now,
        code: 'upload_failed',
      });
    } finally {
      uploadDelay = uploadWatch.stop();
      transport.closePool(uploadPool);
    }
  }
  const downloadStarved = downloadDelay > CPU_LIMIT_DELAY_MS;

  return {
    download_mbps: download.mbps,
    upload_mbps: up ? up.mbps : null,
    latency_ms: rest.latency,
    jitter_ms: rest.jitter,
    // Fewer than 3 probes under load is not a measure, and a starved process
    // delays the probes itself: no value rather than a wrong one.
    loaded_latency_ms: loadedSamples.length >= 3 && !downloadStarved ? median(loadedSamples) : null,
    cpu_limited: downloadStarved || uploadDelay > CPU_LIMIT_DELAY_MS,
    loop_delay_ms: Math.max(downloadDelay, uploadDelay),
    download_bytes: download.bytes,
    upload_bytes: up ? up.bytes : 0,
    download_connections: download.connections,
    upload_connections: up ? up.connections : 0,
    duration_s: (now() - started) / 1000,
    server: { host: rest.target.host, city: rest.target.city, country: rest.target.country },
  };
}

export {
  DEFAULTS,
  REQUEST_BYTES,
  CPU_LIMIT_DELAY_MS,
  createLoopMonitor,
  SpeedtestError,
  median,
  jitter,
  toMbps,
  connectionsFor,
  createHttpsTransport,
  measureLatency,
  measureThroughput,
  runSpeedtest,
};
