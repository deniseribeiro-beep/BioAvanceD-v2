# 2026-11-12: The imports' governance evidence references

Requirement RNF018 AC5, RF018 AC7. Issue #1524. Sequel to `2026-11-12-rcs-governance-evidence-intake.md`.

## The question

RNF018 AC5 asks certification to refuse evidence with a missing artefact hash or an unresolvable URI. The preview, `sampleService.createSample` and the intake wizard resolve a body's `governanceEvidence` references with `governance-evidence-resolver.service.js`. The batch import (`POST /api/import/batch`, `batch-validation-engine.service.js`) reaches `createSample` but dropped a row's `governanceEvidence`, so a JSON row's references were never checked. Which imports present evidence, and how does each reach the resolver?

## Decided

`[inference]`, by the coordinator for #1524, from the pattern of `2026-11-12-rcs-governance-evidence-sample-registration.md` items 1 and 3 (the server resolves what a body presents; absent evidence stays null) and RF018 AC2's use context, which reaches the assessment only when sent.

1. **The batch import passes a JSON row's `governanceEvidence` to `createSample`**, which resolves it as for `POST /api/samples`. The value goes as the row holds it, and the resolver judges it. A row's `governanceEvidenceResolution` never reaches `createSample`. A custody-event or telemetry reference fails closed, since the sample does not exist yet (sample-registration item 2).
2. **A CSV or XLSX row presents no evidence**, in the batch import, the LGPD import and the CSV/XLSX sample import: a cell holds a scalar and no column encoding of a reference list is defined, so its criteria stay `null`, as absent evidence does.
3. **The FHIR staging import presents none**: the dictionary maps V2E-0528..0532 to no FHIR element ("Not directly mapped"), so its criteria stay `null`.
4. **Nothing else changes**: `certify`, `governanceRuleSet()` and its checksum are unchanged.

## Not decided here

- **The sample edit**, which does not certify at all.
- **The JSON sample import of `import.service.js`**, which records the file's own `rcsEvaluation` without certifying.
- **The batch import's mapping of no `sprec_*` column.**
- **SOP (Protocol) references.**
- **A rule-package version for the evidence rule.**
