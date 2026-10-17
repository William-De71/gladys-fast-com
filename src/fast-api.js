// -----------------------------------------------------------------------------
// The Fast.com "API": what the official web client of https://fast.com does
// before measuring (unofficial, read from its code on 2026-10-17).
//
//   1. https://fast.com/ loads a script `/app-<hash>.js`, which carries a
//      public token: `token:"…"` (the same for every visitor);
//   2. https://api.fast.com/netflix/speedtest/v2?https=true&token=…&urlCount=5
//      answers `{ client: { ip, asn, isp, location: { city, country } },
//      targets: [{ name, url, location: { city, country } }] }`: signed URLs
//      of Netflix Open Connect servers (OCA), the closest first, valid for a
//      few hours. A wrong or retired token gives 403.
//
// The token is cached in memory and asked for again on a 403 (Netflix may
// change it with a new version of the site).
// -----------------------------------------------------------------------------

const FAST_URL = 'https://fast.com/';
const API_URL = 'https://api.fast.com/netflix/speedtest/v2';
const URL_COUNT = 5;
const TIMEOUT_MS = 10_000;
// Bounds of what is read from Netflix (a bigger page or script is not the one
// we know).
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;

const SCRIPT_REGEX = /<script[^>]+src="(\/app-[A-Za-z0-9]+\.js)"/;
const TOKEN_REGEX = /token:"([A-Za-z0-9+/=_-]{8,128})"/;

/** An error of the Fast.com API, with a stable `code` for the user messages. */
class FastApiError extends Error {
  /**
   * @param {string} message - The message (logs).
   * @param {string} code - `unreachable`, `token_not_found`, `forbidden`,
   *   `bad_response` or `no_targets`.
   */
  constructor(message, code) {
    super(message);
    this.name = 'FastApiError';
    this.code = code;
  }
}

/**
 * @description Read a text body, bounded.
 * @param {Response} response - The fetch response.
 * @param {number} max - The bound, in bytes.
 * @returns {Promise<string>} The text.
 */
async function boundedText(response, max) {
  const text = await response.text();
  if (text.length > max) {
    throw new FastApiError(`Unexpected answer size (${text.length} bytes)`, 'bad_response');
  }
  return text;
}

/**
 * @description Normalize a location `{ city, country }`.
 * @param {unknown} raw - The raw location.
 * @returns {{ city: string, country: string }} The location.
 */
function locationOf(raw) {
  const location = raw && typeof raw === 'object' ? raw : {};
  return {
    city: typeof location.city === 'string' ? location.city.slice(0, 80) : '',
    country: typeof location.country === 'string' ? location.country.slice(0, 8) : '',
  };
}

/**
 * @description Normalize the answer of the speedtest endpoint.
 * @param {unknown} body - The parsed JSON.
 * @returns {{ client: object, targets: Array<{ url: string, host: string, city: string, country: string }> }} The servers.
 * @example
 * parseTargets({ client: {}, targets: [{ url: 'https://a.example/speedtest?x' }] });
 */
function parseTargets(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.targets)) {
    throw new FastApiError('The Fast.com answer has no server list', 'bad_response');
  }
  const targets = [];
  for (const target of body.targets) {
    let url;
    try {
      url = new URL(String(target?.url ?? ''));
    } catch {
      continue;
    }
    // Only HTTPS Netflix servers with the path the web client uses.
    if (url.protocol !== 'https:' || !/\/speedtest$/.test(url.pathname)) {
      continue;
    }
    targets.push({ url: url.href, host: url.hostname, ...locationOf(target.location) });
  }
  if (targets.length === 0) {
    throw new FastApiError('Fast.com gave no usable server', 'no_targets');
  }
  const client = body.client && typeof body.client === 'object' ? body.client : {};
  return {
    client: {
      ip: typeof client.ip === 'string' ? client.ip.slice(0, 64) : '',
      asn: client.asn === undefined || client.asn === null ? '' : String(client.asn).slice(0, 16),
      isp: typeof client.isp === 'string' ? client.isp.slice(0, 80) : '',
      ...locationOf(client.location),
    },
    targets,
  };
}

/**
 * @description The URL of a byte range of a server (`…/speedtest/range/0-N?…`):
 * GET downloads N + 1 bytes, POST uploads them, `0-0` is the latency probe.
 * @param {string} url - The server URL (`…/speedtest?…`).
 * @param {number} size - The size, in bytes (0 = latency probe).
 * @returns {string} The range URL.
 * @example
 * rangeUrl('https://a.example/speedtest?c=fr', 0); // -> 'https://a.example/speedtest/range/0-0?c=fr'
 */
function rangeUrl(url, size) {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}/range/0-${Math.max(0, Math.floor(size))}`;
  return parsed.href;
}

/**
 * @description The Fast.com client: token and server list.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {string} [options.userAgent] - The User-Agent sent to Netflix.
 * @param {number} [options.timeoutMs] - Timeout of each call.
 * @returns {object} The client.
 */
function createFastApi({ fetchImpl = fetch, userAgent = '', timeoutMs = TIMEOUT_MS } = {}) {
  let token = '';
  let tokenAt = 0;
  const headers = userAgent ? { 'user-agent': userAgent } : {};

  /**
   * @description GET a URL, with a timeout.
   * @param {string} url - The URL.
   * @returns {Promise<Response>} The response.
   */
  async function get(url) {
    try {
      return await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new FastApiError(`Fast.com unreachable: ${err.message}`, 'unreachable');
    }
  }

  /**
   * @description Read the token from the script of the Fast.com page.
   * @returns {Promise<string>} The token.
   */
  async function fetchToken() {
    const page = await get(FAST_URL);
    if (!page.ok) {
      throw new FastApiError(`fast.com answered ${page.status}`, 'unreachable');
    }
    const script = SCRIPT_REGEX.exec(await boundedText(page, MAX_PAGE_BYTES));
    if (!script) {
      throw new FastApiError('No app script in the fast.com page', 'token_not_found');
    }
    const code = await get(new URL(script[1], FAST_URL).href);
    if (!code.ok) {
      throw new FastApiError(`The fast.com script answered ${code.status}`, 'unreachable');
    }
    const found = TOKEN_REGEX.exec(await boundedText(code, MAX_SCRIPT_BYTES));
    if (!found) {
      throw new FastApiError('No token in the fast.com script', 'token_not_found');
    }
    token = found[1];
    tokenAt = Date.now();
    return token;
  }

  /**
   * @description The servers of a test (and what Netflix sees of the client).
   * @param {number} [urlCount] - How many servers.
   * @returns {Promise<{ client: object, targets: object[] }>} The servers.
   */
  async function getTargets(urlCount = URL_COUNT) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!token) {
        await fetchToken();
      }
      const url = `${API_URL}?https=true&token=${encodeURIComponent(token)}&urlCount=${urlCount}`;
      const response = await get(url);
      if (response.status === 403 || response.status === 401) {
        // A retired token: read the page again, once.
        token = '';
        if (attempt === 0) {
          continue;
        }
        throw new FastApiError(`api.fast.com refused the token (${response.status})`, 'forbidden');
      }
      if (!response.ok) {
        throw new FastApiError(`api.fast.com answered ${response.status}`, 'unreachable');
      }
      let body;
      try {
        body = JSON.parse(await boundedText(response, MAX_PAGE_BYTES));
      } catch (err) {
        if (err instanceof FastApiError) {
          throw err;
        }
        throw new FastApiError('api.fast.com sent no JSON', 'bad_response');
      }
      return parseTargets(body);
    }
    /* c8 ignore next */
    throw new FastApiError('api.fast.com refused the token', 'forbidden');
  }

  return {
    getTargets,
    fetchToken,
    /** @returns {{ present: boolean, at: number }} The token state (diagnostic). */
    tokenState: () => ({ present: Boolean(token), at: tokenAt }),
    /** Forget the token (tests, diagnostic). */
    forgetToken: () => {
      token = '';
    },
  };
}

export { FAST_URL, API_URL, URL_COUNT, FastApiError, parseTargets, rangeUrl, createFastApi };
