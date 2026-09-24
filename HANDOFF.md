# HANDOFF

**Written 2026-09-24, forty-seventh queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was "read handoff,
pick next group of issues, Docker is on". The sitting took the three bugs the
last note had parked "for direction" (#1163, #1149, #1145). It settled each
direction from the repo's own evidence, then fixed the two defects that work
turned up (#1178, #1179).

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`723039b1`.

## What shipped (all CLOSED, each with a close comment)

- **#1163, `ec732d53`.** Convention adopted: a lookup index is ensured at its
  READ path and a unique index at its write path. The rule lives in
  `utils/lookupIndex.js`.
  - The storage lookups are now ensured in `MongoStorageTopologyReadRepository`,
    `TelemetryMonitor` and `equipment-sensor-quarantine`.
  - `GET /api/terminologies` builds `terminologies_sistema_codigo_idx_v1`.
- **#1149, `95e0d31a` + `777846b7`.** `PUT /api/security/permissions` is
  removed. The Permissões tab is read-only, and `getPermissions` no longer
  echoes the `security_permissions` overlay. The old rows are kept, not
  deleted.
- **#1145 + #1178, `711d48e3`**, one commit because they share hunks.
  - #1145: the Novo Sensor dropdown now binds `SensorMetadata.temperaturePolicy`
    by `_id`. A policy or freezer without a MAC is refused.
  - #1178, filed this sitting: the Policies tab keyed on `policyID`, which the
    API never returns. It now keys on `_id`, active-limit is unwrapped, and
    `/:id` no longer runs `parseInt` on an ObjectId.
- **#1179, `0043cbc1` + `723039b1`, filed this sitting.** Sensor edit now
  rebinds freezer, policy and MAC on `SensorMetadata`, pre-filled from the
  list. A dangling policy is refused on create and edit.

New real-backend specs: `security-permissions-readonly`,
`temperature-policies-ui`, and two cases in `sensor-registration`. The last run
was 6 of 6 green with 0 skipped.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
redirected to a file.

- **#1174** is still awaiting Dennis's (a)/(b) call.
- **#1123**, RBAC authority, is untouched. #1149's close comment notes the tab
  still shows `getPermissions`' hardcoded map, which is one of #1123's
  sources.
- The pack tracker got **#1133–#1136**, all hook or skill gaps, fixable only
  from a pack session. It also got a second specimen commented on #1133.

## Docker and the machine

**The test stack is DOWN** (`compose down`), and the build cache is pruned.
Images (about 4.6 GB) and named volumes are kept, so the next bring-up is
cheap, but it must use `--build`. Free RAM was 2.6 of 15.8 GB before the
bring-up, and the 12-service stack still came up healthy.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Run multi-file e2e locally with `--workers=1` until #1174 is decided.**
- **In a heredoc fed to scratch Python, read stdin as UTF-8**, with
  `sys.stdin.buffer.read().decode('utf-8')`. Otherwise accented replacement
  text arrives as cp1252 mojibake. `[ran it]` this sitting; pack #1135.
- **`sensors` and `SensorMetadata` must stay in sync.** Freezer, policy and
  MAC live on `SensorMetadata`, and `buildSensorLookup` matches MAC on both
  collections. Any new sensor write path must touch both. `[read it]`
- CRLF files: `server.js`, `import.service.js`, `result-worker.js`,
  `sensor.service.js`, `security.service.js`, `FacilityManagementPage.tsx` and
  most of `api/backend/src`. A scripted edit must detect endings per file.

## Recommended next

**None queued by name.** The parked bug trio is done. #1174 needs Dennis's call.
