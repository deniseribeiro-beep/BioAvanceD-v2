# HANDOFF

**Written 2026-08-27. Definitive rotation — the sitting is finished.**
First trial of the **orchestrator workflow** (pack #526): Dennis asked for
two delegated agents, then a round of three if the first showed no
meaningful workflow errors. It didn't. **5 issues shipped, 5 filed, no
Docker.**

## Shipped

| # | What it was | Merge |
|---|---|---|
| **#802** | `validateImportConsentToken` read `import_batches` with no `type` discriminator — a token naming an LGPD batch resolved and returned that path's quarantine document, `CPF`/`Nome` included | `5091cd08` |
| **#818** | `groupFields` JSON.parsed at four import sites with no validation; **`importPatientsSmart`'s parse had no try/catch at all** → 500 on malformed input | `5091cd08` |
| **#773** | `canonicalizeHeader` mapped two aliases onto the prohibited `patientID` | `aa26bdc1` |
| **#781** | 165 identity-form cursor mocks could not observe a sort key; now a shared `tests/factories/cursor.factory.js` | `aa26bdc1` |
| **#798** | blank rows skipped by `isEmptyRow` were counted nowhere — **items 1-2 only, issue left open** | `aa26bdc1` |

## The operating rule this sitting produced

**Verifying a signature is not verifying a contract.**

My brief for #798 said `auditLogger.logImport` "takes a `context` object,
so the new count can travel in it." The signature claim was checked; the
behaviour claim was *inferred from it* and was false — `logImport`
hand-picks context keys by name, so the value was accepted and silently
dropped. Item 2 would have shipped inert. The worker caught it by reading
the file.

In the serial loop these two collapse into one act, because you are
already reading the function you're about to change. **As orchestrator you
verify from outside code you will never open, which is exactly where they
come apart.** `agent-delegation` already forbids unverified claims in a
brief; this is the shape that slips past it.

Corollaries, both confirmed twice this sitting:

- **A worker tests what it wrote; the orchestrator must name the property
  that makes the change worth making.** #818's worker tested its new util
  exhaustively and never asserted the *controller* rejected an operator
  payload. #781's worker migrated onto its new factory and never tested
  the factory's own guarantees. Both gaps were mine to close.
- **Issue bodies' factual traces drift, and a brief inherits the drift.**
  #818 named two call sites (there are three); #802 said one
  undiscriminated query remained (there are two).

## Filed (3 product + 2 pack)

- **#837** — `importPatientsSmart`'s **`mapping`** parse is still unguarded,
  two lines below the `groupFields` one #818 fixed. Still answers 500.
- **#838** — `commitBatch` is a *second* undiscriminated `import_batches`
  read. Guarded in practice (`validateBatch` runs first), so inert.
- **#839** — the architecture test #818's body proposed.
- **#840** — decision record on #818's changed 400 message. **Filed as an
  owner's call, then withdrawn:** the trace dissolved it (the only caller
  reads `data.error` before `data.message`, and is dead code per #772).
  Retagged `enhancement`. Small consistency work now, not a decision.
- Pack **#530** (auto mode's prefer-Bash reminder reaches leaf workers;
  one read it as a prompt injection), **#531** (`edit-branch-guard` did
  not fire on three Edits on the protected branch, though it blocks
  correctly on replay). Two long comments on pack **#526** with both
  rounds' measurements.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched and frozen. No open PR.
- Last substantive commit: the `aa26bdc1` merge. All four fix branches
  merged and deleted locally; none was pushed.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- **Their presence means `edit-branch-guard`'s HANDOFF.md exemption can
  never fire here** — it requires nothing else dirty, and untracked files
  count. Don't route the rotation to a `chore/` branch either:
  `branch-guard` permits only `fix/<slug>` and `test/<slug>`. This file is
  committed directly on the integration branch, which is what the
  exemption was written to allow.

## The gate was NOT run

No Docker this sitting — Dennis's instruction. Nothing that ran is
Docker-dependent: all five slices are natively unit-testable.

**573 tests passing across the 18 touched-or-adjacent files**, re-run on
the merged tree, `api/backend`-relative and targeted. No full native suite,
no e2e.

**Every fix was verified red before it was accepted** — the product change
reverted, the test re-run, the failure observed. #802's reproduction
returned the LGPD quarantine document verbatim.

## Docker

**Docker Desktop is not running** — `docker ps -a` fails to connect. No
container or volume state was observed or changed this sitting. Whatever
the 2026-08-27 morning handoff recorded (volumes present and bootstrapped)
is unverified as of now; **re-check with `docker ps -a` before trusting
it**, per the readiness rule rather than the up/down one.

## Recommended next

**None queued — Dennis has not named the next group.** He did name the
workflow: this is now the orchestrator pattern, and pack #526 is its
tracking issue.

Two of this sitting's own filings are small, unblocked and would make a
clean next round — **#837** and **#838**, both one-file fixes with an
obvious test. **#839** wants its own sitting (the design fork between a
shallow lint and a real taint trace is the whole issue).

Unchanged from before: **#833** (no email can be sent on the test stack)
and **#828** (batch import passes a file by path between containers with
no shared volume) remain the highest-value Docker-dependent items, and the
`#684 / #800 / #801` object-ownership cluster remains the
highest-severity item overall, still blocked on the RF010/RF021 actor
model.

## If you run another parallel round

Not a rule yet — one sitting, 5 workers, n=2 rounds. What held:

- **Slices must have provably disjoint file sets.** That is what allows
  one shared `fix/` branch, one commit per slice, and a revertable bad
  slice. Partition before briefing, not after.
- **Name the tripwires.** "Stop if a test I didn't name has to change"
  fired twice, both times on a decision a worker must not make (a test
  pinning the *buggy* behaviour, which is `fix-bugs`' un-weaken case).
- **Run every slice's tests together after the merge.** A slice can break
  the repo through a shared helper without touching another slice —
  #798's 7th argument broke three assertions in a file no brief named.
- **Docker and delegation do not overlap**, per `agent-delegation`. Not
  tested this sitting; no Docker ran.
