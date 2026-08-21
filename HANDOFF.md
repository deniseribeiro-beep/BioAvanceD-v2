# HANDOFF

**Written:** 2026-08-21. Docker is on.

## Rabbit-hole EXIT: #646 -> #707 closed at the #707 level -- all 6 sub-slices landed

**Tracker: #646** (Wave 3 kickoff) -> **#707** (RF005: wire remaining 6
clinical-data entities into real intake-wizard UI + a real CCI
algorithm) -> **closed this sitting**.

This sitting continued directly from the prior handoff's state (4/6
done: #708-711 already landed) and finished the remaining two:

- **#712 (ClinicalOutcome):** no longitudinal-outcome UI existed in the
  wizard before this -- added a manual-entry outcome field (`Select`
  over dict-02's 7 outcomeType categories, mapped to English slugs,
  plus a required outcome date) to `ClinicalIntakeWizard.jsx`, wired
  additively via `recordClinicalEntities`. Also had to add
  `clinicalOutcomes` to `contracts/canonical/v1/index.js`'s
  `clinicalDataSchema` AJV contract -- a second, independent validation
  gate from `buildClinicalData`, missed on the first pass, caught by a
  422 `NON_CANONICAL_FIELD` mid-work. Also fixed a pre-existing broken
  `toEqual` test in `intakeWizard.helpers.test.js` that #708-711 never
  updated for their own added fields. Merged `cdaddcd4`.
- **#713 (real Charlson Comorbidity Index + DerivedScore):** implemented
  the original-1987 CCI as a new pure module
  (`api/backend/src/services/charlsonComorbidityIndex.js`), wired into
  `recordClinicalEntities` to create a `DerivedScore`. The wizard's
  existing `charlsonConditions` checklist (12 items) predates this
  slice and was never the real 19-category Charlson set -- only
  `diabetesType1`/`diabetesType2` (collapsed to one "diabetes"
  category, weight 1), `copd` (weight 1), and `ckd` (weight 2)
  genuinely map to real Charlson categories; the rest are correctly
  excluded from the score (dict-05 REF-033's own caution). **Also
  discovered and fixed inline, since it blocked #713's own DoD:** the
  wizard had formData fields, a schema, and even a pre-existing unit
  test (#522) for the comorbidity checklist, but literally no checkbox
  ever rendered in the JSX -- `charlsonConditions` was always empty
  from a real submission. Added the missing checkbox grid. Merged
  `7daa068f`.

All four #708-711 progress comments, plus two more (5/6, 6/6), landed
on #707 across this sitting and the prior one. #707 closed with a
summary naming all 6 merge commits.

**#707's own parent chain, checked fresh (not assumed from the prior
handoff's narrative):** #697 (the issue #707 split from) was already
closed. **#646 ("Wave 3 kickoff," scoped to RF014/015/016/017/024/025/
026/029) does NOT actually list #707/RF005 as one of its own items** --
its body was re-read fresh this sitting and RF005 doesn't appear
anywhere in it. The prior handoff's "#646 -> #707" framing was a loose
rabbit-hole lineage note, not a real tracking relationship. **#646
stays open, completely untouched this sitting, with its own unrelated
scope** -- picking it up next is a fresh, unrelated rabbit hole, not a
continuation of anything landed here.

**New issues filed this sitting:**
- [**#715**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/715):
  the real CCI only scores 3 of the original index's 19 categories
  today, because the wizard's checklist only collects data for those 3
  -- a completeness follow-up, not a correctness bug (the score is
  accurate for what it can compute). Not blocking, doesn't reopen #713.
- [**dyeallpies-skills-pack#379**](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/379):
  `build-loop`'s own `local-env` overlay already documented the exact
  fix for the #712 AJV-schema miss above, but this session never read
  that overlay before starting -- a session-friction report about the
  skill's structure, not a product issue.

## What landed this sitting

- 2 merge commits (`cdaddcd4`, `7daa068f`) on
  `feature/docker-e2e-backend-integration`, pushed to origin.
- #712, #713 closed. #707 (tracker) closed. Both per-issue branches
  (`test/712-...`, `test/713-...`) merged `--no-ff` and deleted
  locally; neither was ever pushed remotely.
- #715 filed (product follow-up). dyeallpies-skills-pack#379 filed
  (skills-pack friction report).
- Full native backend unit suite run twice this sitting (once per
  slice), green both times: 6623/6623 after #712, 6637/6637 after
  #713.
- Two real-backend Playwright proofs, one per slice, both 1/1 passing
  against the Docker test stack (`compose.test.yml`, `--build` for
  `backend-app-test`/`frontend-app-test` each time, since both slices
  touched backend and/or frontend source).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `7daa068f`. No PR to `main` exists. `main` stays frozen per this
  repo's convention.
- **Docker: UP.** The test stack was rebuilt twice this sitting
  (`--build` for `backend-app-test`/`frontend-app-test`, once per
  slice). Mid-sitting, after #712 landed, Dennis was asked whether to
  tear it down and explicitly chose to leave it running (anticipating
  #713's pickup, which then happened in the same sitting). It is still
  up at session end -- the next session should confirm it's still
  healthy (`docker ps`) rather than assume, and rebuild
  `backend-app-test`/`frontend-app-test` again before trusting it
  reflects any newer source changes (build-not-mount gotcha,
  `docker-workflow`'s BioAvanceD-v2 overlay).

## Recommended next steps

No specific issue was named by Dennis for the next session -- none
queued. For reference, what's currently open and relevant:

- [**#714**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/714)
  (from a prior sitting, untouched this one): three manually-coded
  entities (`AllergyIntolerance`/`FamilyHistory`/`Procedure`) don't
  gate their coded fields on `activeCodeValidator` per RF005 AC#4 --
  ordinary backlog.
- [**#715**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/715)
  (filed this sitting): extend the wizard's comorbidity checklist to
  cover more of the real 19 Charlson categories -- smaller, well-scoped.
- **#646** (Wave 3 kickoff: RF014/015/016/017/024/025/026/029) remains
  open, completely untouched across this sitting and the prior ones --
  a fresh pickup here is unrelated to everything #707's rabbit hole
  covered.
- #674 stays parked on RF027 (Wave 4, not started, out of scope) --
  unless Dennis pulls it forward, untouched.
