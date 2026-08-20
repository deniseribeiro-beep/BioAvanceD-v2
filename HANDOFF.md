# HANDOFF

**Written:** 2026-08-20. Picked up right after the prior rotation's "clear
#644/#645/#647, then Wave 3" note. This sitting closed all three, then
worked Wave 3 (#646) RF014→RF017 in sequence via build-loop, checking in
with Dennis after each slice. RF017 surfaced two findings big enough that
this rotation stops here to check in, rather than continuing straight to
RF024.

## Wave 3 (#646) — 4 of 8 RFs landed this sitting

- **RF014** (Políticas de segurança) — merge `30295d40`. No product code
  changed; ACs 1/2/3/5/6/7 were already covered by existing
  `security.service.js`/`security.routes.js`. ACs 4/8 (force password
  reset, revoke sessions on policy change) are genuinely absent — filed as
  **#648**/**#649**, not built (out of this slice's scope).
- **RF015** (Alertas e notificações) — merge `c8aab8e0`. Built a
  from-scratch versioned notification-rule engine (`NotificationRule`
  model, `notificationRule.service.js`, `notificationDispatch.service.js`,
  new `/api/notification-rules` + `/api/notifications` routes), wired into
  `temperature.service.js` and `iot.controller.js`'s environmental-alert
  paths. Only wired to the `environmental_excursion` event type so far —
  the other 4 domains are filed as **#650**. Hit and fixed a real BSON
  cross-connection bug (constructing `ObjectId` from the `mongodb` package
  against a mongoose-sourced `db` throws `"Unsupported BSON version"`) —
  documented generally as **#651** since it's a reusable gotcha, not
  slice-specific.
- **RF016** (Etiquetagem) — merge `c332f5dd`. Added QR symbology, batch
  label generation, and audit/reprint tracking to `sample.routes.js`'s
  label endpoints. AC#3 (printer-layout validation) doesn't exist anywhere
  in the codebase — filed as **#652** rather than built blind. Found an
  org-scope gap on the pre-existing `symbology-assets` route while adding
  QR to it — filed as **#653**.
  **Correction, found while closing out RF017:** `sample.routes.js`'s
  label routes (what this slice built against and proved e2e) have **no
  real frontend caller** — confirmed by grep, plus one fully-dead API
  client method (`sampleChainApi.getLabelBlob`, zero call sites). The
  route a real user actually hits is a separate system,
  `label.routes.js` + `SampleLabelPage.tsx`, which has none of RF016's new
  capabilities and renders a placeholder-rectangle SVG instead of a real
  barcode. RF016's work is correct and tested, just stranded on the wrong
  surface. Full trace and a fix recommendation (point the real UI at the
  new endpoints, or port the new capabilities onto the old ones — a real
  design call either way) filed as **#655**; correction comment posted on
  #646.
- **RF017** (Equipamentos e armazenamento) — merge `d5beca6c`. AC#7
  ("bloquear local indisponível") was the only unbuilt criterion:
  `StorageBox.status`/`StorageContainer.status` existed but nothing
  checked them anywhere. Added `MongoStorageRepository.checkLocationBlocked`,
  wired into all 4 write/check paths (`validatePositionAvailability`,
  `allocateSamplePosition`, `autoAssignSamplePosition`,
  `moveSamplePosition`). Also fixed a real bug found while tracing the new
  throw through `move-sample.controller.js`: a location-blocked rejection
  was falling through to a 500 instead of 400.
  **Finding:** the `storagePaths` collection — read by
  `checkLocationBlocked`'s ancestor-level check (and 3 other existing
  call sites) — is **never written anywhere** in `api/backend/src`. Real
  boxes never get ancestor IDs populated, so the ancestor-level branch of
  AC#7 (blocking via a RETIRED/MAINTENANCE rack/shelf/freezer) cannot
  fire for any real box today. Unit-tested against a mock; NOT provable
  e2e for this reason. Filed as **#654**. The e2e proof landed
  (`tests/e2e/specimen-quality-inventory.spec.ts`, "Storage location
  availability (RF017 AC#7)") is honestly scoped to box-level RETIRED
  blocking only, via 2 of the 4 call sites (`validate` + `move`).
  Progress comment posted on #646.

## Two findings big enough to stop and check in on

1. **#654** — `storagePaths` is a structurally dead collection (read in
   4 places, written nowhere). Beyond RF017's AC#7 gap, this likely means
   dict-02's hierarchy-enrichment fields (facility/room/equipment context
   derived from a box's ancestor chain) never populate for any real
   record — not re-audited end-to-end this sitting, just traced far
   enough to confirm the write-side gap.
2. **#655** — RF016 (and, by extension, whatever the original RF007/label
   milestone work assumed) has been building/proving against a label
   route the frontend doesn't use. Worth deciding deliberately which
   system is canonical before any further label-related work, rather than
   letting a 5th slice build on either system without that call being
   made.

Neither was fixed this sitting — both are filed with full traces, not
silently absorbed into "done."

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through all four
  RF merges (`30295d40`, `c8aab8e0`, `c332f5dd`, `d5beca6c`). Working tree
  clean except the gitignored/junctioned `.claude/skills/` and an
  untracked `api/backend/storage/assays/` (pre-existing pattern, not
  cleaned up, matches sibling `storage/samples/`/`storage/datasets/`).
- No PR to `main` exists.
- **Docker**: `compose.test.yml` is still **up** as of this writing — all
  12 services healthy, `backend-app-test` rebuilt through RF017's changes
  and re-verified on the merged tree. Not yet torn down; check `docker ps`
  before assuming either state if picking this up fresh.

## Recommended next steps

Dennis hasn't yet said whether to continue straight to RF024 or address
#654/#655 first — this rotation exists specifically to surface that
choice, not to make it. Whichever is chosen, **#646** (8-RF Wave 3
tracking issue) is still the active thread — 4 of 8 done
(RF014/015/016/017), RF024/025/026/029 remaining.
