/**
 * #781: a mock MongoDB cursor that captures the sort/limit/skip specs a
 * handler used, instead of the identity-form stub (`sort() { return
 * chain; }`, accepts any spec, returns the chain unchanged) that 165
 * call sites across 80 test files used before this. That identity form
 * can't fail no matter which key a handler orders on, which is exactly
 * how #769 (RF008 sample handlers ordering on a field no document
 * carries) and #775 (a lexicographic sort choosing the wrong "highest"
 * barcode) both went unnoticed — nothing downstream could observe the
 * spec that was actually handed to `.sort()`/`.limit()`/`.skip()`.
 *
 * Captured maps follow the `capturedQueries`/`capturedSorts` naming
 * already established in `reports.routes.gaps.test.js` (#769) rather
 * than inventing new vocabulary — `capturedLimits`/`capturedSkips` are
 * the same per-collection-key dictionary shape, just for the two
 * sibling cursor methods.
 */
function createCursorMock(docs = [], options = {}) {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in cursor factory context');
  }

  const { capturedSorts, capturedLimits, capturedSkips, key } = options;
  const current = Array.isArray(docs) ? [...docs] : [];

  const record = (map, value) => {
    if (map && key !== undefined) {
      map[key] = value;
    }
  };

  // Every method below returns this same `chain` object, and `toArray`
  // lives on it directly — that's what makes the chain callable in any
  // order (`.sort().limit().toArray()`, `.limit().sort().toArray()`, or
  // a bare `.toArray()` with no chain calls at all). Hard-coding one
  // nesting (e.g. only `sort().limit().toArray()`) broke a real caller:
  // `import-lgpd.service.importSamples.unit.test.js` needed a direct
  // `.toArray()` with no preceding chain call, which a stub built only
  // for the nested form didn't support.
  const chain = {
    sort: v.fn().mockImplementation((spec) => {
      record(capturedSorts, spec);
      return chain;
    }),
    limit: v.fn().mockImplementation((n) => {
      record(capturedLimits, n);
      return chain;
    }),
    skip: v.fn().mockImplementation((n) => {
      record(capturedSkips, n);
      return chain;
    }),
    toArray: v.fn().mockImplementation(async () => current),
  };

  return chain;
}

/**
 * Convenience per-collection capture store for a test/collection-db
 * builder that wants the capturedSorts naming `reports.routes.gaps.test.js`
 * already established, plus its limit/skip siblings, without hand-rolling
 * three empty objects at every call site.
 */
function createCursorCaptureStore() {
  return {
    capturedSorts: {},
    capturedLimits: {},
    capturedSkips: {},
  };
}

module.exports = {
  createCursorMock,
  createCursorCaptureStore,
};
