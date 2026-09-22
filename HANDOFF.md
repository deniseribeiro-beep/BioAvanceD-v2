# HANDOFF

**Written 2026-09-22, thirty-second queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instructions this
sitting: pick the next group of issues, and **keep Docker off** (carried
forward from the previous sitting and re-confirmed). No Docker command was
run.

## What shipped

Five commits on `feature/docker-e2e-backend-integration`, all pushed; tree
clean and matching origin. Last substantive commit `0facaf31`.

The group was **the temperature-policy / threshold subsystem**, picked as a
cluster rather than by issue number, plus one RBAC sibling.

- **#1089 — closed, `bb129012`.** The six policy CRUD routes wrote
  `collection('policies')` while the telemetry path read
  `temperaturePolicies`. Both sides now resolve the canonical store.
- **#1074 — closed, `1ace5a27`.** The three policy WRITES moved off
  `viewTemperature` onto a new `manageTemperaturePolicy`.
- **#1118 — closed, `aafb2863`.** `checkPolicyAndAlert` deduplicates the
  threshold-breach row per episode instead of per reading.
- **#1087 — closed, `b04ba4c3`.** The three equipment GETs gained a new
  READ-only `viewEquipment`.
- **#1140 — filed and closed same sitting, `0facaf31`.**
  `SensorMetadata.temperaturePolicy` had no writer outside the e2e fixture;
  `linkSensorMetadata` now binds it at registration.

## The three decisions Dennis made, which the next session should not re-open

1. **#1089 direction 1** — `temperaturePolicies` survives as the single store.
2. **#1089 Q4** — the HTTP contract keeps its legacy field names, translated
   at the route boundary. The stored document is canonical.
3. **#1089 Q1** — `policyName` is a new REQUIRED request field, supplied by
   the operator, not synthesized.

**Q2/Q3 were NOT his** — I inferred them from Q4 (a GET still exposes
`temperatureUnit`/`alertDelayMin`, so they must round-trip and persist as
non-canonical extensions). That inference is labelled as mine on #1089 and is
the thing #1139 re-opens.

## Issues touched but not closed

Query for state — `gh issue list --state open`. What a query will not tell
you, one clause each:

- **#1139** — filed today. Retires #1089's boundary translation. Carries the
  frontend's 27 legacy-name occurrences, and a comment recording that #875's
  PUT allowlist became a *map* whose eight unpinned values are a live typo
  risk until this lands.
- **#1141** — filed today. Decision record: should a Técnico rewrite an alert
  threshold? One line in the seed either way.
- **#1142** — filed today. The alert-lifecycle pair is now duplicated in full
  between `scheduler.service.js` and `temperature.service.js`, linked by
  comments rather than code.
- **#1143** — filed today. Decision record: the operator is still notified on
  every breaching reading; only the row was deduped.
- **#1144** — filed today. Decision record: `b04ba4c3` removed
  equipment-inventory reads from UsuarioExterno.
- **#1145** — filed today, and the sharpest of the six. The 'Novo Sensor'
  policy dropdown writes `Sensor.policyId`, which **no resolver reads**. It
  is a third disjoint policy reference and an affordance that reports success
  while binding nothing.
- **#941** — commented only. The new dedup is check-then-act, so "one row per
  episode" is the common case, not an invariant; the unique partial index
  that would make it one cannot be built while this issue stands.
- **#846** — commented only. A mirror case for that cluster: a mock that
  *accepts* an operation the real driver rejects.
- **#1127** — **untouched this sitting.** Still open only on its live-stack
  proof. Do not re-pick it as unstarted work.

## Corrections the next session should not re-derive

- **#1087's title says `GET /analytical` "has no org scope either". It does**
  — #1081 added it. Only the missing-permission half was live.
- **#312 is CLOSED and resolved.** The 'Novo Sensor' form *does* have
  `macAddress` and `storageContainer` inputs (`0677cab5`). I asserted
  otherwise on #1140 from #311's older close comment and corrected it there.
  **A grade carried from a closed issue's comment is not yours** — re-derive
  it.
- **A route-file comment must not spell a permission gate in its literal call
  form.** `[ran it]` `rbac-actions.arch.test.js` parses these files for gate
  call sites and reads it as a registration that does not exist — two arch
  failures, `no action derivable from null`, pointing at a comment.

## Two verification facts worth keeping

- **`[ran it]` The architecture suite runs under `node --test` via
  `npm run test:architecture`, NOT vitest.** A derived test list from
  `git grep -l` therefore hands vitest a file it silently ignores at exit 0
  — named 77, ran 76, and the dropped one was the RBAC arch test. Run it
  separately after any permission-catalog change.
- **`[ran it]` A file list passed as `$(cat …)` must use a LITERAL absolute
  path.** `full-suite-guard` is a native process that never sees your shell,
  so `$(cat "$SP/list.txt")` reads as unexpanded and blocks.

## Carried forward, NOT re-verified this sitting

Both come from the previous note and were not re-measured today:

1. **The branch basis is stale and `main` is not where the upstream work
   is.** **This remains the open decision and it is Dennis's call.**
2. **CI minutes are exhausted** (upstream tracker comment, 2026-09-20). Any
   plan needing a PR for a real CI signal is blocked until that resets.

Also still true: Mongo is a replica set upstream, and whether the
`chmod 400` keyfile step survives Docker Desktop here is
**`[not established]`** — no stack was brought up this sitting either.

## Recommended next

**None queued by name.** Dennis named no issue this sitting; he named a
*shape* ("pick the next group"), and the group is finished.

**Unverified prescription:** #1145 and #1139 are the two that most repay
being taken together — both turn on which policy identifier is canonical
once the translation layer goes, and deciding that twice separately is how
a fourth reference gets created.

Still undone from the last three notes: **diff Requisitos v4.0.0 against
v3.0.1 for RF renumbering before building further on
`E2E_TRACEABILITY_PLAN.md`.**

## Things a next session must not undo

The four from the previous note still hold. This sitting adds:

5. **`manageTemperaturePolicy` and `viewEquipment` are seeded to their
   pre-existing populations ON PURPOSE.** Both are capability *splits*, not
   grants — nobody gained access. #1141 and #1144 are where the populations
   get decided.
6. **`viewEquipment` is READ-only deliberately**, so it can never be reused
   to gate a write the way `viewTemperature` was before #1073.
7. **`temperaturePolicy` must drop out of `$setOnInsert` whenever it is
   `$set`.** MongoDB rejects a field named in both, and no mock in this repo
   can produce that red — `sensor.service.test.js` pins it both ways.
8. **`policy.routes.js`'s `toCanonical`/`toApiShape` are the whole boundary.**
   Don't add a third copy of the mapping; #1139 removes the two that exist.
