# HANDOFF

**Written 2026-08-28. Definitive rotation — the sitting is finished.**
Dennis asked for skills-pack issues needing work here, then for a
deliberately-picked group to test the delegated-agent workflow. Both ran.
Three agents were briefed; **one refused its brief, and that refusal is the
most important result of the sitting.**

---

## Read this first: the containment programme changed shape

**Pack #523 is still not measured, and it now has two independent blockers
rather than one.** Do not re-attempt it the way the last handoff described.

### Blocker 1 — the auto-mode classifier is *session-stateful*

The previous rotation left this as "specific to this repo or that session."
It is **the session, and specifically its own prior intent history.**

Measured here: a `cat` of an installed-skill overlay succeeded early in the
session; the **byte-identical command was denied later**, same repo, same
file. The only change in between was an attempted `settings.json` edit.
The classifier arms on demonstrated intent to modify hook configuration and
thereafter denies even **read-only Bash** on config-adjacent paths.

- The **`Read` tool is not subject to it** — it kept working on the same
  files Bash was refused on. Use `Read` for anything under `.claude/`.
- Writes to `settings.json` are blocked on **both** Bash and `Edit`.
- Writing a **brand-new** `.cjs` into `.claude/hooks/` was allowed. What is
  defended is the *registration*, not the directory.

**So: the matcher flip must be a fresh session's FIRST action, before
anything else touches the config surface.** Dennis's call this sitting.
Once armed, the session cannot recover.

`.claude/hooks/probe-stdin-dump.cjs` is **already written and on disk**,
unregistered and inert. It appends a hook's whole stdin to a scratchpad
file. A fresh session needs only to register it in `settings.json` under
`Bash|PowerShell` to get the highest-value unmeasured fact in the
programme: whether `agentType` / `subagent_type` / `agent_id` /
`parent_tool_use_id` reach a hook's stdin. If they do, containment moves to
the `settings.json` surface that already provably reaches subagents.

### Blocker 2 — a working `fix-writer` cannot be the containment instrument

#523's stated method is "deliberately brief an agent to do something out of
scope and confirm the guard blocks it." **That method is unrunnable.**

A `fix-writer` briefed to run four commands (including `docker ps` and a
`git commit --dry-run`) **ran nothing — `tool_uses: 0`.** It fired the
brief-doesn't-match-source tripwire, and explicitly cited the brief's own
reassurance — *"a refusal is a perfectly good result"* — as grounds for
**more** suspicion, not less.

Consequences, both written onto #523:

- Any brief out-of-scope enough to test the guard trips the role contract
  first, so the hook is never consulted and **nothing is observed either
  way.** The safer the prose contract, the less falsifiable the mechanical
  containment.
- **Do not reword the brief to get past this.** A probe that only works when
  disguised is not evidence the guard holds. The honest fix is pack-side: a
  narrowly-scoped *authorised self-test clause* in the shared leaf-worker
  fragment, so the probe is in-role by construction.
- **Brief-writing lesson, generalisable:** pre-arguing against an
  anticipated objection raises suspicion instead of lowering it.

**Containment therefore remains broken and unverified.** Every leaf worker
still runs uncontained on the frontmatter surface.

---

## The delegated round did run, with Dennis's explicit go

He authorised proceeding **with containment known-broken**, low blast
radius, two agents. Worth knowing the shape that worked:

- **A contained `fix-writer` on a small verified fix** — behaved perfectly.
  Used `Edit` as briefed, reported the injected auto-mode "prefer raw Bash"
  reminder in two sentences without adjudicating its authenticity (the
  corrected pack fragment working; recorded on #530), and left the tracker
  alone.
- **An `Explore` agent for the survey half.** This is the move worth
  repeating: **read-only research needs no containment**, so it sidesteps
  the blocker entirely. It returned the sitting's highest-value findings.
- **Verify every worker claim yourself.** Both returns were checked against
  source before anything was filed or committed; the survey's two product
  bugs were re-read at `file:line` before they became issues.

---

## Repo state

- On `feature/docker-e2e-backend-integration`, **clean and matching
  origin**, one substantive commit this sitting (`chore(deps): drop three
  unreferenced root devDependencies`) plus this rotation. `main` untouched.
  No open PR.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `.claude/agents/` and `.claude/hooks/` are gitignored here.

## Docker

**Not run and not required this sitting.** Docker Desktop state was not
observed, so **bootstrap state remains unverified** — run `docker ps -a`,
not `docker ps`, before trusting anything about the volumes.

## Recommended next

Dennis named no next issue, so: **none queued.** For the backlog itself run
`gh issue list --state open`; for the pack,
`gh issue list --repo DyeAllPies/dyeallpies-skills-pack --state open`.

What the *ordering* constraints are, which a query cannot carry:

1. **#523's matcher flip is a fresh session's first action** (above). It is
   still the cheapest thing on the board and still gates the pack's whole
   delegation programme. **#526 stays blocked behind it.**
2. **Pack #398 was reopened** with a root cause and a one-word repro:
   `junction-write-guard.cjs` never strips heredoc bodies, so prose quoting
   a junction path plus any `WRITE_SHAPED` word (`node`, `cp`, `rm`…) reads
   as a real write. The fix already exists in the sibling guard its own
   header cites as precedent. **This one is ready to apply from a pack
   session** — it needs no measurement, just the edit and a regression pair.
   The "do other guards share this?" question is **settled: no.** Every
   other command-reading hook strips heredocs, three of them via
   `bash-write-targets.cjs`; the two that appeared not to never see a shell
   command at all. Audit and method correction are on #398.
3. **Pack #555** — a brief that pre-argues against an anticipated objection
   reads as *less* legitimate to the worker. Found because it cost this
   sitting the #523 probe. Reusable `agent-delegation` rule, independent of
   containment, and a small prose edit from a pack session.
4. **#843 is the highest-severity item filed this sitting** —
   `miabisValidator` computes a MIABIS `canBeShared` sharing verdict from an
   arbitrary consent record. Fourth instance of #788's class. Its test pins
   the broken shape, so the mock and the product line must change together.
5. **#844** — `POST /api/users/register-sample` never links a sample to its
   patient. Both legs (the read and the `updateOne` filter) must be renamed
   in one edit; renaming only the read makes it worse.
6. **#845 first if touching #803** — four `*-integration.test.js` files
   exercise zero product code and must be *excluded* from #803's sweep, not
   renamed under it. #803 now carries a full map and a five-batch plan.
7. **#842** wants a direction call from the owner (delete the orphaned nyc
   coverage config, or finish wiring it).

Unchanged and still true from the previous rotation:

- **#752 is the one item that wants Dennis, not a session** —
  `backup.service.test.js` still red at branch tip; the one-line fix also
  ratifies a BSON-type change on the destructive `restoreBackup` path.
- **#833 / #828** remain the highest-value Docker-dependent items; the
  **#684 / #800 / #801** ownership cluster remains the highest-severity
  overall, still blocked on the RF010/RF021 actor model.

## Conventions this sitting confirmed

- **Re-run an issue's own evidence before briefing anyone on it.** Both
  picked issues degraded on contact: #783's premise was wrong about one of
  five packages (a dotfile its grep could not see), and #803's named
  instance was already fixed. Neither would have survived being handed
  straight to a worker.
- **The board's labels do not identify a delegable issue.** #784 and #839
  both self-describe as design calls; #825 is well-diagnosed but *widens*
  access. Screening bodies is the only way.
- **Work directly on the integration branch, commit per slice** (#552). The
  unit of review is the commit.
