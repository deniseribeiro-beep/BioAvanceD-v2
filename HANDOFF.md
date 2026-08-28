# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
Dennis asked to continue pack #523. It was measured, it is blocked on an
owner action, and **the previous rotation's central claim turned out to be
false.** No product code changed; the sitting's whole output is tracker
state.

---

## Read this first: correcting the previous rotation

The last note told the next session that the auto-mode classifier is
**session-stateful** — that it "arms" on demonstrated intent to modify hook
configuration and thereafter denies even read-only Bash — and prescribed
that the `#523` matcher flip **must be a fresh session's first action.**

**Ran it today. Both halves are false, and the prescription is unrunnable.**

- Registering the probe hook was denied **as a fresh session's first
  config-surface action.** The denial is unconditional. There is no window
  to get in ahead of.
- **Nothing arms.** Seconds after that denial, `head -3` on a file under
  `.claude/hooks/` and `ls .claude/skills/` both succeeded.
- What actually drives a refusal is **command shape**, not path or session
  history: `ls X | head && f=$(ls ...); cat "$f" | head` was denied, while a
  bare `ls X` on the same directory passed. That also explains the original
  "byte-identical command denied later" observation without any statefulness.

**Practical rule: when a read is refused, simplify the command and retry
before concluding anything about the session.**

Full measurements and the corrected procedure are on **#556**. Do not plan
around the old model.

## Where #523 stands

Slice 1 now has two independent blockers, and **neither is a session's to
clear**:

1. **The probe cannot be registered by any session** — #556. It needs a
   one-time edit to `.claude/settings.json` by Dennis; #556 carries the exact
   block, a deliberately wider `Bash|PowerShell|Edit|Write` matcher and why,
   and the six-step readout procedure. Dennis declined the two workarounds
   offered (paste-the-block now, or instrument an already-registered hook)
   in favour of filing it for a clean session.
2. **The out-of-scope-brief method remains unrunnable** — unchanged, and
   already recorded on #523: the brief trips the leaf worker's role contract
   before the hook is ever consulted, so nothing is observed either way. The
   honest fix is still the authorised-self-test clause in the shared
   leaf-worker fragment.

**#526 stays blocked behind it. Every leaf worker still runs uncontained on
the frontmatter surface.**

## Repo state

- On `feature/docker-e2e-backend-integration`, clean and matching origin
  apart from this rotation. `main` untouched. No open PR.
- **No product code was changed this sitting** — `git diff --stat` empty at
  audit time. Last substantive commit remains
  `chore(deps): drop three unreferenced root devDependencies`.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `.claude/agents/` and `.claude/hooks/` are gitignored here.

## Docker

**Not run and not observed this sitting.** Bootstrap state remains
unverified — run `docker ps -a`, not `docker ps`, before trusting anything
about the volumes.

## Recommended next

Dennis named no next issue, so: **none queued.**

For the backlogs run `gh issue list --state open` and
`gh issue list --repo DyeAllPies/dyeallpies-skills-pack --state open`.
What a query cannot carry is the ordering:

- **#556 is owner-gated, not session-gated.** Do not re-attempt the flip
  from a session; it will be denied again. #523 and #526 sit behind it.
- **Pack #398 is the readiest thing on the board** — root-caused, with the
  fix already existing in the sibling guard its own header cites. Needs the
  edit plus a regression pair, from a pack session. It cost this sitting a
  tool choice: issue bodies quoting a `.claude/hooks/` path next to `node`
  are the false-block shape, so bodies were written with `Write` rather than
  a Bash heredoc.
- **#557 is new and pairs with #398/#555 as a pack-prose batch** — HANDOFF.md
  carries load-bearing mechanism claims under no grading rule, which is
  precisely how the false claim above reached this session wearing the word
  "Measured". Its own "not established" item is whether the pattern recurs;
  a `git log -p HANDOFF.md` sweep would settle it.
- **#558 wants a direction call from Dennis before anyone codes it.**
  `routing-gate`'s four carve-outs are each correct and union to leave a
  tracker-only sitting completely ungated. The obvious fix — gate on
  `gh issue create`/`comment` — would fire on the disciplined side track
  `github-issues` says costs nothing, so the remedy is genuinely open.
- **#752 still wants Dennis, not a session.** The #684/#800/#801 ownership
  cluster remains the highest-severity item and is still blocked on the
  RF010/RF021 actor model.

## Conventions this sitting confirmed

- **Re-measure a handoff's mechanism claims before building on them.** This
  sitting's entire opening was spent on a prescription that did not survive
  first contact. State claims (branch, cleanliness) are cheap and were fine;
  the mechanism claim was the expensive one.
- **`Glob` returns nothing under `.claude/skills/`** — the entries are
  symlinks. Reach them by explicit path. Already documented in
  `dennis-windows` (#157); loading that skill first would have saved the
  detour.
- **Work directly on the integration branch, commit per slice** (#552).
- **Route before touching the tracker, not after.** This sitting invoked
  `work-issue`/`resolve-issue` only because the Stop hook demanded it, and
  by then every filing decision was made. `routing-gate` stayed correctly
  silent throughout — that gap is now #558.
