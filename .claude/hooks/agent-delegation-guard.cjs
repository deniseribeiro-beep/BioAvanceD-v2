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
// Blocked outright, no bypass — same posture as full-suite-guard.cjs.
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
          'triage and file"). This guard is a hard block, no bypass.',
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
            'they report back. This guard is a hard block, no bypass — if ' +
            'the batch genuinely cannot be split into test-writer-shaped ' +
            'slices, do the triage directly instead of delegating it.',
        })
      );
      process.exit(0);
    }
  }

  process.exit(0);
});
