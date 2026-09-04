# HANDOFF

**Written 2026-09-03, showcase-video sitting. INTERIM — no end signal from
Dennis.** He scoped this round explicitly: *"instead of resolving issues, see
what we can do of a human showcase e2e video with what we have thus far…
Next session we go back to the issues."* So **nothing was resolved by design**,
and the two product issues filed here are deliberately left open for that
next session.

**The previous sitting's note is superseded. Its substance still stands —
re-read `git show aad16dab:HANDOFF.md` for the #1037/#983/#1029/#956/#941/
#1028 research, none of which this sitting touched.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed, tree clean and
  matching origin. `main` untouched, no PR.
- One substantive commit: `1f2a5b00`, the Wave 5 showcase reel.
- **No product source touched.** No new npm scripts, dependencies or env
  keys. One test file changed (`tests/e2e-showcase/human-showcase.spec.ts`,
  `+281 / -0`, append-only) plus one binary added under `docs/`.

## Docker state

- **Nothing left running.** `docker compose -f compose.test.yml down` ran at
  session end; `docker ps` is empty.
- The stack was brought up from scratch this sitting: the 12-service core
  recipe with `--build`, then `admin-bootstrap-test`, `foundation-bootstrap-test`
  and all 16 `reference-data-bootstrap-*` services — every one `Exited (0)`.
  The `mongodb-test-data` volume was **kept** (it carries the reel's own
  quarantine history, and dropping it costs a full reseed).
- Build cache pruned (`docker builder prune -af`, 1.048GB → 0B). Images kept.
- **The full e2e gate did NOT run** — only the 5-test showcase config. No
  product code changed, so nothing new is owed to the gate beyond what the
  previous sitting already owed.

## What shipped

**`docs/e2e-showcase-2026-09-03.mp4`** — 46s, the two new Wave 5 segments
concatenated. `[ran it]` the whole reel is 5/5 green against the live stack
(Waves 2–5, `--workers=1`, 2.7 min).

- **Segment 1, RF010 (#809):** a participant with no account opens the
  emailed TCLE link, reads the term and its permissions, accepts. Opens on a
  legacy `#805` link with an uninterpolated id reporting *"link incompleto"*
  rather than an auth wall — that absence is the point.
- **Segment 2, RNF011 AC#4 / RF029 AC#6 (#808, #794):** an operator uploads a
  3-row CSV, gets *"2 de 3 importadas · 1 rejeitadas"*, and follows the
  rejected row into quarantine to its retained batch and preserved fields.

## The judgment a query cannot carry

- **`[ran it]` #1044 is reproduced, not inferred, and it is the reason the
  reel never shows `/patients`.** A participant who accepts through the
  segment-1 page is badged **"Expirado"** in the operator's directory, with
  *"Coletar Assinatura"* still offered. Flipping only `status` on one
  participant and re-rendering: `Pendente` → `Expirado`. Chain: accept writes
  `status: 'ACTIVE'`; the list API returns raw `status` and no
  `consentStatus`; `PatientsPage.tsx:67-73`'s `normalizeConsentStatus` has no
  `ACTIVE` branch and falls through to `EXPIRED`. It is the **only** badge
  state that path can produce.
- **`[ran it]` #1045 is security-relevant and was filed mid-session.**
  `GET /api/patients` and `/search` return each participant's live
  `consentToken` — the sole credential for the *public*
  `POST /api/e-consent/consent-tokens/accept` — and both list routes carry
  `authenticate + requireOrganizationScope` with **no permission gate**
  (`patient.routes.js:12,18`). Any org user at any access level can therefore
  consent on any pending participant's behalf, via an unauthenticated call
  that cannot name them. Composes with #823 and #832 but is distinct: those
  are about guessing a credential, this is about handing it out.
- **`[ran it]` `toBeVisible()` does not scroll, so a showcase segment can
  assert a payoff the video never shows.** Segment 2's rejected-row detail
  was green on the first run and entirely below the fold; found by extracting
  a frame, not by any test signal. The recording viewport is **800x450**, not
  the 1280x720 `Desktop Chrome` emulates. Filed as pack #744.
- **`[read it]` `e2e-showcase-video`'s own overlay is three reels stale** —
  it says "built twice", lists two committed mp4s where five exist, and names
  a branch convention retired in #552. Its two live fixture-gap warnings
  (BioAvanceD-v2#598, #724) are still correct and still worth reading before
  picking showcase flows. Filed as pack #745.
- **#889 (ResultsPage import-job filter) is new since Wave 4 and was
  deliberately not demoed** — its UI half is a known full-suite red on this
  stack. A reel is the wrong place to discover which way that goes.

## Conventions this sitting relied on / established

- **The showcase spec is append-only.** Each wave is a new `test.describe`
  whose header comment names its RFs *and* what it deliberately does not demo
  and why. `1f2a5b00` is `+281 / -0`. Keep that shape.
- **One mp4 per sitting, holding only that sitting's new wave** — not a
  re-render of the whole reel. Confirmed against `ffprobe` on the 08-25 file.
- **A fixture value that reaches the screen is copy, not a test id.** A
  seeded consent template following the usual `${Date.now()}` uniqueness idiom
  rendered as *"Versão showcase-w5-1788484183443"* in the reel's most-read
  shot; re-keyed the cleanup to the title so the version could be readable.
- **`local-env/<project>.md` is relative to the SKILL's directory, not
  `.claude/skills/`.** Reading it at the pack root returns a clean
  `No such file or directory` — a confident zero indistinguishable from a
  project that has no overlay. That miss is what cost this sitting the two
  fixture-gap warnings above. Pack #745.
- **Manual test-stack Playwright env** (unchanged, re-confirmed):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
  `PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, `PLAYWRIGHT_SKIP_WEBSERVER=1`,
  `TEST_USER=admin`, `TEST_PASS=Admin@123`,
  `E2E_MONGO_URI='mongodb://localhost:27017?directConnection=true'`,
  `E2E_MONGO_DB=bioavanced_test`, `TEST_SUPPORT_SECRET=e2e-test-support-secret`.

## Filed this sitting

Here: **#1044 #1045** — both **OPEN and unworked, by Dennis's explicit scope
for this round**, not because either is blocked. #1045 is security-relevant
and is the one to pick up first.
On the pack: **#744 #745**.

Query the board for everything else: `gh issue list --state open`.

## Recommended next

**Dennis said: back to the issues.** He named no specific successor. #1045
is this sitting's own highest-severity filing; the six queue members from the
previous sitting (#1037, #983, #1029, #956, #941, #1028) are all still open
and all still turn on a decision rather than on missing information — read
that note's own section for which decision each one needs.
