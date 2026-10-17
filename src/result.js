// -----------------------------------------------------------------------------
// A measured test as the rest of the integration uses it: rounded values
// (Mbit/s and ms to one decimal), what Netflix says of the line (provider,
// city), the server, the data used. The IP address given by Fast.com is
// dropped here: it is never stored, logged nor published.
// -----------------------------------------------------------------------------

const round1 = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

/**
 * @description Build the result of a test.
 * @param {object} raw - The output of runSpeedtest.
 * @param {object} context - `{ client, at, origin }`: what the API said of
 *   the client, when the test ended, who started it.
 * @returns {object} The result.
 * @example
 * buildResult({ download_mbps: 923.61, … }, { client: { isp: 'Free' }, at: 0, origin: 'schedule' });
 */
function buildResult(raw, { client = {}, at, origin }) {
  return {
    at,
    origin,
    download_mbps: round1(raw.download_mbps),
    upload_mbps: round1(raw.upload_mbps),
    latency_ms: round1(raw.latency_ms),
    jitter_ms: round1(raw.jitter_ms),
    loaded_latency_ms: round1(raw.loaded_latency_ms),
    isp: client.isp ?? '',
    client_city: client.city ?? '',
    client_country: client.country ?? '',
    server_host: raw.server?.host ?? '',
    server_city: raw.server?.city ?? '',
    server_country: raw.server?.country ?? '',
    data_used_mb: Math.round(((raw.download_bytes ?? 0) + (raw.upload_bytes ?? 0)) / 1e6),
    cpu_limited: Boolean(raw.cpu_limited),
    duration_s: round1(raw.duration_s),
  };
}

/**
 * @description One line for the logs, the scene outputs and the messages,
 * the same in every language ("↓ 923.6 Mbit/s · ↑ 717.6 Mbit/s · 10.5 ms").
 * @param {object} result - The result.
 * @returns {string} The summary.
 */
function summaryOf(result) {
  const parts = [`↓ ${result.download_mbps} Mbit/s`];
  if (result.upload_mbps !== null) {
    parts.push(`↑ ${result.upload_mbps} Mbit/s`);
  }
  parts.push(`${result.latency_ms} ms`);
  return parts.join(' · ');
}

/**
 * @description "Paris (FR)".
 * @param {object} result - The result.
 * @returns {string} The server place.
 */
const serverOf = (result) =>
  [result.server_city, result.server_country ? `(${result.server_country})` : '']
    .filter(Boolean)
    .join(' ') || result.server_host;

export { round1, buildResult, summaryOf, serverOf };
