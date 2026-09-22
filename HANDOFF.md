# HANDOFF

**Written 2026-09-22, thirty-sixth queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction: read the
handoff, Docker is on, pick the next group. **The group picked was the
audit-signing-config cluster; all three shipped, plus one issue the sitting
filed itself.**

## Repo state

`feature/docker-e2e-backend-integration`, tree clean and matching origin.
Four commits, all pushed; last substantive one is the test-harness fix.

## What shipped — four issues closed

- **#1157** — the public-key registry can be loaded from a FILE
  (`AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE`), so a key minted at bring-up can
  actually be verified. Direction 1 of four, Dennis's call.
- **#1154** — the audit signing config is now checked at boot in both
  entrypoints, warning-only in every environment.
- **#1153** — a fresh `generate-env-docker-secrets.sh` fills from
  `.env.docker.example` too, not only `--upgrade`.
- **#1160** — `worker.entrypoint.test.js`'s stubbing now reaches the whole
  dependency graph, and a late failure no longer kills the run. Filed and
  closed by this sitting.

## The four numbers this sitting produced

**`[ran it]` all four, three of them on the live stack.**

1. **The first tree head with a real `publicKeyFingerprint`**
   (`8e9c1f24…`). The head beside it, sealed last sitting, is still `null`
   — `createTreeHead` upserts on `{logId, treeSize}` with `$setOnInsert`,
   so a signed head is never rewritten. Correct for an append-only
   artifact.
2. **`processTimestampBacklog` returns `VERIFIED`, not
   `FAILED/signature_unknown_key_id`** — and it does so on the *pre-fix*
   null-fingerprint root, because `verifyEnvelopeSignature` skips the
   fingerprint comparison when the stored value is null. **So the FAILED
   stamp was never terminal and existing artifacts recover**; #1157 had
   left that `[not established]`.
3. **The boot warning lands ~20ms after start**, with
   `[daily-merkle] Próxima execução em 34359s` on the line above it — the
   old signal was 9.5 hours away, in the same log.
4. **A fresh generate went 31 → 81 variables against 80 declared.** The 49
   it used to omit included `REDIS_URL`/`REDIS_HOST`/`REDIS_PORT`, which
   `compose.dev.yml` supplies nowhere, so a freshly generated dev stack had
   **no Redis config at all** and said so only as
   "Redis não será inicializado". That answers #1153's own open question and
   makes it a correctness issue, not drift.

## The stack is UP, and its state matters

14 services, **11 currently `Up (healthy)`**, on the volumes created last
sitting — not fresh.

- **`backend-app-test` and `worker-test` were rebuilt this sitting** and
  carry #1154's boot check. `tsa`/`witness` were recreated with them.
- **`frontend-app-test` is `Exited (143)` and was never brought back up** —
  bring it up before any Playwright run.
- **`admin-bootstrap-test` ran three hours ago** and its data is in
  `mongodb-test-data`, which persisted, so `realLogin()` still works.
- **The 17-service reference-data bootstrap chain has still NOT run.** A
  full-suite gate needs it (#403: 173/27 without, 193/7 with).
- **`INFLUXDB_HOST_PORT=18086` is required on this machine.** `[ran it]`
  `netsh interface ipv4 show excludedportrange protocol=tcp`: five
  contiguous blocks, **7810–8309**. **8087 does NOT work** — the
  pack's own docker overlay still prescribes it and the port is inside the
  range that overlay itself records. Filed as pack #1086.
- **`audit-signing-test-data` now holds the key AND
  `merkle_signing_public_keys.json`.** The keygen re-derives the registry
  from whatever key is on disk on **every** run, so deleting only the
  registry is safe; deleting the key orphans every signed artifact.

## Things a next session must not undo

Items 12–18 from the previous note still hold, except **item 16 is now
resolved** (`AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON` stays unset on the test
stack, but the FILE form supersedes it — that is #1157). Plus:

19. **The boot check is deliberately NOT awaited** at either call site.
    `[ran it]` awaiting it pushes `startWorker`'s lazy
    `require('../config/redis')` out of the module-load tick, which breaks
    `worker.entrypoint.test.js`'s stubbing. The `.catch()` is load-bearing:
    an unhandled rejection reaches #1040's handler and exits the process,
    inverting the function's posture.
20. **`config/env.js` is exempt from `worker.entrypoint.test.js`'s new
    prefix eviction on purpose.** Tests write to that object directly
    instead of through `process.env`, so a fresh copy per test discards
    every assignment. `[ran it]` removing the exemption turns the control
    case red with a message that names nothing about module identity.
21. **`sync_from_example()` never rewrites an existing line, so the
    generator's values win over the example's.** That is what keeps
    `AUDIT_RFC3161_MODE=disabled` from being silently re-decided; **#962
    still owns that call** and an architecture test pins the precedence.

## Open, and left in a known state

Query for the backlog — `gh issue list --state open`. **Four issues were
filed this sitting and all four are still open; three are owner's calls:**

- **#1159** — should the audit-signing boot gate be fatal in production,
  like the encryption gate three lines above it? **#979 does NOT cover
  this** — I checked; its table is Redis and Mongo only.
- **#1161** — `NEO4J_CANONICAL_SALT` is written by the generator and
  declared by neither env file; graph pseudonymisation silently falls back
  to `USER_ANON_SALT`.
- **#1162** — a consequence of #1153: a fresh generate now inherits
  `AUTH_RATE_LIMIT_RELAXED=true`, `CONSENT_RATE_LIMIT_RELAXED=true` and
  `TRUST_PROXY=1` from the example, by mechanical sync rather than by
  decision. `[read it]` `parseTrustProxy('1')` returns the integer 1, so
  `req.ip` comes from a client-supplied header on a stack with no proxy —
  which is what the rate limiters key on.
- **#1155** — commented, not worked: `[read it]` CI is `ubuntu-latest` and
  already runs `test:architecture`, so bash/openssl/python3 are all
  present and a shell-script test can be an ordinary architecture test.
  **That was its stated first step, and it is now answered.** One of the
  three scripts has one test; the key-minting behaviour is still untested.

Pack issue #1086 filed, plus recurrence tallies on pack #809 and #710.

## Recommended next

**None queued by name** — Dennis named no follow-up.

**Unverified prescription:** #1162 is the one worth his eye first, because
this sitting caused it. Otherwise a **full-suite e2e gate is the biggest
un-taken step**: it needs `frontend-app-test` back up, the reference-data
chain, `--workers=1`, `INFLUXDB_HOST_PORT=18086`,
`E2E_INFLUXDB_URL=http://localhost:18086` (still unverified), and the
**skipped** count read rather than the pass count.

Still undone from seven notes: **diff Requisitos v4.0.0 against v3.0.1 for
RF renumbering** before building further on `E2E_TRACEABILITY_PLAN.md`.
