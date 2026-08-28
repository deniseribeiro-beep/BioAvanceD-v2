# CI — read this before filing a CI gap

**Short version: CI is deliberately not wired yet. We are in the pre-CI
stage, making Playwright ready first.** If you found a CI requirement in
the documents under `docs/` and observed that `ci-pipeline.yml` does not
implement it, that is almost certainly **sequencing, not a gap.**

This note exists because that mistake was made on 2026-08-28 (issue #852,
closed premise-corrected): a session read a real requirement out of
`docs-7-31-2026/3 - Plano_Integrado_Foundation_Data_Pipeline.docx`,
confirmed CI did not implement it, and filed it — without checking the
milestones, which already say when it happens.

## The sequence, per Dennis (2026-07-27)

Recorded in the milestone descriptions, which are authoritative for
*ordering*:

1. **Unit tests** — milestone #1, "90% Test Coverage". Largely done;
   branches was the last laggard.
2. **Playwright e2e tests** — milestone #2, real backend, Docker.
   **This is the current stage.**
3. **Docker hardening.**
4. **CI integration** — milestone #3. Its description says plainly:
   *"Do not start wiring CI until #2 closes; the CI job would just be
   automating tests that don't exist yet or are still using
   dead-scaffolding auth."*

## So, before filing anything CI-shaped

```
gh api repos/deniseribeiro-beep/BioAvanceD-v2/milestones \
  --jq '.[] | "#\(.number) [\(.state)] \(.title)\n\(.description)"'
```

Read milestone #3 first. Its **"Known starting gaps"** section already
lists the usual discoveries — that `ci-pipeline.yml`'s single job never
invokes Playwright, and that `compose.test.yml`'s `playwright-runner` and
`frontend-unit-runner` services are defined but unused and misconfigured.
Those are tracked on **#284**, not undiscovered.

A CI requirement found in the docs belongs in **milestone #3's acceptance
criteria**, not in a new issue. Known example: the Plano Integrado's
validation gate requires CI to fail on an undiscovered test file, on
`regressão não aprovada de cobertura`, and on Playwright not having run
against real containers.

## The general rule this is an instance of

**The documents say what must eventually be true. The milestones say
when.** Reading the first without the second reliably produces issues that
only mean "this is scheduled for later."

Note also that CI currently fires **only on push/PR to `main`** — restricted
in `17f35eba` until the Docker e2e plumbing is ready — so pushing the
integration branch runs no CI at all. That is intentional too.

## Related

Milestones #1, #2, #3 · issues #284, #852 · `E2E_TRACEABILITY_PLAN.md` and
`E2E_IMPLEMENTATION_PLAN.md` at the repo root.
