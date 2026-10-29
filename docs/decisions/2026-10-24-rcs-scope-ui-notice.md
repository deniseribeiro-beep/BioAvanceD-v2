# 2026-10-24: the frontend states that the RCS is not clinical validity wherever it shows an RCS grade or score

Requirement RF018 AC11. Issue #1320. Sequel to `2026-10-24-rcs-assessment-sprec-version.md`, whose "Not decided here" list named this notice, as `2026-10-23-rcs-rule-package-and-scope.md` did before it.

## The question

RF018 AC11 asks not to represent the RCS "como validade clínica, qualidade analítica do ensaio ou medida universal". Every RCSAssessment's justifications end with `RCS_SCOPE_STATEMENT` (`rcs-certification.service.js`), but the UI showed RCS grades and scores without it. Where does the UI state it, in what words and language, and from what source, without changing a score, grade, route or backend file?

## Decided

`[inference]`, from AC11's wording, the backend statement and the repo's pattern (the RCS labels beside it are hard-coded pt-BR), by the coordinator for #1320, on 2026-10-24:

1. **The notice is shown where the UI renders an RCS grade or score**: the withdrawal page's `Qualidade:` row when a grade is set (`isRcsGradeShown`), and the FHIR import quality summary (`FhirImportQualitySummary`), each through `RcsScopeNotice`.
2. **The intake wizard carries no notice.** It shows no RCS since `e9fc064c`: its RCS label helpers have no call site. A future render of them shows `RcsScopeNotice` with it.
3. **The report query's grade filter carries none.** It filters by grade and shows no assessment.
4. **The text is pt-BR and hard-coded**: "O RCS qualifica o histórico pré-analítico da amostra para o contexto de uso declarado; não é validade clínica, qualidade analítica do ensaio nem medida universal de qualidade." It mirrors `RCS_SCOPE_STATEMENT` as the frontend constant `RCS_SCOPE_NOTICE`, because no API returns an RCSAssessment to the frontend.
5. **Nothing else changes.** No backend file, score, grade, route or `calculation_trace` changes.

## Not decided here

- **i18n of the notice** into en-US and es-ES.
