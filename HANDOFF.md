# HANDOFF

**Written 2026-09-22, thirty-fifth queue sitting. INTERIM — Dennis gave no
end signal, so treat the session as CONTINUING.** His instruction: read the
handoff, Docker is turning on, pick the next group. **Docker came up and the
whole sitting ran against a live stack.**

## Repo state

`feature/docker-e2e-backend-integration`, tree clean and matching origin.
Four commits, all pushed; last substantive one is the compose port change.

## What shipped — five issues closed

- **#1127** — the live-stack proof it was held open for. **The driver
  REJECTS; there is no buffered hang**, so `f1c8deff`'s 503 arm is the real
  path. Closed `premise-corrected`.
- **#1060** — `generate-env-docker-secrets.sh --upgrade`. Adds only what is
  missing, never regenerates an existing credential, backs up first.
- **#959** — the test stack can sign. **The project's first sealed tree head
  exists.**
- **#1152** — the 503 copy was unreachable through the UI; now reached.
- **#1156** — `compose.test.yml`'s host ports are overridable.

## The three numbers this sitting produced

**`[ran it]` all three, on the live stack.**

1. **A Mongo outage answers 503 in 30.008s (stopped) / 60.083s
   (partitioned).** 30s is `serverSelectionTimeoutMS: 30000` on the **native**
   client (`database/mongo.js:236`) — not the mongoose 10000. The backend
   recovers unaided.
2. **`api.ts` aborts at 10s** (`:153`, the only `timeout:` in the file), so
   before `fa1530cd` the mapper got `undefined` and no participant ever saw
   the 503 copy.
3. **`audit_tree_heads` went 0 → 1, `anchorStatus: ANCHORED`**, with a real
   RFC3161 token and a witness receipt. The prior live reading was 0 against
   1471 events.

## The stack is UP, and its state matters

11 services healthy, `RestartCount=0`, on **fresh volumes created this
sitting**.

- **`admin-bootstrap-test` has run** (`Exited (0)`) — `realLogin()` works.
- **The 17-service reference-data bootstrap chain has NOT run.** A full-suite
  gate needs it (#403: 173/27 without, 193/7 with).
- **InfluxDB is published on host 18086, not 8086** — this machine reserves
  **7810-8309** (~500 ports), so 8086 *and* 8087 are both unbindable.
  `[ran it]` `netsh interface ipv4 show excludedportrange protocol=tcp`.
  Bring it up with `INFLUXDB_HOST_PORT=18086`. **A host-side Playwright run
  therefore also needs `E2E_INFLUXDB_URL=http://localhost:18086`** —
  unverified, not run this sitting.
- `audit-signing-test-data` holds the minted Ed25519 key. **Do not delete
  that volume** without knowing the sealed tree head is disposable: signed
  artifacts are verified against that key later.

## Things a next session must not undo

Items 12-14 from the previous note still hold (`requestConsent` is CREATE-only
on purpose; `POST /consents`' `requireRole(3, 4)` is #684's settled reasoning;
the `#921` slice-5 pin table says 12 real sites). Plus:

15. **`set_var` in `generate-env-docker-secrets.sh` is pure bash on purpose.**
    `[ran it]` MSYS rewrites a Unix absolute path on the way to a native
    program **both as an argv token and as an environment value**, which
    turned the container path `/run/secrets/merkle_signing_key.pem` into
    `C:/Program Files/Git/run/secrets/...`. Routing that value through
    `python3` or `node` reintroduces the bug. Pack #1082 corrects the rule.
16. **`AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON` is unset on the test stack on
    purpose**, and `compose.test.yml` says why. It must be the SPKI of a key
    that does not exist until the keygen runs, and it is read from env only.
    **#1157** owns it. Signing does not need it; verification does.
17. **`mapConsentTokenError` was deliberately NOT changed to map `undefined`
    to the 503 copy.** An error with neither `response` nor `request` never
    reached the network, so that would claim an outage whenever the page threw
    for any other reason. A control case pins it.
18. **The frontend files under `frontend/src/views/` and
    `pages/patient/` are CRLF** while the shell and compose files are LF. An
    `\n`-only anchor matches **zero** against them.

## Open, and left in a known state

Query for the backlog — `gh issue list --state open`. **Nine issues were filed
this sitting; five are still open and this is the state each was left in:**

- **#1153** — a *fresh* generate writes 31 of the example's 79 variables, and
  the two disagree on whether the RFC3161 TSA is on. Directions listed, none
  chosen.
- **#1154** — boot-time validation of the signing config. **Not blocked, and
  an earlier draft of this note wrongly said it was.** Directions 2 and 3 do
  wait on the fatal-vs-degrade call #979 has open, but **direction 1 (warn
  loudly once at boot, no behaviour change) needs no decision from anyone** —
  the issue body says so itself. It was left undone by choice, not by
  dependency.
- **#1155** — the three tracked `.sh` files have no tests. First step is
  checking whether CI's runner image has `bash`/`openssl`/`python3`; that
  decides the direction.
- **#1157** — see item 16.
- **#1158** — `EConsentPage`/`EConsentImportPage` have the same status-only
  mapping at four call sites. **The mechanism is measured, the consequence is
  not**: read those two mappers' default copy first, because that is what
  decides whether it is a real defect or a tidy-up.

Four pack issues were also filed (DyeAllPies/dyeallpies-skills-pack #1079-#1082),
plus recurrence tallies on its #852 and #896.

## Recommended next

**None queued by name** — Dennis named no follow-up.

**Unverified prescription:** #1158 is the cheapest real win (one read decides
its size, and `fa1530cd` is a directly reusable template). #1156 having landed
means the stack now comes up on this machine without a private override, so a
**full-suite e2e gate is newly possible** — it would need the reference-data
chain above, `--workers=1`, and the skipped count read rather than the pass
count. Not run this sitting.

Still undone from six notes: **diff Requisitos v4.0.0 against v3.0.1 for RF
renumbering** before building further on `E2E_TRACEABILITY_PLAN.md`.
