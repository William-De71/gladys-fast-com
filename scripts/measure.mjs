// A real Fast.com test from this machine, outside Gladys (development only:
// it downloads and uploads hundreds of megabytes).
//   node scripts/measure.mjs            download + upload
//   node scripts/measure.mjs --no-upload
//   docker run --rm --cpus 0.5 --memory 256m -v "$PWD":/app -w /app node:24-alpine \
//     node scripts/measure.mjs          the limits of the Gladys container
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createFastApi } from '../src/fast-api.js';
import { createHttpsTransport, runSpeedtest } from '../src/speedtest.js';

const userAgent = 'gladys-fast-com/dev (+https://github.com/William-De71/gladys-fast-com)';
const upload = !process.argv.includes('--no-upload');
const api = createFastApi({ userAgent });
const delay = monitorEventLoopDelay({ resolution: 10 });
let peakRss = 0;
const rssTimer = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);

const cpuStart = process.cpuUsage();
const wallStart = performance.now();
const { client, targets } = await api.getTargets();
console.log(`Client: ${client.isp} (AS${client.asn}), ${client.city} ${client.country}`);
console.log(`Servers: ${targets.map((t) => `${t.host.split('.')[0]} ${t.city}`).join(', ')}`);
delay.enable();
const result = await runSpeedtest({
  targets,
  transport: createHttpsTransport({ userAgent }),
  upload,
  onPhase: (phase) => console.log(`… ${phase}`),
});
delay.disable();
clearInterval(rssTimer);
const cpu = process.cpuUsage(cpuStart);
const wall = performance.now() - wallStart;
const round = (value, digits = 1) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;
console.log({
  download_mbps: round(result.download_mbps),
  upload_mbps: round(result.upload_mbps),
  latency_ms: round(result.latency_ms),
  jitter_ms: round(result.jitter_ms),
  loaded_latency_ms: round(result.loaded_latency_ms),
  download_mb: round(result.download_bytes / 1e6, 0),
  upload_mb: round(result.upload_bytes / 1e6, 0),
  connections: `${result.download_connections} / ${result.upload_connections}`,
  duration_s: round(result.duration_s),
  server: result.server.host.split('.')[0],
  cpu_share: round((cpu.user + cpu.system) / 1000 / wall, 2),
  event_loop_delay_p50_ms: round(delay.percentile(50) / 1e6),
  event_loop_delay_p99_ms: round(delay.percentile(99) / 1e6),
  peak_rss_mb: round(peakRss / 1e6, 0),
  cpu_limited: result.cpu_limited,
  loop_delay_ms: round(result.loop_delay_ms),
});
