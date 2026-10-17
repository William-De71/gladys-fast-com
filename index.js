// -----------------------------------------------------------------------------
// Entry point of the Fast.com external integration.
//
// Measures the internet connection with Fast.com, the speed test of Netflix,
// on the Netflix servers closest to the line:
//   - device: "Fast.com", with download, upload, latency at rest, jitter and
//     latency under load (src/device.js);
//   - scene triggers: test completed, test failed, connection restored
//     (src/events.js);
//   - scene action: run a test, with the values as outputs;
//   - dashboard widget: the last result, the history, "Run a test"
//     (src/widgets.js).
//
// Measurement: src/fast-api.js (token and servers) and src/speedtest.js
// (streamed downloads and uploads, latency probes), run by an internal timer.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the time zone of Gladys: the clock times shown follow it)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// DATA_DIR (default /data) is where the last result is kept.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Fast.com integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
