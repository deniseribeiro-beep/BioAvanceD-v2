// PreToolUse guard for the test-writer agent type (see .claude/agents/test-writer.md).
// Blocks every action reserved for the orchestrator so leaf agents can't publish,
// commit, or escalate even by accident — containment lives here, not in brief prose.
// To reserve another action, add a [pattern, why] pair to the list below.
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = String(JSON.parse(raw).tool_input.command || '');
  } catch (e) {
    // Unparseable input: let it through rather than block blind.
    process.exit(0);
  }

  const reserved = [
    // Anything GitHub-facing: issues, PRs, releases, API calls.
    [/(^|[\s;&|(])gh(\s|$)/, 'GitHub CLI — findings go in your report; the orchestrator triages and files them'],
    // Any git operation that mutates state, history, or remotes. Read-only
    // git (status, log, diff, show, blame) stays available.
    [/\bgit\s+(commit|push|pull|fetch|add|stage|stash|tag|reset|checkout|switch|restore|revert|rebase|merge|cherry-pick|clean|rm|mv|branch|remote|config)\b/,
      'git mutations — the orchestrator commits verified slices; your work is picked up from the working tree'],
    // Container/stack operations: end-of-loop gate only, never per-slice.
    [/(^|[\s;&|(])docker(-compose)?(\s|$)|docker\s+compose/, 'Docker — end-of-loop gate only'],
    // Publishing/registry side effects.
    [/\bnpm\s+(publish|unpublish|deprecate|version|login|adduser)\b/, 'npm registry operations'],
    // Package/config mutation that belongs to the orchestrator.
    [/\bnpm\s+(install|uninstall|update|ci)\b|\byarn\s+(add|remove)\b/, 'dependency changes — report the need instead'],
  ];

  for (const [pattern, why] of reserved) {
    if (pattern.test(command)) {
      console.error(
        `This command is reserved for the orchestrator (${why}). ` +
          'Continue your slice with the tools you have and put anything the orchestrator needs to act on in your final report.'
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
