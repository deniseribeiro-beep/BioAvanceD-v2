# HANDOFF

**Written 2026-09-22, thirty-third queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction this
sitting: read the handoff, pick the next group. **Docker stayed off**
(carried forward and not revisited). No Docker command was run.

## What shipped

One commit, `d2004471`, on `feature/docker-e2e-backend-integration`, pushed;
tree clean and matching origin.

**#1146 — filed and closed this sitting, `d2004471`.** The four
facility/room GETs were `authenticate`-only. They now require a new
READ-only `viewStorageTopology`, `resourceType: 'StorageContainer'`, seeded
to Tecnico + Coordenador + Administrador.

## The group, and why it is not the one the last note prescribed

The previous note's **unverified** prescription was #1145 + #1139. I checked
both before picking and **#1139 is blocked**: its own body assigns the Q2/Q3
decision to Denise, and retiring the translation re-opens Dennis's own #1089
Q4 answer from last sitting. **#1145 direction 1 depends on #1139; direction
2 does not** and is still a live, workable bug.

Dennis chose the alternative when asked: **the RBAC gate cluster**, the
unswept remainder of last sitting's #1074/#1087. #1146 was its first member.

## Two issue bodies were stale, and neither was discoverable from the tracker

**This is the sitting's most reusable finding.** Both were overtaken by
commits citing their own numbers, with nothing recorded on the issue:

- **#929's census is stale.** `[ran it]` All nine equipment/facility/room
  write sites already gate on `manageStorageTopology`; the catalog's own
  source comment records the widening under #929's number. Its check-1
  question (would a READ/UPDATE-only set 403 the creates?) is answered in
  the code. **Commented twice.**
- **#921's finding 2 is already done**, `720368c8`. `[read it]`
  `rbac-actions.arch.test.js` states its own scope: it covers finding 2 and
  **explicitly not finding 1**. **Commented.**

`git log --oneline --all --grep="#<N>"` would have caught both and is worth
running before picking anything.

## Issues touched but not closed

Query for state — `gh issue list --state open`. One clause each on what a
query will not tell you:

- **#1147** — filed today. `[ran it]` The facility/room CRUD surface has
  **no caller anywhere** (only `app.js`'s mounts and its own test).
  Commented with the RF017 reading below.
- **#1148** — filed today. Decision record for #1146's seeded population,
  in #1141's and #1144's shape. **The one that most wants Dennis's eye.**
- **#929** — commented twice, still open on its real remainder: `eConsent.js:73`
  alone. I withdrew my own mid-sitting claim that `import-lgpd.routes.js`
  was a second borrower family — `[read it]` its six `createPatient` sites
  gate patient routes and are correct.
- **#921** — commented only; finding 1 and remedy steps 2/4 remain.
- **#1145, #1139** — read and evaluated, untouched. See above; do not
  re-pick #1139 as unstarted.
- **#1127** — untouched again. Still open only on its live-stack proof.

## A doc reading worth keeping

`[ran it]` **RF017's topology begins at Freezer** —
*"Representar Freezer > Prateleira > Rack > Caixa > Posição"*
(`docs/docs-7-27-2026/extracted/requisitos-index.md:256`). **Facility and
Room appear in none of its seven acceptance criteria**, and its
**Ator primário is Coordenador**. Both route files instead cite dict-02
`StorageAssignment.facilityId`/`roomId` (ELM-0168/0169, 1..1 Core).

So the requirement and the dictionary disagree on scope, which is what #1147
and #1148 both turn on. #929's **RF006-vs-RF017 actor disagreement** is
still the right place to settle the actor question once for the whole
storage area rather than per issue.

## Corrections the next session should not re-derive

- **`Fixes #N` in a pushed commit does NOT auto-close here** — commits land
  on a non-default branch. Close by hand; the auto-close trap the close
  discipline warns about cannot fire on this repo.
- **#929's check 1 is answered**: `manageStorageTopology` already carries
  the full CRUD set, widened under #929's own number.

## Carried forward, NOT re-verified this sitting

Both from the previous note, not re-measured today:

1. **The branch basis is stale and `main` is not where the upstream work
   is.** **Still the open decision, still Dennis's call.**
2. **CI minutes are exhausted** (upstream tracker comment, 2026-09-20).

Also still true: Mongo is a replica set upstream, and whether the
`chmod 400` keyfile step survives Docker Desktop here is
**`[not established]`** — no stack was brought up this sitting either.

## Recommended next

**None queued by name.** The group Dennis picked has one member left.

**Unverified prescription:** **#929's eConsent leg** is the group's
remainder, but it is blocked on the same `[not established]` #888 left —
whether a borrower should be a different *tier* rather than a
differently-named code at the same tier. That question, #1148's population
question and #929's RF006-vs-RF017 disagreement are **one decision asked
three ways**, and answering it once unblocks all three. Worth putting to
Dennis as a single question rather than working around it.

Otherwise **#1123** (three sources of truth for RBAC permissions) is the
cluster's remaining structural item and needs no owner call to start:
direction 1 is what dict-02 describes.

Still undone from the last four notes: **diff Requisitos v4.0.0 against
v3.0.1 for RF renumbering before building further on
`E2E_TRACEABILITY_PLAN.md`.**

## Things a next session must not undo

The four from before the previous note still hold, plus its 5–8, plus:

9. **`viewStorageTopology` is READ-only and seeded to STAFF deliberately.**
   Unlike #1074's and #1087's splits this is **not** a preserved
   pre-existing population — that population was everyone authenticated, so
   any gate narrows. #1148 is where it gets confirmed.
10. **It is NOT a reuse of `viewEquipment`, on purpose**: `viewEquipment`
    carries `resourceType: 'Device'`, which a facility is not, and dict-02
    makes `resourceType` a 1..1 Core field (P1X-0221).
11. **Run `npm run test:architecture` separately after any
    permission-catalog change.** It runs under `node --test`, not vitest —
    a derived file list hands vitest a file it silently ignores at exit 0.
