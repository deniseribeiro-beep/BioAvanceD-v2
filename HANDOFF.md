# HANDOFF

**Written 2026-09-22, thirty-fourth queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction: read the
handoff, pick the next group. **Docker was AUTHORIZED mid-sitting** ("you can
start docker") but **the engine was never reachable** — see "Waiting on
Dennis".

## What shipped

Two commits on `feature/docker-e2e-backend-integration`, both pushed; tree
clean and matching origin.

- **`23b57fc1` — #929 closed.** `eConsent.js:73`'s `POST /generate-link` was
  the last of #888's four `createPatient` borrowers. It now gates on a new
  `requestConsent` (`resourceType: 'Consent'`, `allowedActions: ['CREATE']`),
  seeded to Coordenador + Administrador — the tier `createPatient` already
  resolved to, so a no-op for every real caller.
- **`61a8e294` — #1150 closed** (filed and fixed the same sitting).
  `POST /api/e-consent/consents` was `authenticate`-only: any authenticated
  principal could record a consent for any participant. Now
  `requireRole(3, 4)`, matching the revoke sibling #684 fixed.

## Dennis's two decisions this sitting — do not re-litigate

1. **"We don't touch Denise's branches ever unless stated otherwise."** Not
   just `main`. No merge from, into, or push to any branch this session did
   not create. **Reading one is fine and is how you find upstream work.**
   This came up because the branch measures **18 ahead / 699 behind**
   `origin/stabilize/v2.0.0-prototype`, which already contains this branch's
   older commits — she absorbs our work periodically. **That is context, not
   a task.** Filed as a conventions gap on the pack tracker.
2. **Técnico reads storage topology; Coordenador and above write it.** This
   answered #929's check 2 (same tier, different code), #1148's seeded
   population, and the RF006-vs-RF017 actor question in one go. **#1146
   stands as shipped.**

## The RF006-vs-RF017 "actor disagreement" does not exist

Four issues carried it (#888 → #929 → #1148 → #1151) and none had read the
entries. **[read it]** `requisitos-index.md:82-95` and `:256-270`: **RF006 is
specimen custody** (Ator Técnico; 6 ACs, all custody events), **RF017 is
equipment and topology** (Ator Coordenador; 7 ACs, all containers/devices).
Different subjects, so different primary actors is expected, not a
contradiction — and Dennis's answer matches the documents rather than going
beyond them. **#1151 was filed and then closed `premise-corrected` this same
sitting on that reading. Do not re-open the actor question.**

What IS open on that axis is **scope**, and it belongs to **#1147**: RF017's
ACs begin at **Freezer** and **Facility/Room appear in none of the seven**,
while both route files cite dict-02 `facilityId`/`roomId` (ELM-0168/0169,
1..1 Core).

## The most reusable finding: #921's premise is wrong

**[ran it]** The issue says 53 RBAC gate call sites. The real number is
**194** — `git grep -o -I -E "requireRole[(]|requirePermission[(]"` over the
two route dirs gives 207, minus 13 prose-in-comment lines, across 39 files.
**No derivation reproduces 53; treat it as unsourced.**

Worse, **its proposed guard would certify the hole it was built to find.**
Remedy step 2 asks that some test contain the route path *and* the literal
role list — and for `requireRole(4)` the literal is the character `4`.
**[ran it]** `compliance.routes.js:20` passes that check while
`compliance.api.test.js:33` stubs the gate to `next()` in the same file.
**Do not build finding 1's remedy as written** — full corrections and a
redesign sketch are in the issue's comments.

## Waiting on Dennis

- **Start Docker Desktop.** He authorized Docker and chose the test stack for
  **#1127's live-stack proof**; `docker version` could not reach
  `dockerDesktopLinuxEngine` all sitting, and the skills forbid launching the
  GUI unprompted. Nothing Docker ran. **No stack state exists** — no
  bring-up, no bootstrap, no seed.
- **#1123's ownership question**, which also gates #1149:
  **are role→permission grants catalog-owned or operator-owned?**
  `[ran it]` `upsertRole` (`rbac-catalog-seed.service.js:404-418`) union-merges
  on every boot, so a runtime permission toggle can be switched **on** but
  never **off**. Everything else for that pair is measured and ready to build.

## Issues touched but not closed

Query for state — `gh issue list --state open`. One clause each on what a
query will not tell you:

- **#1123** — commented, not started. Four sources of truth, not three; both
  its `[not established]`s settled; direction 1 blocked on the question above.
  **Recommendation in the comment is read-only + delete the PUT**, inferred
  from dict-02 giving `UserRoleAssignment` a full grant/revoke audit and
  `Role.permissionIds` none.
- **#1149** — filed this sitting. The `PUT /api/security/permissions` no-op.
  Direction 1 needs no answer from #1123; direction 2 is incoherent until it.
  **[read it]** It also writes a `severity: 'critical'`, `status: 'success'`
  audit row per toggle (`security.service.js:555-574`) for a change that
  alters no authorization decision — an affirmatively misleading compliance
  record, which rules out direction 3.
- **#921** — commented, `premise-corrected`. See above. Needs a redesign, not
  a build.
- **#1127** — untouched again, still open only on its live-stack proof.
- **#1147** — untouched this sitting.

## Recommended next

**None queued by name.** **Unverified prescription:** once Docker is up, the
test stack discharges **#1127** and re-checks #1150's three e2e callers
(`pipeline-continuity`, `study-protocol-collection-crud`,
`interop-monitoring`) — **[read it]** all three authenticate as admin, so they
should pass the new gate unchanged, but that is read, not run.

Still undone from five notes: **diff Requisitos v4.0.0 against v3.0.1 for RF
renumbering** before building further on `E2E_TRACEABILITY_PLAN.md`. It now
also bears on #1147 — the RF006/RF017 reading above is against the
`docs-7-27-2026` extraction as it stands in the tree today, and a renumbering
would move the identifiers under it.

## Things a next session must not undo

Items 9-11 from the previous note still hold (`viewStorageTopology` is
READ-only and deliberately STAFF-seeded and now owner-ratified; it is not a
`viewEquipment` reuse; run `npm run test:architecture` separately after any
permission-catalog change — it is `node --test` and vitest silently ignores
its files). Plus:

12. **`requestConsent` is CREATE-only on purpose.** The route is a POST and
    `METHOD_TO_ACTION` derives CREATE; a wider set would let it later gate a
    read or delete the way `viewTemperature` was reused before #1073.
13. **`POST /consents`' gate is `requireRole(3, 4)`, not a permission code,
    and that is #684's settled reasoning, not an oversight.** Ownership is
    not available on that route: `req.user` carries a userID into `users`,
    never a participantId.
14. **The `#921` slice-5 pin table in `eConsent.routes.test.js` now says 12
    real sites, re-derived.** It said 10 of 11 and cited a line number that
    had moved. Re-derive rather than trusting it if you add a gate there.
