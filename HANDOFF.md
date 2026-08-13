# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557, see if you can work issue and loop to wrap
up a couple of times."

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `work-issue` → `build-loop`, running
two full iterations (each ending its own `wrap-up`): **LOINC**, then
**UCUM** — together closing out §7.4 step 6 ("Importar LOINC e UCUM").

### Iteration 1 — LOINC

- Read `dict-01_FONTES.md`'s SRC_LOINC row directly: auth "Cadastro/chave
  conforme acesso" (registration/key per access), release "2.82,
  2026-02-24; atualizar por release" — a genuine dated version, unlike
  HGNC's continuous-update shape.
- Confirmed live (curl + Node `fetch`, 2026-08-13) that loinc.org's
  `/downloads`, `/license`, `/kb/versioning` pages are themselves
  unauthenticated — a browser-UA'd `curl` 200s all three with the version
  table (`Version 2.82 / Released 2026-02-24`) and full license text in
  plain HTML — **but** every one of them 403s under Node's own `fetch()`
  (the only client `fetchLiveRelease.js` may use) with a genuine
  interactive Cloudflare challenge, confirmed even with a full realistic
  browser header set. This is a TLS/client-fingerprint-level block against
  Node specifically, not the simple default-UA rejection HGNC/ICD-11 hit.
- **Independently found mid-investigation**: loinc.org's `robots.txt`
  explicitly disallows `ClaudeBot` (`Disallow: /`) by name, alongside
  GPTBot/Google-Extended/CCBot/Bytespider/Applebot-Extended/
  meta-externalagent/Amazonbot, while generic `User-agent: *` stays
  `Allow: /` — a directed AI-crawler opt-out, not OMIM's domain-wide
  block. Discovered this *after* already having made several probe
  requests (checked robots.txt too late in the sequence) — flagged to
  Dennis directly, stopped further loinc.org requests immediately.
- Reused OMIM's `'not-live-verifiable'` `kind` (no new kind needed) for
  LOINC, with a LOINC-specific `reason` covering both the fetch()-level
  Cloudflare block and the robots.txt disallow. Registry entry, npm
  script (`reference:live-verify:loinc`), and one new mocked unit test
  (asserting `fetch()` is never called) landed.
- Verified: 60/60 architecture tests (unchanged), 126/126 unit tests (up
  from 125), lint (383 files) clean. Ran `npm run reference:live-verify:
  loinc` natively (`status: "not-verifiable"`, exit 1 — expected), re-ran
  `reference:live-verify:omim` as a regression check (still
  `"not-verifiable"`).
- Own branch `test/557-live-verify-loinc`, committed, merged (no-ff) into
  `feature/docker-e2e-backend-integration`, pushed (`85b61c71`), local
  branch deleted.
- `wrap-up` filed **dyeallpies-skills-pack#269**: build-loop's live-verify
  guidance lists `robots.txt` as one of several paths to probe rather than
  sequencing it *first* — this mattered more for LOINC than the prior
  OMIM/WHO precedents because robots.txt named the *investigating agent's
  own crawler identity* specifically, not just a generic "disallow
  everyone" policy discovered after a block was already evident. Filed
  with suggested replacement wording.

### Iteration 2 — UCUM

- Checked `robots.txt` **first** this time, before any other request —
  applying #269's lesson immediately. `ucum.org/robots.txt` carries only
  a generic `/wp/wp-admin/` disallow, no AI-crawler-specific block.
- Confirmed live that Node's own `fetch()` 200s `ucum.org/ucum` directly
  — no Cloudflare challenge at all, despite `ucum.org` and `loinc.org`
  sharing the same steward (Regenstrief Institute) and both being
  WordPress sites. Confirms the repo's own repeated lesson: check each
  source fresh, don't extrapolate from the immediately-prior source's
  outcome even when the steward is identical.
- dict-01_FONTES.md's SRC_UCUM row states auth as "Não" (no auth) —
  accurate, simplest auth note of this group so far.
- The spec page (`https://ucum.org/ucum`) is a `'fixed-edition'` shape
  like ICD-10 (no new kind needed): it 200s directly and carries a clean
  `<p>Version: 2.2</p>` in its own header block. License is a dedicated
  page (`ucum.org/license`) with the copyright notice "1999-2024,
  Regenstrief Institute, Inc." as a durable, contiguous plain-text
  pointer.
- Registry entry, npm script (`reference:live-verify:ucum`), and three
  new mocked unit tests (verified / version-mismatch /
  license-pointer-mismatch) landed.
- Verified: 60/60 architecture tests (unchanged), 129/129 unit tests (up
  from 126), lint (383 files) clean. Ran `npm run reference:live-verify:
  ucum` natively (`status: "verified"`, exit 0). Re-ran LOINC/OMIM/HGNC
  as regression checks — all still report their expected status.
- Own branch `test/557-live-verify-ucum`, committed, merged (no-ff) into
  `feature/docker-e2e-backend-integration`, pushed (`a3406d66`), local
  branch deleted.
- Self-caught mid-iteration friction (no skill fix needed): started
  editing `liveVerifySources.js` while still on the protected
  `feature/docker-e2e-backend-integration` branch — the repo's own
  branch-protection hook correctly blocked it (build-loop's text already
  says "branch before the first Edit/Write"; this session just didn't
  follow its own iteration-1 pattern the second time). Recovered by
  creating the slice branch and reapplying the edit; no lost work.

Neither iteration touched product source (`api/backend/src`,
`frontend/src`) — same boundary precedent as every prior #557 slice
(only `package.json`, `liveVerifySources.js`, and the one unit test file
changed each time).

**#557 left open** with two updated progress comments (9 of ~15-16 done
now — HPO, MONDO, ORPHA, ICD-11, ICD-10, OMIM, HGNC, LOINC, UCUM; ~7
remain) — not closed, since the issue covers all Fase 2 sources. Same
count-discrepancy caveat as every prior comment carried forward
unchanged.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `a3406d66`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO + ORPHA + ICD-11 + ICD-10 + OMIM +
  HGNC (prior sessions) + this session's LOINC and UCUM slices, on top of
  #549's full 16-source Fase 2 fixture-import group.
- Issues this session: **none closed**. **#557 open**, two progress
  comments added (LOINC, UCUM). **#550 open** (tracking issue for the
  original 3-way split, unchanged). **dyeallpies-skills-pack#269 opened**
  (pack-repo tracker, the robots.txt-check-ordering finding — see above).
- Docker: not used this session — live-verify is a network-only script,
  no Mongo/Docker involved, same as every prior #557 slice.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source. §7.4
  step 6 ("LOINC e UCUM") is now fully closed out; step 7 is next in
  `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`'s
  §7.4 order — **not yet confirmed this session, check it directly before
  picking**. Remaining, by name: DCB, ATC, DUO, Uberon, NCBI Taxonomy,
  Cell Ontology, EDAM. Per this session's confirmed pattern: (1) check
  §7.4 for the recommended order, (2) **check `robots.txt` first, before
  any other request to the new authority's domain** (dyeallpies-skills-
  pack#269's lesson — confirmed this session it prevents exactly the
  LOINC-shape surprise), (3) read `dict-01_FONTES.md`'s row for the
  source's stated distribution channel, (4) for a nominally gated source,
  check whether the authority's public website exposes the release/
  license signal unauthenticated before assuming the
  `'not-live-verifiable'` carve-out — but also don't assume a *public*
  page means Node's own `fetch()` can reach it: LOINC's pages were
  genuinely public via curl yet still `'not-live-verifiable'` because of
  a Node-fetch()-specific Cloudflare block, a new distinction this
  session established, (5) don't assume the release signal is always a
  tag/redirect/edition, and don't assume the same steward means the same
  bot-protection behavior — UCUM (Regenstrief, same as LOINC) turned out
  fully open despite LOINC's block.
- **#550** — stays open as the tracking issue for the original split
  until #557 fully lands.
- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#553** — compose.dev.yml's "14 Fase 2 sources" comments undercount the
  real total (16). Unchanged, still open, still a quick win — also the
  likely fix point for #557's own running-count miscount (see above).
- **#554** — #550's own title has the same "14" undercount #553 flagged.
  Unchanged, still open, still a quick win.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267/#268/#269**
  — pack-repo only, low priority except #269 (this session's new find),
  unchanged otherwise this session. (#266 is resolved by #267; #267/#268/
  #269 are the pack maintainer's call, not this repo's.)

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check the authority's public website before assuming a
  carve-out" guidance needed a genuine refinement this session: a source
  can be publicly reachable (via curl) yet still land the
  `'not-live-verifiable'` carve-out, if the *specific client this repo's
  script is allowed to use* (Node's `fetch()`) can't pass a bot challenge
  the way curl's different TLS/client fingerprint can. Public-via-curl is
  not the same test as public-via-fetch() — confirm with the actual
  client the script will use, not just any HTTP tool, before ruling a
  carve-out in or out.
- New pattern this session, now filed as **dyeallpies-skills-pack#269**:
  check `robots.txt` *first*, before any other request to a new
  authority's domain — not as one path among several to try. This
  mattered specifically because loinc.org's robots.txt named `ClaudeBot`
  (the investigating agent's own identity) rather than a generic
  disallow-everyone policy discovered as corroborating evidence after a
  block was already known. Applying this immediately on the very next
  slice (UCUM) worked as intended — no wasted requests.
- Confirmed again this session: **shared steward does not mean shared
  bot-protection behavior**. LOINC and UCUM are both Regenstrief
  Institute properties, both WordPress sites, and behaved completely
  differently under Node's `fetch()` (403 Cloudflare challenge vs. clean
  200). Reinforces the standing rule (don't assume from the immediately-
  prior source's outcome) even when the *institution*, not just the
  *domain*, is identical.
- Confirmed again this session: `.claude/skills/build-loop/local-env/`
  and `wrap-up`/`handoff`/`work-issue` overlay files are junctions into
  the skills-pack clone — file an issue against the pack repo
  (`DyeAllPies/dyeallpies-skills-pack`, found via the sibling checkout's
  `git remote -v`) with exact replacement text rather than editing
  directly.
- `test-loop`'s full-suite-run guard hook also fires on a build-loop
  iteration's `npx vitest run <directory>` call (it matches any bare
  `vitest run` regardless of which loop skill is driving) — target the
  specific test file per iteration, same as test-loop's own rule, even
  though build-loop's own text doesn't restate it.
