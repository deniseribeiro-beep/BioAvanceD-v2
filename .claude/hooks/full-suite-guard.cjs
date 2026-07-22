// PreToolUse guard: blocks a full-suite test run (no specific file/dir
// target) during the test-loop. test-loop's own text already forbids this per
// iteration ("don't run the full native suite per iteration... runs once, at
// the coverage-reconcile phase") but that text was in context and still got
// run mid-iteration on 2026-07-03 — so this is now blocked mechanically
// instead of relying on the instruction being remembered. Blocked outright
// for now per Dennis: full-suite runs only happen at the ship-to-main
// Docker-gate phase, which is a distinct, deliberate step.
//
// Coverage, stated honestly (#76, applying #72's standard). Two matchers,
// and neither is total:
//
//  1. A bare `vitest` invocation — `vitest run` with only flags after it, or
//     a watch-mode `vitest` with no `run` and no path.
//  2. A package-script indirection that expands to one of those. The hook
//     sees the script name, not what it expands to, so this matches
//     *structurally*: any `test` / `test:*` script is treated as a vitest
//     full-suite run unless it appears in the exclusion list below (#82).
//     #78 enumerated the inclusions instead, off a snapshot of the repo's
//     three `package.json` files — which meant a test script added there
//     later was unguarded until someone remembered to add it here. Inverted
//     so the default for a new `test:*` script is *guarded*: a false block
//     is recoverable and loud, a missed block is neither.
//
// Deliberately NOT matched, so the omissions are on the record:
//  - The excluded script names below — connection smoke-tests and the
//    `node --test` / playwright suites. Not vitest; this guard is scoped to
//    the vitest full suite that #78 was about. This list *is* a snapshot of
//    bioavanced-v2's `package.json` files, but it now fails safe: a stale
//    entry over-blocks rather than under-blocks.
//  - `npm run build` — left unmatched. Under #78 the *root* `build` chained
//    `api/backend run test:ci` and so did reach the full suite; #82 fixed
//    that in bioavanced-v2 instead of here, splitting root `build` (compile
//    only) from `build:ci` (compile + test:ci). `build:ci` is not matched
//    either — it is CI's deliberate entry point, not a per-iteration run.
//  - A run with an explicit file/dir target (`npx vitest run tests/unit/a.
//    test.js`, `npm test -- tests/unit/a.test.js`) is allowed by design.
//
// The block message says the *rule* is test-loop's and this hook is only its
// mechanical backstop; do not reword it into a "no bypass" claim, which the
// two holes above mean it still cannot honour.
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = String(JSON.parse(raw).tool_input.command || '');
  } catch (e) {
    process.exit(0);
  }

  // Any `test` / `test:*` script counts as a full-suite vitest run, except
  // these — bioavanced-v2 scripts that are named like tests but aren't the
  // vitest suite (connection smoke-tests, `node --test` architecture checks,
  // playwright). Longest-first so the alternation can't match a prefix.
  // Listed as the part *after* `test:`, because that is where the lookahead
  // below sits — the `test:` prefix is already consumed by then.
  const notVitestScripts = [
    'e2e:docker',
    'architecture',
    'connections',
    'mongo',
    'redis',
    'arch',
    'e2e',
  ].join('|');

  // `test` alone, or `test:` + anything, minus the exclusions above. The
  // negative lookahead needs its own `\b` so `test:arch` is excluded but
  // `test:archXYZ` is not.
  const fullSuiteScripts = `test(?::(?!(?:${notVitestScripts})\\b)[A-Za-z0-9:_-]+)?`;

  // Trailing context: end of command, a shell operator, or a redirect —
  // anything else means an argument was passed, i.e. a targeted run.
  const tail = '\\s*($|&&|\\|\\||;|\\||>)';
  const flags = '((?:\\s+--?[A-Za-z][^\\s]*(?:[= ]\\S+)?)*)';

  // 1. Direct: `npx vitest run [--flags]`, or watch-mode `vitest [--flags]`.
  const bareVitest = new RegExp(`\\bvitest(?:\\s+run)?\\b${flags}${tail}`);

  // 2. Indirect: `npm test`, `npm run test:unit`, `yarn test:ci`,
  //    `pnpm run test`, `npm --prefix frontend run test:unit`, ...
  //    `npm test -- tests/x.test.js` passes a target, so `tail` excludes it.
  const viaScript = new RegExp(
    `\\b(?:npm|yarn|pnpm)\\b(?:\\s+--?[A-Za-z][^\\s]*(?:[= ]\\S+)?)*\\s+(?:run\\s+)?(?:${fullSuiteScripts})\\b${flags}${tail}`
  );

  if (bareVitest.test(command) || viaScript.test(command)) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          'Blocked: this looks like a full-suite test run with no specific ' +
          'file/dir target. test-loop reserves full-suite runs for the ' +
          'ship-to-main Docker-gate phase only — per iteration, run only the ' +
          "slice's own targeted test file(s) (e.g. `npx vitest run " +
          'tests/unit/<file>.test.js`).\n\n' +
          'If this is the periodic coverage-reconcile step (not a per-' +
          'iteration accident): this hook already allows it — pass explicit ' +
          'directory targets instead of a bare `--coverage`, e.g. `npx ' +
          'vitest run tests/unit tests/integration tests/compliance ' +
          '--coverage --reporter=dot`. That form does not match this ' +
          "matcher (it only fires when nothing but flags follow `vitest " +
          'run`), so no confirmation from Dennis is needed for that ' +
          'specific, already-documented case — see COVERAGE_NOTES.md\'s ' +
          'reconcile section. Otherwise, if you genuinely need the bare ' +
          'form, say so explicitly and ask Dennis first.\n\n' +
          'This matcher covers a bare `vitest` / `vitest run` and any ' +
          '`test` / `test:*` package script that is not on the hook\'s ' +
          'not-vitest exclusion list. It is still not exhaustive — ' +
          '`npm run build:ci` is deliberately left unmatched — so finding ' +
          'another route in is not permission to take it. test-loop\'s ' +
          'full-suite-at-the-ship-gate rule is the rule; this hook is only ' +
          'its mechanical backstop.',
      })
    );
  }
  process.exit(0);
});
