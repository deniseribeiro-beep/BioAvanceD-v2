// PostToolUse checkpoint: fires after a `git push` that ends an iteration.
// In fix-bugs' "Ending an iteration" workflow, the fix branch (`fix/<slug>`)
// gets pushed first, then merged into `feature/docker-e2e-backend-integration`,
// and THAT push is what actually closes the iteration. Originally this fired
// on every push, including the intermediate fix-branch one, producing two
// wrap-up invocations per iteration (confirmed redundant 2026-07-07 once fix
// branches were folded into the workflow — see incidents.md, entry
// `wrapup-fired-twice-per-iteration`). Now scoped to skip a push whose only
// target is a `fix/*` branch, so the reminder fires once, at the push that
// actually ends the iteration (the integration branch, main, or a bare
// `git push` with no explicit branch arg, which we can't resolve here).
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = String(JSON.parse(raw).tool_input.command || '');
  } catch (e) {
    process.exit(0);
  }

  // Anchored to command positions (start of command or after a separator) so a
  // `git push` merely mentioned inside a string/commit-message doesn't false-fire
  // (observed 2026-07-03: fired on a printf whose payload contained "git push").
  // Known residual: a string payload containing a literal `&& git push` still
  // matches — inherent to text-matching without a shell parser. Acceptable: a
  // false fire costs one self-explaining reminder paragraph, nothing blocks.
  const pushMatch = /(^|\n|&&|\|\||;|\|)\s*git\s+(-\S+\s+)*push\b([^\n&|;]*)/.exec(command);
  if (!pushMatch) {
    process.exit(0);
  }

  const rest = pushMatch[3] || '';
  const targetsIntegrationOrMain = /\b(feature\/docker-e2e-backend-integration|main)\b/.test(rest);
  const targetsOnlyFixBranch = /\bfix\/\S+/.test(rest) && !targetsIntegrationOrMain;

  // Skip only when the push explicitly names a fix/* branch and nothing else
  // (e.g. `git push -u origin fix/foo`, `git push origin --delete fix/foo`).
  // A bare `git push` (no branch arg) or one naming the integration branch/main
  // still fires, matching prior behavior for the ambiguous case.
  if (targetsOnlyFixBranch) {
    process.exit(0);
  }

  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        '(The git push succeeded — this is a workflow checkpoint, not an error.) ' +
        'If this push ends an iteration or task: invoke the wrap-up skill via the ' +
        'Skill tool NOW, before drafting any summary. A fresh Skill call is required ' +
        'every time — having its text in context from earlier (or from a compact ' +
        'summary) is not an invocation, and reconstructing its checklist from memory ' +
        'does not count. If this push is mid-task (more slices coming), continue ' +
        'working; the requirement applies to the push that ends the task.',
    })
  );
  process.exit(0);
});
