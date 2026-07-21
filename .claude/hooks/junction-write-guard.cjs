// PreToolUse guard on Edit/Write/NotebookEdit/Bash: blocks a write whose
// *resolved* target escapes this project's root via an installed skill
// junction.
//
// Closes issue #62 (skills-pack), the mechanical half of #60; extended for
// #72. The pack's skills are installed as junctions/symlinks at
// `.claude/skills/<name>/`, which resolve to the pack clone elsewhere on
// disk. A session working in this project can therefore open and edit pack
// files as if they were project-local: an unreviewed write into a shared
// repo's working tree, no commit, no PR, invisible to every other project
// until someone notices a stray diff. The correct move is always to file an
// issue on the pack repo quoting the text you'd have written.
//
// #60 documented that rule in prose. Prose is the weaker half: the harness
// permission classifier catches *some* of these (it blocked an Edit to
// .claude/skills/dennis-windows/SKILL.md for resolving outside the
// workspace) but not reliably enough to be the only backstop, and this is
// squarely a mechanical obligation rather than a judgment call.
//
// Scope: deliberately narrow — only paths under `.claude/skills/`. A
// general "no writes outside the project root" rule would also block the
// harness scratchpad directory, which is outside every project root and is
// a legitimate write target. Narrow also matches the actual incident.
//
// Coverage, stated honestly (#72). The structured-tool half (Edit, Write,
// NotebookEdit) is exact: the target path is a named field, so it is
// resolved and tested directly. The Bash half is a *heuristic* — it fires
// when a command mentions a `.claude/skills/...` path that resolves out of
// the project AND looks write-shaped (redirect, sed -i, cp/mv/rm/tee, an
// interpreter opening for write, …). Shell commands are open-ended; a
// determined enough construction (a path built from variables, an
// unrecognised interpreter idiom) will get past it. That is why the block
// message below says the *rule* is Rule 0 and this hook is only its
// mechanical backstop — do not reword it into a "no bypass" claim the Bash
// matcher cannot honour. `test-writer-bash-guard.cjs` is the house
// precedent for pattern-matching Bash this way.
//
// Note this correctly does NOT fire in the skills-pack repo itself, where
// the same junctions resolve *inside* the project root (the pack dogfoods
// its own skills). The test is where the path lands, not that it is a link.
const fs = require('fs');
const path = require('path');

// Resolve a path that may not exist yet (Write creates new files):
// walk up to the nearest existing ancestor, realpath that, then re-append.
function resolveThroughLinks(target) {
  let current = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT') return path.resolve(target);
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Write-shaped Bash constructions. Read-only use of a skills path (cat,
// grep, ls, git diff) is legitimate and common, so mentioning the path is
// not on its own enough to block.
const WRITE_SHAPED = [
  />>?/,                                            // redirects
  /\bsed\b[^|;]*\s-[a-z]*i/,                        // sed -i / -i.bak
  /\b(cp|mv|rm|tee|touch|install|truncate|dd|ln)\b/,
  /\b(python|python3|node|perl|ruby|pwsh|powershell)\b/,
  /\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item\b|\bRemove-Item\b/i,
  /\bgit\s+(checkout|restore|apply|clean)\b/,       // can overwrite worktree files
];

// Path-ish tokens naming the skills junction surface, either slash flavour.
function skillPathsIn(command) {
  const re = /[^\s'"`;|&()<>]*\.claude[\/\\]skills[\/\\][^\s'"`;|&()<>]*/g;
  return command.match(re) || [];
}

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    process.exit(0);
  }

  const projectRoot = fs.realpathSync(input.cwd || process.cwd());
  const skillsDir = path.join(projectRoot, '.claude', 'skills');

  // Returns the resolved real path if `p` is a guarded escape, else null.
  function escapes(p) {
    const literal = path.resolve(projectRoot, p);
    if (!isInside(literal, skillsDir)) return null;
    const real = resolveThroughLinks(literal);
    return isInside(real, projectRoot) ? null : real;
  }

  const toolName = String(input.tool_name || '');
  const toolInput = input.tool_input || {};

  let offender = null; // { shown, real }

  if (toolName === 'Bash') {
    const command = String(toolInput.command || '');
    if (WRITE_SHAPED.some((re) => re.test(command))) {
      for (const token of skillPathsIn(command)) {
        const real = escapes(token);
        if (real) {
          offender = { shown: token, real };
          break;
        }
      }
    }
  } else {
    const filePath = String(toolInput.file_path || toolInput.notebook_path || '');
    if (filePath) {
      const real = escapes(filePath);
      if (real) offender = { shown: filePath, real };
    }
  }

  if (!offender) process.exit(0);

  const viaBash = toolName === 'Bash';
  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        `Blocked: \`${offender.shown}\` resolves to \`${offender.real}\`, ` +
        `which is outside this project (\`${projectRoot}\`). That path is ` +
        'an installed skill junction pointing into the dyeallpies-skills-' +
        'pack clone, so this write would land in a shared repo\'s working ' +
        'tree with no review, no commit, and no PR history — invisible to ' +
        'every other project until the diff is noticed by accident.\n\n' +
        'Instead: file an issue on the skills-pack repo from this session, ' +
        'quoting the exact text you would have written so a pack session ' +
        'can apply it verbatim, then carry on with the original task. This ' +
        'holds for one-word fixes — the size of the change is not the ' +
        'point, the review path is. See the skill-maintenance skill, ' +
        '"Rule 0".\n\n' +
        (viaBash
          ? 'Reaching for a different shell construction is not the ' +
            'workaround: this matcher is a heuristic over an open-ended ' +
            'surface, so something will get past it — and getting past it ' +
            'breaks the rule just the same. Rule 0 is the rule; this hook ' +
            'is only its mechanical backstop.'
          : 'Reaching for Bash (or any other tool) to make the same write ' +
            'is not the workaround. Rule 0 is the rule; this hook is only ' +
            'its mechanical backstop, and its Bash coverage is a heuristic ' +
            'that will not catch every construction.'),
    })
  );
  process.exit(0);
});
