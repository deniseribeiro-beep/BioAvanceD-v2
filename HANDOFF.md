# HANDOFF

**Written 2026-08-27.** Dennis asked for the next five issues, left the
pick to me, and authorised Docker. **The queue is worked: 4 closed (plus
#805 cascaded), 1 deliberately left open with reasons below.** This is
the definitive rotation for this sitting.

## What this sitting did

Theme: make the consent-invitation path actually work end to end, close
two fail-open/fail-silent holes in the frontend and the importers, and
spend the Docker sequence on the two items only a live stack could
settle.

| # | Issue | Route | Outcome |
|---|---|---|---|
| 1 | **#809** bulk consent-token page never built | build-loop | **closed** `58c34236` / merged `76e893f9`; cascaded **#805 closed** |
| 2 | **#810** publish sweep aborts on first throw | fix-bugs | **closed** `b8ab77cb` / merged `df373af2` |
| 3 | **#816** `canRoleAccessRoute` fails open | fix-bugs | **closed** `1086502b` / merged `d17e7828` |
| 4 | **#815** `downloadTemplate` builds a dead URL | fix-bugs | **closed** `e4e4d4fd` / merged `dd6cf43d` |
| 5 | **#813** async importer has no quarantine | build-loop | **half shipped** `164e9b23` / merged `d5b3dbc5`; **OPEN** |

## The pattern this time: the *evidence* was wrong, not just the premise

Last sitting's lesson was "bodies are wrong about their premises." This
sitting sharpens it: the issue's own **cited evidence** was unsound
twice, and both times the false confidence came from a search that
silently found nothing.

- **#813's key grep was a false negative.** The body ran
  `git grep -n -i "quarantin|staging|..."` and **git grep without -E
  treats the pipe literally**, so it searched for one long nonsense
  string and reported "(no matches)". Re-run with `-E`, the async path
  turns out to *have* a staging layer (`StagingImport`, rows classified
  VALID/PARTIAL/INVALID). Its substantive claim survived anyway, and got
  sharper: the engine records the line *number* plus errors in a field
  literally named `row`, which is why it reads like the row data at a
  glance. **Add the missing -E to the junction/-r trap list: same
  failure shape, different flag.**
- **#813's cited line numbers pointed at the wrong branch.**
  `import-worker.js:169-224` is the dataType switch; `/import` goes
  through the other branch (`batch-import` to `processBatchImport`).
- **#805's "Suggested fix" would have shipped a broken link** — recorded
  last sitting, confirmed again while closing it.

**Operating rule this produced:** when an issue's evidence is a shell
search, re-run the search before trusting its conclusion — not just the
claim it supports. Two of the five queue items turned on this.

## Where #813 stands (the one left open)

**Shipped:** `quarantineRejectedRows` writes an `import_batches` doc plus
one `import_staging_records` doc per rejected row **carrying the original
row**, into the same collection pair the LGPD importer has used since
#787, with `type: 'ASYNC_BATCH_IMPORT'` so the LGPD/FHIR readers (which
filter on `type`) cannot pick these up by accident — #799 in reverse.

**Open for two independent reasons:**

1. **Patients are deliberately excluded.** A patient row carries
   patientName/birthDate/email — civil identifiers, encrypted at rest
   everywhere else (#566). Staging them would widen **#807**'s
   plaintext-at-rest problem to the most sensitive import path, which is
   exactly the ordering **#814** exists to protect. Samples are
   pseudonymous, which is why #787 could stage them.
2. **The real-backend proof cannot pass yet — blocked on #826.**

## #826 is the biggest thing found this sitting

`tests/e2e/async-import-quarantine.spec.ts` is **committed and currently
red on purpose**, annotated in place. Do NOT weaken or skip it to get a
green gate — the failure is the proof of #826, the same convention as
`tcle-dinamico.spec.ts` RF010 AC#2 test.

**The operator-facing batch import never completes at all.** The worker
process opens only a *native driver* connection (`connectDB()` in
`database/mongo.js`), while `StagingImport` is a **Mongoose** model. With
no Mongoose connection every `StagingImport` write buffers and rejects
after 10s, the job fails, retries forever, and the document stays at
`status: queued` with `processedRows: 0`. The API process *does* have
Mongoose, which is why the upload returns 202 with a jobId and the
document is created — the split is exactly API-yes / worker-no. An
operator import silently never happens.

## Filed this sitting (7)

- **#820** — `createPatientConsent` **422s every signature-less
  manifestation**: `normalizeSignaturePayload` injects empty strings and
  a null into three fields the schema declares `minLength: 1`. The only
  production caller that sends no signature is the participant e-consent
  page own submit. **So "system 1 works end to end" — asserted in the
  last handoff and in #809 body — is false.** Needs an owner call: RF010
  AC#4 says "signatário", so "signatures are optional" is not obviously
  the right reading.
- **#821** — the bulk accept path records **no `Consent` at all**
  (RF010 AC#2/#3/#4/#5/#7). Blocked on #820. Also carries #809
  unanswered convergence question (Denise call).
- **#822** — both public participant pages call the backend with
  **relative /api URLs, and nothing proxies /api** in dev, test or prod.
  Every such request returns the SPA index.html.
- **#823** — `POST /consent-tokens/validate` is an unauthenticated
  **participant-enumeration oracle** (three distinguishable messages).
  Also confirmed: **there is no rate limiting anywhere in the backend.**
- **#824** — **publishing a TCLE through the operator UI issues zero
  consent invitations.** The builder posts to `createTemplate` (no
  notification sweep); the only sweep lives in `createPolicy`, whose
  frontend client is commented out.
- **#825** — route authorization contradicts itself: `canRoleAccessRoute`
  silently overrules the `<Route>` own `requiredRole`, so
  `Usuário Externo` cannot open `/reports` (the one thing that role
  exists for) and **no `Coordenador` can open the TCLE builder**.
- **#826** — above.

Comments added to **#793** (it now has a second producer), **#821**, and
pack **#270** (a fourth data point on the full-suite guard not firing).

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`d5b3dbc5` plus this rotation). No open PR; `main` untouched, frozen.
- All five work branches merged and **deleted locally**. None was pushed,
  so there are no remote branches to clean up — a deliberate deviation
  from the "push the fix branch then merge" step, since nothing needed
  them to exist remotely.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- **#752** red is unchanged and pre-existing; not re-checked.

## Docker — read this before the next gate

**Stack: DOWN (0 containers). Volumes: PRESENT AND FULLY BOOTSTRAPPED.**

`docker compose down` was run **without** `--volumes`, so the four named
volumes survive. Bootstrap state was verified **empirically, not from the
container list** — the one-shot bootstrap containers are gone, so
`docker ps -a` proves nothing here:

    activeReleases=16   users=2   hpoRoot(HP:0000001)=1

and `realLogin` as admin succeeded against this stack during the #813
run. **The next gate does not need to repay the reference-data chain.**

`backend-app-test` and `worker-test` images were rebuilt after #813
(`164e9b23`), so they carry every backend change from this sitting. Both
are build-not-mount: rebuild before trusting them against any later
backend change.

**Cleanup done:** stack down, build cache pruned with `-af` (**1.065GB**
reclaimed, now 0B), `test-results/` removed, temp files removed.
**Left deliberately:** the four named volumes, and **30 images /
4.61GB** — removing them forces a full cold rebuild and they are the
expensive half. `docker_data.vhdx` is **16.15GB physical** behind ~5.5GB
logical, so ~10.6GB of air (was 15.57GB last sitting). Still not the
extreme case that justifies a vhdx reset.

**Deferred proof outstanding:** `async-import-quarantine.spec.ts`, red
on #826 — the only one.

## Verification summary

- `consent.controller.test.js` **81/81** (6 new, red-first)
- `consent.service.unit.test.js` **116/116** (6 new, red-first)
- `rolePermissions.test.ts` **10/10** (new file, red-first)
- `import-lgpd.controller.test.js` **54/54** (6 new, red-first)
- `batch-validation-engine.service.test.js` **24/24** (7 new, red-first;
  the wiring pair verified red by revert / re-run / reapply)
- `consentTokenView.test.ts` **15/15** (new file)
- `consent-token-page.spec.ts` **4/4** against the real stack, nothing
  logging in — the #809 proof
- Frontend unit suite **149/149** before #816 file was added

## Recommended next steps

**None queued — Dennis has not named the next group.** In the order I
would argue for them:

1. **#826** — the operator-facing import silently never runs. It also
   unblocks #813 committed proof, which is red until it lands.
2. **#824** — publishing a TCLE notifies nobody. Same class, consent
   domain.
3. **#820 then #821** — in that order; #820 is a live break of the
   participant consent submit and needs one owner call.
4. **#807 then #814 then the patients half of #813** — that exact order.
5. **#825** — two role contradictions, both cheap once the direction is
   chosen.

The `#684 / #800 / #801` object-ownership cluster is still the
highest-severity item overall and still blocked on the RF010/RF021 actor
model — unchanged this sitting.
