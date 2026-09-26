/**
 * Collect same-origin HTTP API observations from a Playwright-like page.
 */

/**
 * @param {URL} baseUrl
 * @param {URL} requestUrl
 * @returns {boolean}
 */
export function isSameOrigin(baseUrl, requestUrl) {
  return (
    baseUrl.protocol === requestUrl.protocol &&
    baseUrl.host === requestUrl.host
  );
}

/**
 * Format an observed request as "METHOD /path".
 * @param {string} method
 * @param {string} pathname
 * @returns {string}
 */
export function formatObservedRequest(method, pathname) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${String(method || "GET").toUpperCase()} ${normalizedPath}`;
}

/**
 * Attach a request listener that records same-origin API calls.
 * @param {import('playwright').Page} page
 * @param {string|URL} baseUrl
 * @returns {{ stop: () => void, snapshot: () => string[], clear: () => void }}
 */
export function observeSameOriginRequests(page, baseUrl) {
  const origin = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl;
  /** @type {string[]} */
  const observed = [];
  const seen = new Set();

  const onRequest = (request) => {
    try {
      const url = new URL(request.url());
      if (!isSameOrigin(origin, url)) {
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        return;
      }
      const entry = formatObservedRequest(request.method(), url.pathname);
      if (!seen.has(entry)) {
        seen.add(entry);
        observed.push(entry);
      }
    } catch {
      // Ignore malformed request URLs; they are not part of the contract.
    }
  };

  page.on("request", onRequest);

  return {
    stop() {
      page.off("request", onRequest);
    },
    snapshot() {
      return [...observed];
    },
    clear() {
      observed.length = 0;
      seen.clear();
    }
  };
}

/**
 * Keep only observations that occurred after `before` while preserving order.
 * @param {string[]} before
 * @param {string[]} after
 * @returns {string[]}
 */
export function diffObservations(before, after) {
  const prior = new Set(before);
  return after.filter((entry) => !prior.has(entry));
}
