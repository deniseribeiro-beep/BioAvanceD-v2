# 2026-07-31 doc refresh — delta against `docs/docs-7-27-2026/`

Source: Denise's `Modelagem-20260731T212528Z-1-001.zip` drop, closing out
issue #377. This folder follows the same dated-batch pattern as
`docs/docs-7-27-2026/`; read that folder's own files first if you haven't
— this one only documents what changed since then.

## What changed

- **`1 - Requisitos Funcionais e Não Funcionais.docx`**: v3.0.0 (22 Jul)
  → **v3.0.1 (31 Jul)**. Content diff (apples-to-apples pandoc
  conversion, old source docx vs new): the RF001–RF029 table rows
  themselves are **unchanged** — same IDs, same acceptance criteria. The
  fix is to the Appendix B intro paragraph and the "Decisões
  permanentes" callout, which in v3.0.0 incorrectly said "RF023 =
  Foundation Data Pipeline; RF029/RF030 split reference-load vs.
  operational-ingestion; RF014 remains reserved" — v3.0.1 corrects that
  prose to match what the table already said: **RF022** = Foundation
  Data Pipeline, **RF023** = outbox/Neo4j projection, **RF028** =
  reference-data import, **RF029** = operational/scientific ingestion,
  **RF014** = Políticas de segurança, and explicitly confirms **RF030
  does not exist**. This is exactly the doc defect
  `E2E_TRACEABILITY_PLAN.md` flagged on 2026-07-27 (see its "Doc defect
  found during extraction" note) — now fixed upstream, not a new
  finding.
  - **No action needed on `docs/docs-7-27-2026/extracted/requisitos-index.md`** — it was already built from the table rows, not the buggy prose, so its RF014/022/023/028/029 entries were already correct and match v3.0.1 verbatim.
- **`3 - Plano_Integrado_Foundation_Data_Pipeline.docx`**: v2.1.0 (22
  Jul) → **v2.1.1 (31 Jul)**. Same RF numbering prose fix as above
  (section 4, "Autoridade documental"), plus real additions:
  - **3 new gates**: `F2-G09` (sources with multiple endpoints/assets/partitions need a coverage manifest — expected vs. obtained counts, justified exclusions; unjustified partial coverage blocks promotion), `F3-G09` (reports/exports must derive organizational scope from active assignments and prevent cross-org/collection/study leakage), `F3-G10` (specimen allocation/movement/release spanning multiple documents must run in a real MongoDB transaction on a replica set, with proven atomicity/rollback).
  - Expanded CI/testing/security requirements: CI from clean checkout with full test-file discovery, no unapproved coverage regression, Playwright against the real compose stack, `.env.example`/Compose/CI/runner key parity, no relaxing security controls via a generic `NODE_ENV` check, AuditEvent canonicalization for nested objects/arrays/nulls/dates with cycle rejection, and file/workflow canonical linkage (`specimenId`/`assayId`/`studyId`/`datasetId`) with full upload/access/replace/delete audit.
- **`2 - Dicionario_Dados_Consolidado_v1.3.0.xlsx`**: included in the zip but **byte-identical** (verified by SHA-256) to the copy already at `docs/docs-7-27-2026/2 - Dicionario_Dados_Consolidado_v1.3.0.xlsx` — not duplicated here. That copy remains the canonical v1.3.0 dictionary.

## New supporting material (not previously tracked)

- `manuscript/2.2-Additional_file_2_Polyglot_Persistence_Data_Model.docx`
  (v1.0.1, 31 Jul) — a data-model design spec covering all 26
  domains/79 entities: structural classification, persistence matrix,
  architecture views. This is a strong candidate source for finally
  fixing `docs/architecture/canonical-data-contract-v1.md`'s known
  staleness (still lists `patientName`/`birthDate` directly on
  `Participant` instead of the segregated `ParticipantIdentity` model —
  see `E2E_TRACEABILITY_PLAN.md`'s "Docs/skills that need a second
  look" section). Not applied to that file in this pass — deliberately
  deferred to whoever picks up RF005's red test, per that section's own
  guidance not to make it "a surprise mid-fix."
- `manuscript/2.1-Additional_file_1.xlsx` — sources/standards reference
  table (ISO 20387, ISBER, etc.) backing the manuscript.
- `manuscript/4 - Manuscript.pdf`, `4.1-...pdf`, `4.2-...pdf` — revised
  versions (different SHA-256) of the manuscript and its two
  supplementary files already tracked at
  `docs/research/cmpb-submission/{manuscript,supplementary}/`. **Not
  used to overwrite the submission copies** — those are tied to a real
  CMPB submission (`CMPB-S-26-05153.pdf`, cover letter, declaration
  statements already on file); whether these revisions should supersede
  the submitted versions is Dennis/Denise's call, not assumed here.
- `docs/architecture/diagrams/Figure_{1,2,3}_*.svg` — clean vector
  versions of the C4 Context/Container + flowchart diagrams that
  `docs/docs-7-27-2026/extracted/diagrams-index.md` only had as
  transcribed WhatsApp phone photos. See that file's new pointer note.

## Not a docs update — parked separately

`Roteiro_Incremental_Codex_BioAvanceD_v3.md` and
`Plano_Backend_BioAvanceD_v3_Fase_1.docx` describe a lab-by-lab
implementation roadmap for a **separate, not-yet-created "BioAvanceD-v3"
rewrite repo** — they explicitly instruct against touching/importing
from this repo (BioAvanceD-v2). Parked at
`docs/planning/bioavanced-v3/` as reference-only; no action taken on
their content in this repo.
