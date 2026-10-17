// Fakes for the tests: Fast.com (the page, its script, the speedtest API)
// behind a `fetch`, a transport serving bytes on timers, a measurement
// engine and a memory store. Tests never touch the network.

import { API_URL, FAST_URL } from '../../src/fast-api.js';

// Saturday 17 October 2026, 10:00 in Paris (08:00 UTC).
const NOW = Date.parse('2026-10-17T08:00:00Z');
const TZ = 'Europe/Paris';
const TOKEN = 'YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A logger keeping its lines.
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep = (level) => (message) => lines.push(`${level} ${message}`);
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error'), debug() {} };
}

const TARGETS = [
  ['ipv4-c001-cdg001-ix.1.oca.nflxvideo.net', 'Paris', 'FR'],
  ['ipv4-c002-cdg001-ix.1.oca.nflxvideo.net', 'Paris', 'FR'],
  ['ipv4-c003-cdg004-ix.1.oca.nflxvideo.net', 'Saint-Denis', 'FR'],
  ['ipv4-c004-ams001-ix.1.oca.nflxvideo.net', 'Amsterdam', 'NL'],
].map(([host, city, country], index) => ({
  name: `https://${host}/speedtest?c=fr&n=12322&v=${index}&e=1760000000&t=sig`,
  url: `https://${host}/speedtest?c=fr&n=12322&v=${index}&e=1760000000&t=sig`,
  location: { city, country },
}));

/**
 * @description A fake Fast.com, as a `fetch`.
 * @returns {Function} The fetch, with `state`.
 */
function fakeFastCom() {
  const state = {
    token: TOKEN,
    scriptName: '/app-0bffe1.js',
    pageDown: false,
    apiDown: false,
    noToken: false,
    calls: [],
  };
  const fetchImpl = async (url, options = {}) => {
    state.calls.push(url);
    if (options.headers?.['user-agent'] !== undefined) {
      state.userAgent = options.headers['user-agent'];
    }
    if (url === FAST_URL) {
      if (state.pageDown) {
        throw new TypeError('fetch failed');
      }
      return new Response(
        `<!DOCTYPE html><html><head><script src="${state.scriptName}"></script></head><body></body></html>`,
        { status: 200 },
      );
    }
    if (url === new URL(state.scriptName, FAST_URL).href) {
      const token = state.noToken ? '' : `token:"${state.token}",urlCount:5`;
      return new Response(`!function(){var a={https:!0,${token}};}();`, { status: 200 });
    }
    if (url.startsWith(API_URL)) {
      if (state.apiDown) {
        throw new TypeError('fetch failed');
      }
      const query = new URL(url).searchParams;
      if (query.get('token') !== state.token) {
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json({
        client: {
          ip: '82.66.249.84',
          asn: '12322',
          isp: 'Free',
          location: { city: 'Bordeaux', country: 'FR' },
        },
        targets: TARGETS,
      });
    }
    throw new TypeError(`Unexpected URL ${url}`);
  };
  fetchImpl.state = state;
  return fetchImpl;
}

/**
 * @description A transport serving bytes on timers: `rates` in Mbit/s per
 * direction, `latency` in ms per host (a function of the probe index, so
 * jitter can be simulated), failures on demand.
 * @param {object} [options] - Options.
 * @returns {object} The transport, with `state`.
 */
function fakeTransport({
  downloadMbps = 400,
  uploadMbps = 100,
  latency = () => 10,
  loadedLatency = () => 25,
  failDownload = false,
  failUpload = false,
  failProbe = () => false,
} = {}) {
  const state = { pools: 0, closed: 0, downloads: 0, uploads: 0, probes: 0, loading: false };
  // Bytes per 10 ms tick of one connection: the line rate shared by them.
  const stream = (mbps, onBytes, signal, active) =>
    new Promise((resolve, reject) => {
      active.count += 1;
      const timer = setInterval(
        () => onBytes(Math.round((mbps * 1e6) / 8 / 100 / active.count)),
        10,
      );
      signal?.addEventListener(
        'abort',
        () => {
          clearInterval(timer);
          active.count -= 1;
          reject(Object.assign(new Error('Aborted'), { code: 'aborted' }));
        },
        { once: true },
      );
      void resolve;
    });
  const active = { download: { count: 0 }, upload: { count: 0 } };
  return {
    state,
    createPool: () => {
      state.pools += 1;
      return { id: state.pools };
    },
    closePool: () => {
      state.closed += 1;
    },
    download: async (url, { onBytes, signal }) => {
      state.downloads += 1;
      assertRange(url);
      if (failDownload) {
        throw new Error('HTTP 503');
      }
      state.loading = true;
      try {
        await stream(downloadMbps, onBytes, signal, active.download);
      } finally {
        state.loading = active.download.count > 0;
      }
    },
    upload: async (url, size, { onBytes, signal }) => {
      state.uploads += 1;
      assertRange(url);
      if (failUpload) {
        throw new Error('HTTP 413');
      }
      await stream(uploadMbps, onBytes, signal, active.upload);
    },
    probe: async (url, { signal }) => {
      if (!/\/speedtest\/range\/0-0\?/.test(url)) {
        throw new Error(`Bad probe URL ${url}`);
      }
      const index = state.probes;
      state.probes += 1;
      const host = new URL(url).hostname;
      if (failProbe(host, index)) {
        throw new Error('ECONNREFUSED');
      }
      const value = state.loading ? loadedLatency(host, index) : latency(host, index);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (signal?.aborted) {
        throw Object.assign(new Error('Aborted'), { code: 'aborted' });
      }
      return value;
    },
  };
}

/**
 * @param {string} url - A range URL.
 * @throws {Error} When it is not `…/speedtest/range/0-N?…`.
 */
function assertRange(url) {
  if (!/\/speedtest\/range\/0-\d+\?/.test(url)) {
    throw new Error(`Bad range URL ${url}`);
  }
}

/** A raw engine result, as runSpeedtest gives it. */
const RAW_RESULT = {
  download_mbps: 923.64,
  upload_mbps: 717.58,
  latency_ms: 10.52,
  jitter_ms: 0.44,
  loaded_latency_ms: 21.47,
  download_bytes: 664_600_576,
  upload_bytes: 647_757_824,
  download_connections: 8,
  upload_connections: 8,
  duration_s: 15.23,
  cpu_limited: false,
  loop_delay_ms: 0.6,
  server: { host: 'ipv4-c003-cdg004-ix.1.oca.nflxvideo.net', city: 'Saint-Denis', country: 'FR' },
};

/**
 * @description A fake engine: resolves the queued results (or throws the
 * queued errors), after the phases, when `release()` is called or at once.
 * @param {object} [options] - `{ manual }`: wait for `release()`.
 * @returns {Function} The engine, with `calls`, `queue`, `release`.
 */
function fakeEngine({ manual = false } = {}) {
  const pending = [];
  const engine = async (params) => {
    engine.calls.push(params);
    params.onPhase?.('latency');
    params.onPhase?.('download');
    if (params.upload) {
      params.onPhase?.('upload');
    }
    if (manual && !engine.released) {
      await new Promise((resolve) => pending.push(resolve));
    }
    engine.released = false;
    const next = engine.queue.shift() ?? RAW_RESULT;
    if (next instanceof Error) {
      throw next;
    }
    return params.upload ? next : { ...next, upload_mbps: null, upload_bytes: 0 };
  };
  engine.calls = [];
  engine.queue = [];
  engine.released = false;
  // Lets the running test end, or the next one if none waits yet.
  engine.release = () => {
    const waiting = pending.splice(0);
    if (waiting.length === 0) {
      engine.released = true;
    }
    waiting.forEach((resolve) => resolve());
  };
  return engine;
}

/**
 * @description A memory store (store.js shape).
 * @param {object} [initial] - `{ last, failure }`.
 * @returns {object} The store, with `saved`.
 */
function memoryStore(initial = { last: null, failure: null }) {
  const store = {
    saved: [],
    data: structuredClone(initial),
    load: async () => structuredClone(store.data),
    save: async (state) => {
      store.data = structuredClone(state);
      store.saved.push(structuredClone(state));
    },
  };
  return store;
}

export {
  NOW,
  TZ,
  TOKEN,
  TARGETS,
  RAW_RESULT,
  silent,
  recordingLogger,
  fakeFastCom,
  fakeTransport,
  fakeEngine,
  memoryStore,
};
