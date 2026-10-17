# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-17

### Added

- A Fast.com device with five read-only values kept in history: download and upload speed (Mbit/s), latency at rest, jitter and latency under load (ms).
- Speed tests on the Netflix servers given by Fast.com, as its web client does them: latency probes, streamed parallel downloads and uploads (nothing buffered), adaptive connections, stop once the speed is stable, a whole test bounded to 110 seconds.
- Automatic tests by an internal timer, every 3 hours by default (30 minutes to once a day, or on demand only), planned from the last test across restarts; one test at a time.
- Processor watch: a test slowed down by the 0.5 CPU of the container is marked as limited, and its latency under load is left out rather than wrong.
- Scene triggers: test completed (every value as a variable), test failed (offline, service or measurement) and connection restored (outage duration), the outage being checked every 5 minutes with a light request.
- Scene action: run a speed test, with its values as outputs; it never starts a Fast.com trigger.
- Dashboard widget: last values, history of the speeds or of the latency, latency under load, jitter, server, data used, next test and a "Run a test" button.
- Configuration actions: run a test now and diagnostic (a summary in the logs, without IP address).
- English, French, German and Spanish everywhere: settings, device, widget, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-fast-com/releases/tag/v0.1.0
