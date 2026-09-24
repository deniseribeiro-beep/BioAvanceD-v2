# HANDOFF

**Written 2026-09-24, fifty-sixth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.**

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

## Filed this sitting

- **#1200**, open, labels `bug` and `question`: `disease_dictionary` is read
  on the request path but written by no stack. The seed's placement needs a
  decision. The body recommends (a), boot-seeding only the explicit rules. Its
  docs-check comment adds (d): the canonical model for this is dict-02's
  `BiomarkerAssociation`, so `disease_dictionary` may be legacy. Switching
  the rules on changes which samples pass validation, so this is Dennis's
  or Denise's call.
- One finding about the tooling itself, recorded in Dennis's private tracker
  for tooling, not here.

## Touched, not closed

None beyond the above. #1123, #986, #979, #956, #914 and #1124 were read at
triage. Each one's last comment has it waiting on an owner answer, and
nothing was posted to any of them.

## Still waiting on Dennis

#1200's placement choice, #1196's default, and #1197 (for Denise). For the
rest, query `gh issue list --state open --label question` (redirect it: it is
long) and read each issue's last comment.

## Docker and the machine

- **Gate:** Dennis, 2026-09-24: "Docker is on." It closes at the next
  `/clear`.
- The test stack is still down, as the previous note left it. Its named
  volumes survive, and its images were built from `85dcdd17`, so they
  predate this sitting's `compose.test.yml` change (the `TEST_ENVIRONMENT`
  line removed). Rebuild with `--build` before relying on it.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **A new `src/scripts/*.js` needs an npm entry or a `HAND_RUN` reason.**
  The arch guard enforces this.
- **Disease requirement keys are camelCase** (`treatmentStatus`), matching
  `SampleGraphValidator.defaultRequirements()`.

## Standing context: re-measure, don't copy

- Denise's newest live branch, 2026-09-24: `stabilize/v2.0.0-prototype`
  (`git for-each-ref refs/remotes/origin --sort=-committerdate`).
- Divergence, 2026-09-24: 904 commits on hers only, 128 on ours only
  (`git rev-list --left-right --count origin/stabilize/v2.0.0-prototype...HEAD`).
- Her tip's CI, 2026-09-24 18:52: current-state validation passed. Full
  Vitest diagnostic, Coverage diagnostic and release manifest integrity
  failed (`gh run list --branch stabilize/v2.0.0-prototype --limit 4`).

## Recommended next

None queued: Dennis named no next item. The branch has not passed the full
gate since `5fc5c843`. Dennis's go is still needed for a PR into `main`.
