# HANDOFF

**⚠ INTERIM SNAPSHOT — this session is still running.** Written after
iteration 2 of a self-picked 5-item queue. **2 of 5 resolved so far, 3
remain.** This is NOT the definitive rotation for the sitting; if you are
reading it cold, the sitting ended unexpectedly mid-queue.

## The queue

Dennis asked for the next 5 issues and left the pick to me, then said
**"Docker is on"** — the first sitting in a while with the engine
authorised. Theme: finish the consent-invitation path, make the LGPD
import usable from the UI, and spend the (expensive) cold Docker
sequence on the two items only a live stack can settle.

| # | Issue | Route | State |
|---|---|---|---|
| 1 | **#805** consent link emails `/patients/undefined/consent` | fix-bugs | **half fixed** `2a374ce1` / merged `2f6bcbd3`; **OPEN**, frontend half is #809 |
| 2 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **closed** `1886a3c8` / merged `10f3710f` |
| 3 | **#808** LGPD import has no frontend caller | build-loop | not started |
| 4 | **#794 item 3** correct-and-resubmit | build-loop | not started |
| 5 | **#722** RF029 tests depend on the bootstrap chain | test-loop | not started |

#802 was in an earlier draft of the queue and was dropped in favour of
#796. It remains open and unworked.

## The theme that has emerged: issue bodies are wrong about *docs*, not just code

Both iterations so far turned on a premise in the issue body being
false, and in both cases the false premise pointed at the **wrong fix**,
not merely a mis-scoped one. This is sharper than the existing
"check, don't distrust" rule and worth carrying forward:

- **#805's "Suggested fix" would have shipped a broken link.** It
  proposed emitting `/patient/e-consent/${token}`; that page's validator
  `jwt.verify`s and every caller passes a 64-char random hex from a
  *different* token system. The link would have 400'd on every use, and
  no test would have caught it because they all mock `buildConsentLink`
  out. → pack **#469**: `fix-bugs`' body-skepticism rule covers the
  defect trace but not the body's *proposed remedy*, and re-tracing the
  defect *feels* like it discharged the skepticism for both.
- **#796's "docs say nothing" was wrong.** RF015 AC#3
  (`docs/docs-7-31-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md:442`,
  "Registrar tentativas, falhas, entrega e confirmação") explicitly
  mandates recording notification failures. The earlier check grepped
  the **field names**; the requirement is Portuguese prose sharing no
  identifier with the code. → pack **#470**.

**Operating rule for the rest of this queue and beyond: a "docs are
silent" conclusion in this repo requires a concept-level search in
Portuguese, not an identifier grep.** The docs are Portuguese, the code
is English; they routinely share no token.

## Iteration 1 — #805 (open)

`buildConsentLink` now reads `participantId`, encodes the id segment,
and throws `CONSENT_PARTICIPANT_ID_REQUIRED` rather than interpolating
`undefined` into a URL it is about to email. Body said four callers;
there are **six** (it missed `patient.service.js:579` and `:1046`). Body
said two link builders; there are **three**
(`fhir-import-staging.service.js:347` builds the import variant).

What settled it was the **consuming contract**, not docs:
`POST /api/e-consent/consent-tokens/{validate,accept}` resolve the
patient by `{ participantId }`.

**Still open because the link is still dead.** It now reads
`/patients/00000042/consent?token=…` and lands on `App.tsx:95`, which
points that route at `EConsentPage` — an *alias import of the same
module* as the participant JWT page — behind `ProtectedRoute`, and that
component reads its token from route params this route does not have.

### The two-token-system finding (read before touching consent)

1. **JWT, manual, works.** `POST /api/e-consent/generate-link`, **2h**
   TTL, emails `/patient/e-consent/${token}` → public route →
   `GET /api/e-consent/validate/:token` (`jwt.verify`). Staff-triggered,
   one participant at a time.
2. **Opaque random hex, bulk, no page.** `buildConsentMetadata()` →
   `randomBytes(32)`, **7-day** TTL, persisted as Patient's
   `consentToken`/`consentTokenCreatedAt`/`consentTokenExpiresAt` — all
   **canonical** fields. All six `buildConsentLink` callers use it.
   Backend complete (validate + accept, status/expiry checks, proper
   `ACTIVE` transition). **Zero frontend callers.**

`/patients/:id/consent?token=` is the *correct* shape for system 2's
contract. The page was never built. **#809** has the full write-up. Do
not "unify the builders" without reading it — which system supersedes
which is Denise's call.

## Iteration 2 — #796 (closed)

Deleted `persistConsentDeliveryFailure`. It was broken **twice**: the id
chain early-returned on every call, *and* its query
(`{ $or: [{ patientID: ... }, { _id: ... }] }`) would have matched
nothing even with the id fixed — `patientID` is prohibited and `_id` is
an ObjectId compared to a string. It also wrote three non-canonical
fields onto Patient through a raw driver `updateOne`.

Per Dennis's rule ("if it's not in docs and no other system needs it,
delete it"), the second half held — zero readers repo-wide — but the
first half did not, per RF015 AC#3 above. So the recording moved to
where RF015 puts it: **the notification**. `sendEmail`'s provider call
is now wrapped and a failure persists a `DELIVERY_FAILED` compliance log
before rethrowing, covering every notification type.

**This closed a real gap the no-op had been hiding:**
`persistComplianceLog` ran only on the success path, so *every* failed
notification left no record at all.

## Filed this sitting so far

**Project:**

- **#809** — bulk consent-token system: complete backend, no frontend.
  #805 depends on it.
- **#810** — publishing a consent template wraps its `try` around the
  `for`, so one patient that throws ends the whole sweep: everyone after
  gets no invitation **and** no `consentToken`, and publication still
  reports success. Reachable via one participant with no email.
- **#811** — RF015 AC#3's remaining legs: pre-send validation failures
  (no recipient resolved yet to record against), "tentativas", and
  AC#4 escalation.
- **#812** — `notification_compliance_logs` stores participant emails
  forever and **no retention policy can even be created for it**:
  `retentionPolicy.service.js:11` allows only `AuditEvent`/`Log` (#667's
  limitation). #796 adds failure rows to it. Decide alongside #793.

**Pack:** #468 (a mistyped filename in a targeted `vitest run` is
silently ignored — 8 named, 7 run, exit 0; **check the reported
`Test Files` count against the number you named**), #469, #470, #471
(`git grep` over `grep -r` — a stale gitignored `frontend/dist/` dumped
73KB of minified bundles into context). Counter-case comment on #463:
the routing gate blocking my first `AskUserQuestion` is *why* RF015 got
found — worth narrowing #463's fix on **what the question is about**,
not when it is asked. Data point on #410.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`10f3710f`). No open PR; `main` untouched and still 99 behind.
- Both fix branches deleted **local and remote**, no prompt either time.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Pre-existing branches unchanged: `test/787-lgpd-import-staging`
  (merged, safe to delete after checking per-commit authorship,
  precedent #332), `fix/599-*` (both merged), `test/377-docs-on-main`
  and `test/human-showcase-video` (not merged), plus the two stale
  remotes left alone deliberately.
- **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Engine is UP (28.5.1) and authorised — but nothing has been started.**

- **Services: none running, none stopped.** `docker ps -a` returns zero
  containers.
- **Bootstrap: NONE.** The four named volumes
  (`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`) are still
  absent — `docker volume ls` shows no `*test*` volumes at all.
- A gate still needs the **full cold sequence**: the 12-service recipe
  with `--build`, then `admin-bootstrap-test`, then the entire
  17-service reference-data chain. The chain is not optional, and
  **#722 is specifically about what happens when it is skipped.**
- **Deliberate sequencing decision:** the rebuild is held until after
  the backend merges land, because `backend-app-test` is
  build-not-mount and every merge makes it staler. It was four merges
  stale at the start of this sitting and is now **six** (`2f6bcbd3`,
  `10f3710f`). Rebuild once, late, then run items 4 and 5's gates
  against it.
- **No deferred e2e proof is outstanding.** Both fixes so far are pure
  backend functions proven natively; nothing waits on a gate.

## Recommended next steps

**Continue the queue — item 3 (#808).** Note its body predates last
sitting's work: its own "option 2" (add `GET /api/import-lgpd/batches`
plus a batch list page) **already shipped** as #794 item 2, so the live
question is now only option 1 (wire the LGPD import into the UI) vs
option 3 (delete `importLGPDService` as cruft and treat LGPD import as
API-only). Apply the docs rule above before concluding anything is
undocumented.

Then #794 item 3, then #722 behind the cold Docker sequence.
