# HANDOFF

**Written 2026-09-24, fifty-sixth queue sitting. FINAL: Dennis ended the
sitting ("shut it all down so we start skills pack session clean"). The next
session is a skills-pack session, not this repo.**

The instruction was "Read handoff. Pick next group of issues. Docker is on.
Check pc usage before big runs." The group picked was **#1125** (unwired
`src/scripts/`), plus **#1199**, which #1125's work surfaced. Every other open
`bug` was, per its own last comment, waiting on an owner decision. No big
Docker run happened, so no PC-usage check was needed; the only Docker call was
a `compose config -q`.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `336fcf7f` (#1125's guard).

## What shipped

- **#1125**, closed with a comment. `7ae4822c` wired nine scripts as npm
  entries (`migrate:*`, `seed:disease-validation-rules`). `834eda48`
  deleted `testEnvironment.js`, its test, and the `TEST_ENVIRONMENT` flag,
  because its guard cannot pass on any tracked stack. `336fcf7f` added
  `tests/architecture/scripts-reachability.arch.test.js`: every
  `src/scripts/*.js` must be an npm target or appear in `HAND_RUN`
  (currently only `seedRbacCatalog.js`).
- **#1199**, `8fb31564`, closed with a comment. The disease seed wrote its
  pharmacology keys in snake_case, which `SampleGraphValidator` could never
  match. They are now camelCase.
- Verified natively only: the architecture suite at 151/151, plus targeted
  vitest. No Docker gate ran.

- **Docs import**, on Dennis's instruction ("use this sitting to update the
  docs too in our branch"): the owner's approved **Canonical Data Model
  v2.0.0** release from `stabilize/v2.0.0-prototype` is now at the top of
  `docs/`. It includes dictionary v2.0.0, requirements v4.0.0 and plan
  v2.0.0, and moves the v1 docs to `docs/architecture/legacy/`. It is the
  newest canon. There is no Markdown extraction yet.
  `E2E_TRACEABILITY_PLAN.md` records this.

## Filed this sitting

- **#1200**, open, labels `bug` and `question`: `disease_dictionary` is read
  on the request path but written by no stack. The seed's placement needs a
  decision. The body recommends (a), boot-seeding only the explicit rules. Its
  docs-check comment adds (d): the canonical model for this is dict-02's
  `BiomarkerAssociation`, so `disease_dictionary` may be legacy. Switching
  the rules on changes which samples pass validation, so this is Dennis's
  or Denise's call.
- Three findings about the tooling itself, recorded in Dennis's private
  tracker, not here. Among them: how to settle questions nobody here is
  expert enough to answer, and updating the docs authority order to v2.0.0.
  Those two are what the next skills-pack session is for.

## Touched, not closed

None beyond the above. #1123, #986, #979, #956, #914 and #1124 were read at
triage. Each one's last comment has it waiting on an owner answer, and
nothing was posted to any of them.

## Still waiting on Dennis

#1200's placement choice, #1196's default, and #1197 (for Denise).
**Also: Denise's branch deletes `docs/mestrado/` (her research proposal) and
`docs/planning/bioavanced-v3/`. The import did not mirror those deletions.
Mirror them or not?** #1200 was re-checked against v2.0.0 (see its last
comment). For the
rest, query `gh issue list --state open --label question` (redirect it: it is
long) and read each issue's last comment.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`.
- Docker Desktop and WSL were shut down at the end of the sitting, on
  Dennis's instruction. No containers were running. The test stack's named
  volumes survive, and its images predate this sitting's `compose.test.yml`
  change, so rebuild with `--build`.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A new `src/scripts/*.js` needs an npm entry or a `HAND_RUN` reason.**
  The arch guard enforces this.
- **Disease requirement keys are camelCase** (`treatmentStatus`), matching
  `SampleGraphValidator.defaultRequirements()`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 904 commits on hers only, 132 on ours only (counting this rotation)
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 18:52: current-state validation passed. Full
  Vitest diagnostic, Coverage diagnostic and release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

Dennis named it: a **skills-pack session**. It works the settle-a-question
source ladder and the v2.0.0 docs authority update, both in his private
tracker. Back in this repo, the branch has not passed the full gate since
`5fc5c843`, and Dennis's go is still needed for a PR into `main`.
