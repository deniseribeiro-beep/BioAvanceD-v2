// PreToolUse guard: blocks git commands that would move work onto, or push
// to, a branch other than the active fix/test branch or the docker
// integration branch. fix-bugs/test-loop both pin work to `feature/docker-
// e2e-backend-integration` while `main` is frozen (bioavanced-conventions) —
// this makes that mechanical instead of relying on the instruction being
// remembered, the same pattern as full-suite-guard.cjs.
//
// Allowed branch names: `feature/docker-e2e-backend-integration`, and any
// `fix/<slug>` or `test/<slug>` branch (the per-iteration work branches named
// in bioavanced-conventions' git-hygiene section). Everything else — `main`,
// other `feature/*` branches, ad hoc names — is blocked for checkout/switch/
// branch-create and for push destinations.
let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = String(JSON.parse(raw).tool_input.command || '');
  } catch (e) {
    process.exit(0);
  }

  const ALLOWED = /^(feature\/docker-e2e-backend-integration|fix\/[^\s]+|test\/[^\s]+)$/;

  // git checkout [-b] <name> / git switch [-c] <name> / git branch <name>
  const moveMatch = command.match(
    /(^|\n|&&|\|\||;|\|)\s*git\s+(checkout|switch)\s+(-[bc]\s+)?([^\s-][^\s]*)/
  ) || command.match(/(^|\n|&&|\|\||;|\|)\s*git\s+branch\s+([^\s-][^\s]*)/);

  // git push [<flags>] origin <name> / git push [<flags>] <remote> <name> [--delete <name>]
  const pushMatches = [
    ...command.matchAll(/(?:^|\n|&&|\|\||;|\|)\s*git\s+push\s+(?:-\S+\s+)*\S+\s+(?:--delete\s+)?([^\s]+)/g),
  ];

  const candidates = [];
  if (moveMatch) {
    const name = moveMatch[4] || moveMatch[2];
    if (name) candidates.push(name);
  }
  for (const m of pushMatches) {
    if (m[1]) candidates.push(m[1].replace(/^origin:/, ''));
  }

  const blocked = candidates.filter((name) => !ALLOWED.test(name));

  if (blocked.length > 0) {
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          `Blocked: "${blocked[0]}" is not the docker integration branch ` +
          '(feature/docker-e2e-backend-integration) or a fix/<slug>/test/<slug> ' +
          'work branch. Per bioavanced-conventions, main is frozen and other ' +
          'branches are out of scope for this workflow — branch off/push to ' +
          'feature/docker-e2e-backend-integration or the current fix/test branch ' +
          'only. If you genuinely need a different branch, say so explicitly and ' +
          'ask Dennis first.',
      })
    );
  }
  process.exit(0);
});
