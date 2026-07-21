// Stop/PreCompact checkpoint: mechanically enforces wrap-up's "run before
// the final summary" obligation (issue #4 — enforcement was verbal; the
// skill's own text documented sessions going straight from merge/close to
// summary). Scans the transcript for terminal activity this session
// (`gh issue close`, `gh pr merge`, `git push`). If found and the wrap-up
// skill was never invoked via the Skill tool, Stop is blocked with a
// reminder; PreCompact (which can't block) gets the same reminder as plain
// context. Same family as handoff-checkpoint.cjs and
// session-cleanup-checkpoint.cjs.
//
// Known residual: one wrap-up invocation anywhere in the transcript
// satisfies the check, so a multi-iteration session that ran wrap-up for
// iteration 1 but skipped it for iteration 3 passes — the per-iteration
// trigger stays on the loop skills' prose (and, in projects that deploy it,
// the push-wrapup PostToolUse checkpoint). Acceptable: this hook closes the
// common failure (a session that never ran it at all).
const fs = require('fs');

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    process.exit(0);
  }

  // A blocked Stop re-fires the hook with stop_hook_active=true; letting that
  // pass is what prevents an infinite block loop.
  if (input.stop_hook_active) {
    process.exit(0);
  }

  let transcript = '';
  try {
    transcript = fs.readFileSync(input.transcript_path, 'utf8');
  } catch (e) {
    process.exit(0);
  }

  // Detection is text-matching on serialized Bash tool_input commands, same
  // pragmatic tradeoff as the sibling checkpoints: anchored to `"command":"`
  // so a close/merge/push merely *discussed* in prose doesn't fire. A false
  // fire costs one reminder; a session with no terminal activity exits
  // silently.
  const terminalActivity =
    /"command":"[^"]*gh\s+issue\s+close\b/.test(transcript) ||
    /"command":"[^"]*gh\s+pr\s+merge\b/.test(transcript) ||
    /"command":"[^"]*git\s+(-\S+\s+)*push\b/.test(transcript);

  if (!terminalActivity) {
    process.exit(0);
  }

  // Already handled this session: a real Skill-tool invocation of wrap-up.
  if (/"name":\s*"Skill"[\s\S]{0,300}?"skill":\s*"wrap-up"/.test(transcript)) {
    process.exit(0);
  }

  // Pack-repo fallback (issue #32): in the skills-pack repo wrap-up is
  // source (skills/wrap-up/SKILL.md), not an installed skill, so a Skill
  // call can't succeed there. A Read of the skill source this session
  // counts as the invocation instead. Deployed targets have no such path,
  // so this never matches outside the pack repo.
  if (
    /"file_path":\s*"[^"]*skills[^"]*wrap-up[^"]*SKILL\.md"/.test(transcript)
  ) {
    process.exit(0);
  }

  const reason =
    '(Nothing failed — this is the wrap-up checkpoint.) This session pushed, ' +
    'closed an issue, or merged a PR, but the wrap-up skill was never ' +
    'invoked. Invoke the wrap-up skill via the Skill tool NOW, before the ' +
    'final summary: it runs the friction audit (scope drift, lazy fixes, ' +
    'stale instructions, unfiled findings) and, when an issue was resolved, ' +
    'the HANDOFF.md rotation. A fresh Skill call is the invocation — having ' +
    'its text in context, or reconstructing its checklist from memory, does ' +
    'not count. (Pack repo only: if the Skill tool reports wrap-up as ' +
    'unknown, Read skills/wrap-up/SKILL.md and run its checklist — that ' +
    'Read satisfies this checkpoint.)';

  if (input.hook_event_name === 'Stop') {
    console.log(JSON.stringify({ decision: 'block', reason }));
  } else {
    // PreCompact can't block; surface the reminder as context so the
    // post-compact session still carries the obligation.
    console.log(reason);
  }
  process.exit(0);
});
