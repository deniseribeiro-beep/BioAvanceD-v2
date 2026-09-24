# HANDOFF

**Written 2026-09-24, fifty-first queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

The instruction was "read handoff, pick next group of issues, Docker is
on". The previous note said every open bug was waiting on Dennis. That was
wrong for two: #1076 had no comments, and #813's blocker (#828) had closed.
Re-read the last comment on each bug before trusting that line again.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `0056cb6b` (#1076).

## What shipped

- **#1076**, closed, `0056cb6b`. The premise was half wrong.
  `/api/logs/export` already emitted the `USR-` pseudonym, because
  auditLogger writes it and `getLogs` anonymizes again on read. The reports
  `accessLogs` handler returned raw documents, so it now runs the same
  `anonymizeLogs`. `[ran it]` 351/351 across the seven reports-touching vitest
  files, 20/20 in the two arch files that parse `reports.routes.js`, and a
  probe with the fix stashed gave 2 red, 60 green. **Real-backend e2e was not
  re-run.** No spec touches `access_logs` (`git grep` over `tests/e2e`).

## Touched, not closed

- **#813**: open on the patients half only. The samples proof has been
  green since #828. The patients half is gated on **#807**, not #814: #814
  staged LGPD patient rows in plaintext without deciding #807. See the
  2026-09-24 comments on #813 and #807. Both of #807's endings are written
  there, and either one makes #813 a small change.
- **#941**: Denise commented "Resolved in the v2 Foundation Data Pipeline"
  on 2026-09-23, and the issue is still open. That work lives on her branches,
  not ours. Not touched, and not ours to close without Dennis.

## Still waiting on Dennis

#1184, #1174 (a) or (b), #807 (above), #1181's single-active-term call,
and #1139's Q2/Q3. For the rest, query `gh issue list --state open --label
bug` and `--label question`, and read each issue's last comment.

## Docker and the machine

The test stack is **down**, with volumes and images kept from `5b5860d7`'s
build (per the previous note, not re-checked). This sitting did not start
Docker. After bringing the reference-data chain up, check that
neo4j-projection-worker-test shows as Up (`docker ps -a`) before trusting a
projection spec. The last sitting's recovery for that was `docker restart`
on the three app containers.

## Things a next session must not undo

Earlier notes' items still hold: scoped creates stamp and scoped updates
refuse; `org-scope-routes.arch.test.js` gates new routes; an arch test that
reads a repo-root file needs the in-image skip guard (a native green does
not prove CI-safety). Plus:
- **Read-time log anonymization is the contract for every export of
  `logs`.** A new handler reading that collection for output runs
  `anonymizeLogs`, like `getLogs` and `handleAccessLogs`.

## Recommended next

**None queued by name.** The branch is gate-green except for this sitting's
one reports change, which is covered natively. The next step toward
shipping is still Dennis's go on a PR into `main`.
