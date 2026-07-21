// PreToolUse guard on the Agent tool: catches the two failure modes from
// the 2026-07-14 incident (`general-purpose-agent-filed-issues-and-could-
// subspawn`, bioavanced-conventions/references/incidents.md) mechanically,
// instead of relying on the orchestrator remembering a skill's prose:
//
// 1. A brief that instructs a subagent to run `gh issue`
//    create/edit/close/comment itself. Issue filing stays with the
//    primary session after it reviews the subagent's report — see
//    bioavanced-conventions and parallel-test-agents.
// 2. A brief that fans a large batch of independent items (N files/
//    tests/issues, N>=8) out to a single non-`test-writer` agent. That
//    shape belongs to parallel-test-agents' `test-writer` leaf-worker
//    fan-out (mechanically contained: no Agent tool, Bash hook blocks
//    gh/git-writes/docker) — not a single `general-purpose`/`claude`
//    agent, which has unrestricted tools including Agent itself and can
//    spawn further ungoverned sub-agents.
//
// 3. An Agent call made without `Skill(agent-delegation)` ever being
//    invoked this session — the "agent lock" from issue #71, raised by
//    Dennis on #56 after a soft prose pre-check failed more than once.
//
// #71 asked whether a lock was even expressible: a PreToolUse hook sees
// the tool call, not which skill is "driving," so there is no "current
// skill" to check. Answer, verified here: **it does not need one.** The
// PreToolUse payload carries `transcript_path`, so the check becomes a
// *session-ordering* one — exactly the technique wrapup-checkpoint.cjs
// already uses — and this stays one more hook in this family rather than
// the pack-wide architectural change #61 assumed. `agent-delegation`'s
// own rule is already phrased as tool-call ordering (Skill call precedes
// Agent call, same session), so the two line up without restating it.
//
// Known residual, deliberate and the same one wrapup-checkpoint.cjs
// documents: one invocation anywhere in the transcript satisfies the
// check. Stricter — "invoked since the last Agent call" — was considered
// and rejected: `parallel-test-agents` legitimately launches 2-4 agents
// per delegation episode, and demanding a re-invocation between them
// would make the correct workflow the noisy one. This closes the failure
// that actually happened (an agent summoned with no pre-check at all).
//
// Coverage, stated honestly (#76, applying #72's standard). The three
// checks do NOT have the same strength, so they do not get the same claim:
//
// - **The agent lock (3) is exact.** Verified against the harness tool
//   surface: `Agent` is the only tool that spawns a subagent. `SendMessage`
//   cannot — it addresses an agent by name or `agentId` and resumes it from
//   its transcript, so every agent it can reach already came through a
//   gated `Agent` call. `isolation: worktree|remote` and
//   `subagent_type: fork` are parameters of `Agent`, not separate paths.
//   So the matcher covers the whole spawn surface and "no bypass" is
//   literally true. Residual, out of scope by construction: a scheduled
//   cloud agent (CronCreate / the `schedule` skill) runs in a *different*
//   session, which a session-ordering lock cannot and should not gate.
// - **The gh-mutation check (1) is a heuristic.** It matches the literal
//   string `gh issue <verb>` in the brief. "File the issues you find",
//   "open a ticket per finding", or an agent that decides to file on its
//   own initiative all slip past.
// - **The fan-out check (2) is a heuristic.** It needs a literal digit
//   adjacent to a noun from a fixed list. "eight-ish files", "each of the
//   failing modules", or a spelled-out number all slip past.
//
// The two heuristics' messages therefore say the *rule* is
// agent-delegation and this hook is only its mechanical backstop — do not
// reword them into a "no bypass" claim their matchers cannot honour. Only
// the lock keeps that claim, on the recorded grounds above.
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

  const toolInput = input.tool_input || {};
  const prompt = String(toolInput.prompt || '');
  const subagentType = String(toolInput.subagent_type || '');

  const ghMutation = /\bgh\s+issue\s+(create|edit|close|comment|reopen)\b/i;
  if (ghMutation.test(prompt)) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          'Blocked: this brief instructs the subagent to run `gh issue ' +
          "create`/edit/close/comment itself. Issue filing stays with the " +
          'primary session — have the agent report findings back in its ' +
          'final message, then file with `gh issue create` yourself after ' +
          'reviewing them (see bioavanced-conventions and ' +
          'parallel-test-agents — "findings reported back are yours to ' +
          'triage and file").\n\n' +
          'Rephrasing the brief so it stops naming `gh issue` is not the ' +
          'workaround: this matcher is a heuristic over the brief text, so ' +
          'a delegated filing instruction will get past it — and getting ' +
          'past it breaks the rule just the same. agent-delegation is the ' +
          'rule; this hook is only its mechanical backstop.',
      })
    );
    process.exit(0);
  }

  // The agent lock (#71). Read the transcript rather than trusting prose.
  // Unreadable transcript → let it through rather than block blind, same
  // failure posture as the JSON parse above.
  let transcript = null;
  try {
    transcript = fs.readFileSync(input.transcript_path, 'utf8');
  } catch (e) {
    transcript = null;
  }
  if (
    transcript !== null &&
    !/"name":\s*"Skill"[\s\S]{0,300}?"skill":\s*"agent-delegation"/.test(
      transcript
    )
  ) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          'Blocked: the `agent-delegation` skill was never invoked this ' +
          'session, and it is the mandatory pre-check before any Agent ' +
          'call — it decides which agent type fits, what the brief may and ' +
          'may not delegate, and how the findings get verified and filed. ' +
          'A prose "mandatory pre-check" has been skipped repeatedly (see ' +
          'issue #56), which is why it is a hook now.\n\n' +
          'Invoke the agent-delegation skill via the Skill tool, then ' +
          'retry this Agent call. A fresh Skill call is the invocation — ' +
          'having read its text before, or reconstructing its checklist ' +
          'from memory, does not count. This guard is a hard block, no ' +
          'bypass; the correct alternative is one tool call away.',
      })
    );
    process.exit(0);
  }

  const containedTypes = new Set(['test-writer']);
  if (!containedTypes.has(subagentType)) {
    const batchMatch = prompt.match(
      /\b(\d+)\s+(failing\s+)?(files|tests|test files|issues|items|slices|modules|routes)\b/i
    );
    const count = batchMatch ? parseInt(batchMatch[1], 10) : 0;
    if (count >= 8) {
      console.log(
        JSON.stringify({
          decision: 'block',
          reason:
            `Blocked: this brief fans out ~${count} independent items to a ` +
            `single \`${subagentType || 'unspecified'}\` agent. That agent ` +
            'type has unrestricted tools (including its own Agent tool) and ' +
            'can spawn further ungoverned sub-agents — this is the exact ' +
            'shape of the 2026-07-14 incident where a general-purpose triage ' +
            'agent spawned four sub-agents of its own before being caught. ' +
            'Use the parallel-test-agents skill instead: split into 2-4 ' +
            'independent slices, launch each as subagent_type: test-writer ' +
            '(mechanically contained — no Agent tool, Bash hook blocks gh/' +
            'git-writes/docker), and verify + file findings yourself after ' +
            'they report back. If the batch genuinely cannot be split into ' +
            'test-writer-shaped slices, do the triage directly instead of ' +
            'delegating it.\n\n' +
            'Rewording the brief so it stops naming a count is not the ' +
            'workaround: this matcher needs a literal digit next to a noun ' +
            'it recognises, so "eight-ish files" or "each failing module" ' +
            'gets past it — and getting past it breaks the rule just the ' +
            'same. agent-delegation is the rule; this hook is only its ' +
            'mechanical backstop.',
        })
      );
      process.exit(0);
    }
  }

  process.exit(0);
});
