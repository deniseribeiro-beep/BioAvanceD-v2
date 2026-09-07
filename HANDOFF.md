# HANDOFF

**Written 2026-09-07, nineteenth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff
and pick the next group of issues. I took the machine-ingest gate family —
**#1091, #1067, #1080** — chose directions with him, and worked all three.
Four commits, **three issues closed**, one filed (#1093).

## THE E2E GATE IS GREEN: 223 passed / 0 failed

**That is the headline, and it discharges the previous note's central
correction.** `[ran it]` full `compose.test.yml` stack, `backend-app-test`
rebuilt (`--build`), reference-data chain all `Exited (0)`, `--workers=1`:
**223/223 in 2.4m.** The previous sitting was 205 passed / 18 failed.

The previous note argued the suite **could not** have been green at
`01791b44` and warned against using it as a baseline. That was right, and it
is now moot: this is, as far as anything here shows, the first fully green
run of this suite on this recipe. **This one IS a usable baseline.**

### The gate recipe, including one thing that is not obvious

`[ran it]` `compose.test.yml` declares **no `profiles:` anywhere**, so a bare
`up -d` starts `playwright-runner`, which immediately runs the whole e2e
suite inside the stack. To bring the stack up without it:

```
docker compose -f compose.test.yml --env-file .env.test.example \
  up -d --build --scale playwright-runner=0
```

then run host-side: `npm run test:e2e:docker -- --workers=1 --reporter=list`.

`[ran it]` `up -d` exits 0 regardless, so read `docker compose ps -a` — 13
running/healthy, 20 `Exited (0)` is the correct shape.

## Other gates

- **Backend native: 464 files / 8681 tests, exit 0** (`tests/unit
  tests/integration tests/compliance`). Was 463 / 8663.
- **`npm run test:architecture` 124/124**, unchanged.
- Frontend not run this sitting — nothing touched it.

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR. `git status -sb` is authoritative.
- **Four commits.** Last substantive is `3201918f` (#1080).
- **One new file pair** — `api/backend/src/utils/secretCompare.js` and its
  test. **One new env key in the TEST stack only**:
  `TELEMETRY_INGEST_SECRET=e2e-telemetry-ingest-secret`, in
  `compose.test.yml` (twice), `package.json:22` and `.env.test.example`. The
  `.env.docker.example` / `.env.production.example` copies stay **blank**,
  which is the fail-closed posture and is deliberate.
- **Nothing left running.** Stack torn down with `down --remove-orphans`,
  `docker ps -a` empty. Named volumes kept (5). Build cache pruned, 4.9GB.
  Images kept (7.7GB) so the next gate does not rebuild from scratch.

## Issue state

Query it — `gh issue list --state open`. What a query cannot carry:

- **#1067, #1080, #1091 closed.** #1080 and #1091 carry `premise-corrected`.
- **#1093 filed and deliberately NOT worked** — I chose to stop on it, rather
  than being blocked. Its remedy is a genuine fork (mirror #1080's
  `auditLogger` call, or wire the HTTP path into the `mqtt-ingestion-audit`
  hash-chained trail with a `source` discriminator) and it turns on a
  question I did not check: whether the canonical requirements treat MQTT and
  HTTP telemetry as one ingestion surface or two.
- **#284 got this sitting's measurement** — CI still has no e2e job, which is
  why #1091 survived three days unnoticed. Worth sequencing with **#599**
  (CI is main-only, so this branch gets no CI at all); an e2e job does
  nothing for this branch until that is settled.

## The judgment a query cannot carry

- **#1080 carries a decision Dennis did not explicitly authorise and may want
  reversed.** He chose "reject 4xx" for an unresolvable sensor. Working it
  surfaced a third state: `[read it]` `Sensor.js:61` declares
  `organizationId` with `default: null`, and #634's own comment says *"No
  backfill for pre-existing sensors."* So an existing-but-unscoped sensor is
  neither unknown nor deleted, and refusing it would be a hard outage on any
  pre-#634 database. **Shipped: unknown sensor → 404; unscoped sensor →
  stored unattributed.** The defect still closes because the *body* can no
  longer choose. Reversing this to the stricter posture is a small edit.
- **A green suite after a shared-helper swap proves nothing, and the probe
  that checks it can itself be invalid.** `[ran it]` my first #1067 probe
  drove vitest from inside a Node `execSync`; vitest could not resolve its
  runner, every targeted suite failed at import with **`Tests no tests`**, and
  three red files read exactly like a successful probe. Re-run from the shell:
  2 failed / 22 passed, and the real finding was that
  `testSupportGate.test.js` had **no** test for the load-bearing case at all.
  **Check the executed-test count, not just the red.** Filed as
  dyeallpies-skills-pack#804.
- **#1091 was four fixes, not the two its body names**, and two of the four
  are the ones that would have left the gate red: `compose.test.yml` needs the
  key on the `x-test-env` anchor **and** separately on `playwright-runner`,
  which does not merge the anchor; and `package.json:22`'s `test:e2e:docker`
  prefix needs it or the host-side run has it unset.
- **`.env.test.example` is a runtime NO-OP on this stack.** `[ran it]`
  `compose.test.yml` has no `env_file:` key and no `${...}` interpolation, so
  nothing in that file reaches a container — the literals in `x-test-env` are
  what arrive. Editing only it looks like a fix and changes nothing.
- **No e2e spec posts to `/api/temperature/system/reading`** — `[ran it]`
  zero hits under `tests/`. The e2e ingest surface is `/api/iot/telemetry`,
  15 sites in one file. Several env-template comments still name only the
  temperature route.
- **A dead CONTROL test can sit green for weeks.**
  `temperature.api.test.js`'s machine-ingest control set `x-telemetry-secret`
  where the gate reads `x-telemetry-ingest-secret`, so it always 403'd into an
  `else` branch asserting `[401, 403]` — and its own comment called a refusal
  "acceptable", making it unfalsifiable. Its `organizationId` assertion had
  never executed. Replaced.
- **Per-file EOL again, and it bit in both directions.** `compose.test.yml` is
  **LF**; `package.json`, `.env.test.example` and the e2e spec are **CRLF**,
  in the same fix. Detect per file.

## Recommended next

**Dennis named no successor, so nothing is queued.** From what this sitting
established, in dependency order:

1. **#1093** — the direction question above; it is the direct sibling of work
   just shipped, so the context is cheapest now.
2. **#1092** — unchanged from the previous note and still untouched. One query
   against a populated database answers it.
3. **#1086 then #1072**, in that order and not the reverse — unchanged from
   the previous two notes, still untouched.
