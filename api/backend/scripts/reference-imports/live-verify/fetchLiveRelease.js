const crypto = require('crypto');

// #555 (RF028/#550 foundational piece): the one place in this repo allowed
// to make a live network call for reference-data purposes. Deliberately
// outside src/reference-data/reference-imports/ — reference-import-boundary
// .arch.test.js's "no live network calls" assertions cover pipeline.js/
// sources/*.js/normalize*.js/parseJsonLines.js only, and this module must
// never be imported by any of them. Verification-only: never writes to
// Mongo, never runs referenceRelease.service.js's promoteRelease step.

/**
 * Fetches JSON from a live URL (e.g. a GitHub releases API endpoint).
 * `headers` defaults to GitHub's own recommended Accept type — override it
 * for APIs that content-negotiate differently (e.g. HGNC's REST API, #557:
 * confirmed live that rest.genenames.org/info returns XML unless the
 * request sends a plain `Accept: application/json` header).
 */
async function fetchJson(url, headers = { Accept: 'application/vnd.github+json' }) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`fetchJson failed for ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

/** Fetches raw text from a live URL (e.g. a LICENSE file). */
async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchText failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * HEAD-checks a live URL without downloading the body — for sources
 * distributed as a direct file download rather than a GitHub releases API
 * (e.g. Orphanet's Nomenclature Pack, #557 ORPHA). Returns ok/status plus
 * the raw Headers object so a caller can read e.g. last-modified as a
 * release-date proxy when no API-reported tag/timestamp exists.
 */
async function fetchHead(url) {
  const response = await fetch(url, { method: 'HEAD' });
  return { ok: response.ok, status: response.status, headers: response.headers };
}

/**
 * GETs a stable "latest" URL and follows redirects to see where it lands —
 * for sources whose release identifier is embedded in a redirect target
 * rather than exposed by any releases API or asset filename (e.g. WHO's
 * ICD-11 browser, #557: `/browse/latest-release/mms/en` 302s to
 * `/browse/2026-01/mms/en`). Returns the final URL so a caller can extract
 * the version from it; HEAD isn't usable here since this endpoint 405s on
 * HEAD (confirmed live for ICD-11).
 */
async function fetchRedirectTarget(url) {
  const response = await fetch(url);
  return { ok: response.ok, status: response.status, url: response.url };
}

/** SHA-256 hex digest over a fetched body — same algorithm parseJsonLines.js's checksumFile uses over local fixtures. */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

module.exports = { fetchJson, fetchText, fetchHead, fetchRedirectTarget, sha256Hex };
