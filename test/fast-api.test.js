import { test } from 'node:test';
import assert from 'node:assert/strict';

import { API_URL, FastApiError, createFastApi, parseTargets, rangeUrl } from '../src/fast-api.js';
import { TOKEN, fakeFastCom } from './helpers/fakes.js';

test('reads the token from the script of the page, then asks for the servers', async () => {
  const fetchImpl = fakeFastCom();
  const api = createFastApi({ fetchImpl, userAgent: 'gladys-fast-com/test' });
  const { client, targets } = await api.getTargets();
  assert.equal(client.isp, 'Free');
  assert.equal(client.city, 'Bordeaux');
  assert.equal(client.asn, '12322');
  assert.equal(targets.length, 4);
  assert.deepEqual(
    { host: targets[0].host, city: targets[0].city, country: targets[0].country },
    { host: 'ipv4-c001-cdg001-ix.1.oca.nflxvideo.net', city: 'Paris', country: 'FR' },
  );
  const apiCall = fetchImpl.state.calls.find((url) => url.startsWith(API_URL));
  assert.equal(
    apiCall,
    `${API_URL}?https=true&token=${TOKEN}&urlCount=5`,
    'the request of the official client',
  );
  assert.equal(fetchImpl.state.userAgent, 'gladys-fast-com/test');
  // The token is cached: a second test reads the page no more.
  await api.getTargets();
  assert.equal(fetchImpl.state.calls.filter((url) => url === 'https://fast.com/').length, 1);
  assert.equal(api.tokenState().present, true);
});

test('a retired token (403) is read again from the page, once', async () => {
  const fetchImpl = fakeFastCom();
  const api = createFastApi({ fetchImpl });
  await api.getTargets();
  fetchImpl.state.token = 'TmV3VG9rZW5Gb3JUZXN0cw';
  const { targets } = await api.getTargets();
  assert.equal(targets.length, 4);
  assert.equal(fetchImpl.state.calls.filter((url) => url === 'https://fast.com/').length, 2);
});

test('errors carry a stable code: unreachable, token_not_found, forbidden', async () => {
  const down = fakeFastCom();
  down.state.pageDown = true;
  await assert.rejects(createFastApi({ fetchImpl: down }).getTargets(), {
    name: 'FastApiError',
    code: 'unreachable',
  });

  const changed = fakeFastCom();
  changed.state.noToken = true;
  await assert.rejects(createFastApi({ fetchImpl: changed }).getTargets(), {
    code: 'token_not_found',
  });

  // The page keeps giving a token the API refuses.
  const refused = fakeFastCom();
  const api = createFastApi({
    fetchImpl: async (url, options) => {
      const response = await refused(url, options);
      return url.startsWith(API_URL) ? new Response('Forbidden', { status: 403 }) : response;
    },
  });
  await assert.rejects(api.getTargets(), { code: 'forbidden' });

  const apiDown = fakeFastCom();
  apiDown.state.apiDown = true;
  await assert.rejects(createFastApi({ fetchImpl: apiDown }).getTargets(), { code: 'unreachable' });
});

test('keeps only HTTPS Netflix speedtest URLs, and needs one', () => {
  const parsed = parseTargets({
    client: { ip: '1.2.3.4', isp: 'X', location: { city: 'Lyon', country: 'FR' } },
    targets: [
      { url: 'http://plain.example/speedtest?x=1' },
      { url: 'https://other.example/something' },
      { url: 'not a url' },
      { url: 'https://ok.example/speedtest?x=1', location: { city: 'Paris', country: 'FR' } },
    ],
  });
  assert.deepEqual(
    parsed.targets.map((target) => target.host),
    ['ok.example'],
  );
  assert.throws(() => parseTargets({ targets: [] }), { code: 'no_targets' });
  assert.throws(() => parseTargets({}), { code: 'bad_response' });
  assert.ok(new FastApiError('x', 'y') instanceof Error);
});

test('range URLs keep the signature of the server URL', () => {
  const url = 'https://a.oca.nflxvideo.net/speedtest?c=fr&n=1&e=2&t=sig';
  assert.equal(
    rangeUrl(url, 26214400),
    'https://a.oca.nflxvideo.net/speedtest/range/0-26214400?c=fr&n=1&e=2&t=sig',
  );
  assert.equal(
    rangeUrl(url, 0),
    'https://a.oca.nflxvideo.net/speedtest/range/0-0?c=fr&n=1&e=2&t=sig',
  );
});
