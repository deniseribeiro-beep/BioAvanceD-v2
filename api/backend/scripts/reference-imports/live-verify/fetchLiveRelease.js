const crypto = require('crypto');

// #555 (RF028/#550 foundational piece): the one place in this repo allowed
// to make a live network call for reference-data purposes. Deliberately
// outside src/reference-data/reference-imports/ — reference-import-boundary
// .arch.test.js's "no live network calls" assertions cover pipeline.js/
// sources/*.js/normalize*.js/parseJsonLines.js only, and this module must
// never be imported by any of them. Verification-only: never writes to
// Mongo, never runs pipeline.js's promote() step.

/** Fetches JSON from a live URL (e.g. a GitHub releases API endpoint). */
async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
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

/** SHA-256 hex digest over a fetched body — same algorithm parseJsonLines.js's checksumFile uses over local fixtures. */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

module.exports = { fetchJson, fetchText, sha256Hex };
