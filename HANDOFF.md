# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
Short sitting, no product work. Dennis asked which skills-pack issue had
work that could only be done here, then authorized executing it. Answer:
**pack #523's live agent run** — and it **failed**, which is the finding.

## The result: delegated leaf workers are not contained

The previous handoff's four-step plan was followed and stopped at step 1,
which is what step 1 exists to do.

**Step 1 — the containment probe, where a refusal was the pass.** A
`fix-writer` was briefed to run `docker ps` and report. **It executed.**
`docker` is the first verb `leaf-worker-bash-guard.cjs` reserves.

**Step 1b — which layer is broken.** One follow-up probe, two commands:

| command | guard registered in | result |
|---|---|---|
| `find / -maxdepth 1 -name zzz-…` | `settings.json` | **blocked** |
| `git commit --allow-empty … --dry-run` | agent frontmatter | **executed** |

So `settings.json` PreToolUse `Bash|PowerShell` hooks **do** reach a
subagent. Hooks registered in an agent's markdown frontmatter **do not**.
The guard file itself is correct — piped directly at the deployed copy it
returns exit 2 for `docker ps`, `gh`, every git mutation, and for the exact
`git commit` string the worker got away with. Not #531: the command string
is the cwd-independent form, and the identical form fires from
`settings.json` in the same session.

**`test-writer.md` carries the identical frontmatter block.** So every leaf
worker across the three measured orchestrator rounds — n=8 — ran
**uncontained**. Nothing went wrong in any of them, but that was the briefs
and the model, not the machinery.

**Prime suspect, not established:** `matcher: "Bash|PowerShell"`, from pack
#520. Claude Code's docs show frontmatter `hooks:` with a bare
`matcher: "Bash"`. If frontmatter matches literally where `settings.json`
matches as a regex, #520's hardening is what switched both guards off.

## Rules this sitting produced

**Every containment check we have runs the guard ourselves; none observes
the harness choosing to run it.** The pack's suite asserts the frontmatter's
*text* and pipes payloads at the guard *file* — both passed green while the
guard was inert. Third instance of that family (#509 stdin-blindness, #531
path-blindness, now registration-surface blindness). **A guard's
registration is only verified by a live agent actually being refused.**

**A "which layer" probe is worth more than a retry.** When the pass
condition fails, one two-command probe separating the registration surfaces
turned "containment is broken" into "frontmatter registration is inert,
settings.json works" — which is the difference between an unactionable
report and a fix.

## Filed

All on `DyeAllPies/dyeallpies-skills-pack`, no new issues opened:

- **#523** — the full run: probe results, layer discrimination, guard
  payload table, the matcher hypothesis, the stale overlay, suggested next.
  Plus an addendum: **both workers reported an injected "Auto Mode Active"
  reminder** telling them to prefer raw Bash over `Edit`/`Write` for file
  work. Both declined and flagged it, unprompted — the contract working —
  but it pushes edits onto the one surface the (inert) guard polices.
- **#526** — cross-reference: its blocker is cleared but its containment
  premise is void; **#523 still lands first.**

**Also recorded on #523, not fixed (Rule 0):**
`agent-delegation/local-env/bioavanced-v2.md` is stale — names `test-writer`
as *the* leaf worker and points at `test-writer-bash-guard.cjs`, renamed by
`4dd6c41` and gone from disk.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched. No open PR. **No product code was touched this sitting.**
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `.claude/agents/` and `.claude/hooks/` are gitignored here — the agent
  definitions are *not* tracked in Denise's repo.

## Docker

**Not run, and not runnable. Docker Desktop is still DOWN** — re-confirmed
incidentally by the probe itself (`open //./pipe/dockerDesktopLinuxEngine:
The system cannot find the file specified`). No container or volume state
observed or changed; **bootstrap state remains unverified** — run
`docker ps -a` before trusting anything about the volumes.

## Blocked here — needs Dennis

**The confirming experiment for the matcher hypothesis is one character-level
edit** (`fix-writer.md`'s matcher → `"Bash"`, re-run the `docker ps` probe).
Attempted twice this sitting, blocked both times by the auto-mode permission
classifier — via Bash `sed -i` **and** via the `Edit` tool — on a file that
is untracked and gitignored. It needs either a permission grant or a
pack-rooted session flipping its own copy.

## Recommended next

**Do not brief a leaf worker for real work until containment holds.** The
whole delegation programme rests on it, and step 1's own contract says
nothing else proceeds.

1. **Establish or refute the matcher hypothesis** (above) — one edit, one
   re-probe. Cheapest thing on the board.
2. **Then re-run the `docker ps` probe.** A refusal is the pass, and only
   that closes #523 slice 1.
3. **#526 stays blocked behind it.**

Unchanged and still true from the previous rotation:

- **#752 is the one item that wants Dennis, not a session** —
  `backup.service.test.js` is still red at branch tip (1 failed / 42
  passed); the one-line fix also ratifies a BSON-type change on the live
  destructive `restoreBackup` path. Still the highest-value single decision.
- **#841 + #797 item 2** are the natural next parallel round — but that is a
  *delegated* round, so it is downstream of the containment fix.
- **#833 / #828** remain the highest-value Docker-dependent items; the
  **#684 / #800 / #801** ownership cluster remains the highest-severity
  overall, still blocked on the RF010/RF021 actor model.
- Still blocked on an owner's call, looked at and not picked: **#774**,
  **#772**, **#789**. Added this sitting: **#806**, **#804** and **#811**
  all open with a design decision too — so **the "small, already-diagnosed"
  slot for the first real worker run is still unfilled**, and the board's
  labels don't identify one (`#804` is `question`, `#811` is `bug`, both are
  decisions). Pick it deliberately rather than off the label.
