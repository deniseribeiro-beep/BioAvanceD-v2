# HANDOFF

**Written 2026-09-23, forty-third queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was to read the
handoff and pick the next group, with Docker on and a parallel session sharing
the machine (it was waiting on a download). The group was **the #1104 Docker
proof, then #1158, then #1172**.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit is
`be59cab0`.

## What shipped

- **#1104 CLOSED** ([comment](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1104)).
  - The test stack was rebuilt with `--build`, and the running backend image was confirmed to carry `b1f28a19`.
  - `interop-monitoring.spec.ts`: **26 passed, 0 skipped**.
- **#1158 CLOSED, `e3a7ec4a`.** `EConsentPage` and `EConsentImportPage` now map a failure from the whole error: `mapEConsent[Submit]RequestError`.
  - On no response, the copy promises the link is still valid.
  - The classifier lives once, in `frontend/src/views/requestFailure.ts`, and `consentTokenView` uses it too.
  - `participantPages.guard.test.ts` now pins that no participant page passes `response?.status` to a mapper.

- **#1172 CLOSED, `be59cab0`**: four e2e tests abort a request with `page.route(...abort('timedout'))` and assert the rendered no-response copy on `EConsentPage` and `ConsentTokenPage`. **13/13** green on the Docker stack. The probe with the pages reverted gave exactly 2 red.

## Filed this sitting

- **#1173** (open): `EConsentImportPage` has no e2e spec at all. Disposition: I chose to stop. It needs a seeding path traced (`validateImportConsentToken`) and a Docker run.
- **Pack #1130** (open, skills-pack): the recipe's `up -d --wait admin-bootstrap-test` once **recreated** mongo, neo4j, redis and influx under a live stack, which killed `neo4j-projection-worker-test`. `[ran it]` It is intermittent and the cause is not established. **Until #1130 lands, check `docker ps -a` after the bootstrap and confirm the projection worker is still `Up`** before any gate that needs it.

## Open, and left in a known state

Query the backlog with `gh issue list --state open --json number,title,labels`,
**redirected to a file**, because the unredirected result is about 18 KB.

- I read #1163, #1149 and #1145 while triaging this sitting and left them unchanged. Each is half a design question: #1163 on which index-ensure convention, #1149 on whether to delete the inert store or wire it, #1145 on which policy reference wins.
- #1103, #1112, #682, #1159, #1162: unchanged.

## Docker and the machine

The stack was torn down after #1172's run; no containers are running. `builder prune -af` ran (1.06 GB); the images are kept. `[ran it]`:
- Free RAM was 3.4 GB before the bring-up and 2.4 GB with the stack up.
- Port 8086 was not in an excluded range. Derive it each time with `netsh interface ipv4 show excludedportrange protocol=tcp`.

## Things a next session must not undo

Earlier notes' items still hold (`git log -p -- HANDOFF.md`). Plus:

- **Participant consent pages map errors through a `*RequestError(err)` mapper, never through `response?.status`.** The guard test enforces it.

## Recommended next

**None queued by name.** Unverified: #1173 is the natural continuation. The design-shaped bugs above need a direction from Dennis first.
