// PostToolUse checkpoint: fires after any Bash command containing `git push`.
// In this repo's workflow (test-loop "Ending an iteration"), a push is step 1
// and the final summary is step 3, with the wrap-up skill mandated in between —
// and that middle step has been skipped or faked from memory repeatedly. This
// hook makes the checkpoint mechanical instead of relying on the model to
// remember, and fires regardless of compaction state.
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
  if (/(^|\n|&&|\|\||;|\|)\s*git\s+(-\S+\s+)*push\b/.test(command)) {
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
  }
  process.exit(0);
});
