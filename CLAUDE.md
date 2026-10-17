# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Fast.com**, the speed test of
Netflix: a Node.js service (Node 22+, ESM, no build step) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and measuring the line against the Netflix servers Fast.com lists. Only
dependency: the SDK (`fetch` and `node:https` are native). Transport: cloud only.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run measure                           # a REAL test from this machine (hundreds of MB)
docker run --rm --cpus 0.5 --memory 256m -v "$PWD":/app:ro -w /app node:24-alpine node scripts/measure.mjs
npx github:GladysAssistant/integration-store . --skip-image-check
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js          SDK wiring only (new GladysIntegration + createApp)
src/app.js        every handler, registered before connect(): timer, one test at a
                  time, publishing, scene events, outage checks, widget, actions
src/fast-api.js   fast.com page -> script -> token (cached, read again on 403),
                  api.fast.com -> client + Netflix servers; range URLs
src/speedtest.js  the measurement: latency probes, streamed downloads / uploads,
                  stop when stable, latency under load, event loop watch (CPU limit);
                  the transport (node:https keep-alive pools) is injected
src/result.js     rounded result, summary; the IP address given by Fast.com is dropped
src/store.js      /data/state.json: last result + failure in progress (restarts)
src/device.js     the Fast.com device, five read-only features
src/events.js     scene trigger keys, origins, failure reasons, event data
src/widgets.js    the `speedtest` widget (pure builder)
src/config.js / i18n.js   configuration, runtime texts (en / fr / de / es)
scripts/measure.mjs       real test outside Gladys (development only)
```

## Fast.com facts (read from the web client on 2026-10-17, to re-check when in doubt)

- `https://fast.com/` loads `/app-<hash>.js`, which carries `token:"…"` (the same
  public token for everyone). `https://api.fast.com/netflix/speedtest/v2?https=true&token=…&urlCount=5`
  answers `{ client: { ip, asn, isp, location }, targets: [{ name, url, location }] }`;
  a wrong token gives 403. The URLs are signed and valid for a few hours.
- `…/speedtest/range/0-N?…`: GET downloads N + 1 bytes, POST (Content-Length N)
  uploads, POST with an empty body on `0-0` is the latency probe (needs
  `Content-Length: 0`, else 400). The web client asks for 25 MiB (26 214 400).
- Measured on 2026-10-17 (Free, 1 Gbit/s NIC): page 960 / 730 Mbit/s, 10 / 14 ms;
  this code 913-933 / 717-837 Mbit/s, 10.5-11 / 17-21 ms, also under
  `--cpus 0.5 --memory 256m` (about 0.2 CPU used, 120-137 MB RSS at the peak).
  At `--cpus 0.1`: download halved and loaded latency inflated by the event loop
  (hence the CPU watch). Upload exact on a line shaped to 5 Mbit/s (4.9).

## Rules

- **External ids are forever**: `gladys.externalIds('speedtest', 'fast')`, feature
  keys, config, action, widget, widget action, scene trigger and action keys.
  `test/structure.test.js` compares them to `test/fixtures/discovery.baseline.json`
  (0.1.0): never update the baseline without a documented migration.
- **Tests by an internal timer** (`test_interval`), never `should_poll`; one test at
  a time (`startTest` joins the running one); the next test is planned from the
  last one, a restart never runs an extra test.
- **Never buffer a body**: count the bytes and drop them (256 MB container).
- **States**: every test publishes all its values (`publishStates`: each test is a
  history point), only for the created features; the last result again in
  `onDeviceCreated`, then a widget refresh.
- **Scene events**: a test started by a scene action never fires one, and does
  not change the failure tracking (the outage checks do).
- **Privacy**: never store, log or publish the IP address Fast.com returns.
  Gladys passes no DEBUG variable to the container: the **Diagnostic** action
  writes the summary to the logs instead.
- **The container rootfs is read-only**; only `DATA_DIR` (`/data`) is written.
- **Four languages** everywhere (manifest, `src/i18n.js`, docs, README);
  `test/i18n.test.js` checks it.
- **Widget images**: after any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
