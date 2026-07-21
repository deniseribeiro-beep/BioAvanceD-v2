// Stop/PreCompact checkpoint: mechanically fires the `clean-up` skill at
// session end (issue #16 — cleanup obligations were verbal; docker-workflow's
// hygiene section documented the incidents but nothing structurally ran it).
// Scans the transcript for artifact-producing activity this session (docker
// builds/runs, test runs that dump output, redirections into log files). If
// found and the clean-up skill was never invoked, Stop is blocked with a
// reminder to invoke it via the Skill tool; PreCompact (which can't block)
// gets the same reminder as plain context. Same family as
// push-wrapup-checkpoint.cjs and agent-delegation-guard.cjs.
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
  // pragmatic tradeoff as push-wrapup-checkpoint.cjs: anchored to `"command":"`
  // so docker merely *discussed* in prose doesn't fire. Known residual: an
  // escaped quote inside the command truncates the match window, and a command
  // that only mentions docker in a string still fires. Acceptable — a false
  // fire costs one reminder; the skill itself decides nothing needs deleting.
  const dockerActivity =
    /"command":"[^"]*docker\s+(build|buildx|compose|run)\b/.test(transcript);
  const cargoActivity =
    /"command":"[^"]*cargo\s+(test|build|bench|run)\b/.test(transcript);
  const testOutputActivity =
    /"command":"[^"]*(>{1,2}\s*\S*\.(log|txt|json)|--coverage\b|test-results|playwright-report|coverage\/)/.test(
      transcript
    );

  if (!dockerActivity && !cargoActivity && !testOutputActivity) {
    process.exit(0);
  }

  // Already handled this session: a real Skill-tool invocation of clean-up.
  if (/"name":\s*"Skill"[\s\S]{0,300}?"skill":\s*"clean-up"/.test(transcript)) {
    process.exit(0);
  }

  const kinds = [
    dockerActivity ? 'Docker builds/runs' : null,
    cargoActivity ? 'cargo builds/tests' : null,
    testOutputActivity ? 'test output/log artifacts' : null,
  ]
    .filter(Boolean)
    .join(' and ');

  // The hook names only the clean-up skill; it dispatches to its domain
  // cleanups (docker/cargo/temp/test-output) itself — issue #20.
  const reason =
    '(Nothing failed — this is the end-of-session cleanup checkpoint.) This ' +
    'session produced ' +
    kinds +
    ' and the clean-up skill has not been invoked. Invoke the clean-up skill ' +
    'via the Skill tool NOW: it detects what the session produced and runs ' +
    'each matching domain cleanup (session test output, session-built Docker ' +
    'images/builder cache per docker-workflow hygiene, cargo debris, temp ' +
    'files) in sequence — persistent/named caches stay. A fresh Skill call ' +
    'is required — having its text in context does not count. If the ' +
    'artifacts are deliverables the user still needs, invoke it anyway and ' +
    'report them as deliberately kept.';

  if (input.hook_event_name === 'Stop') {
    console.log(JSON.stringify({ decision: 'block', reason }));
  } else {
    // PreCompact can't block; surface the reminder as context so the
    // post-compact session still carries the obligation.
    console.log(reason);
  }
  process.exit(0);
});
