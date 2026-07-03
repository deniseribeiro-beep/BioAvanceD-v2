// PreToolUse guard: blocks a bare `vitest run` (no specific file/dir target)
// during the test-loop. test-loop's own text already forbids this per
// iteration ("don't run the full native suite per iteration... runs once, at
// the coverage-reconcile phase") but that text was in context and still got
// run mid-iteration on 2026-07-03 — so this is now blocked mechanically
// instead of relying on the instruction being remembered. Blocked outright
// for now (no bypass) per Dennis: full-suite runs only happen at the
// ship-to-main Docker-gate phase, which is a distinct, deliberate step.
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = String(JSON.parse(raw).tool_input.command || '');
  } catch (e) {
    process.exit(0);
  }

  // Matches `vitest run` with nothing after it but flags (no file/dir path
  // argument) — e.g. `npx vitest run`, `npx vitest run --coverage --reporter=basic`.
  // A targeted run like `npx vitest run tests/unit/foo.test.js` is unaffected.
  const bareRun = /\bvitest\s+run\b((?:\s+--[^\s]+(?:[= ]\S+)?)*)\s*($|&&|\|\||;|\|)/;
  const match = command.match(bareRun);
  if (match) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          'Blocked: this looks like a full-suite `vitest run` with no specific ' +
          'file/dir target. test-loop reserves full-suite runs for the ' +
          'ship-to-main Docker-gate phase only — per iteration, run only the ' +
          "slice's own targeted test file(s) (e.g. `npx vitest run " +
          'tests/unit/<file>.test.js`). If this genuinely is the ship-to-main ' +
          'coverage-reconcile step, say so explicitly and ask Dennis before ' +
          'running it — this guard is a hard block, not a reminder, for now.',
      })
    );
  }
  process.exit(0);
});
