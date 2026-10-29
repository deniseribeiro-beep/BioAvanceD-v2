# 2026-10-24: a frontend entry screen for BiomarkerAssociation, at /biomarker-associations for Administrador and Coordenador

Dictionary ELM-0275..0285. Issue #1402.

## The question

No frontend screen created or edited a BiomarkerAssociation row, so rows reached `/api/biomarker-associations` only through the API, and the `/suggest` fallback, which reads only these rows, offered no biomarkers. Where does the screen sit, who reaches it, what does it enter, and what does a duplicate `biomarkerId` show?

## Decided

`[inference]`, from the `/consents` (#1375) pattern of gating a screen to exactly the backend's `requireRole(3, 4)`, by the coordinator for #1402, on 2026-10-24:

1. **The path is `/biomarker-associations`,** the API mount's name, as `/consents`, `/access-requests` and `/quality-descriptions` name theirs. It is not under `/admin`, which `ROUTE_ACCESS` gives to Administrador alone apart from `/admin/tcle`.
2. **Administrador and Coordenador reach it.** The mount's writes are `requireRole(3, 4)`, and its comment says the rows are entered by a Coordenador or Administrador; the `<Route>`, its `ROUTE_ACCESS` entry (`ADMIN_COORD`) and the sidebar item all name those two roles.
3. **The screen enters the five required fields,** `analyte`, `associatedCondition` (1..*, each from ORPHA, ICD-11 or MONDO), `biomarkerRole`, `contextOfUse` and `evidenceReferences` (1..*, DOI or PMID), **plus `biomarkerId` on create.** A blank `biomarkerId` is left out of the POST, so the backend generates it. An edit PUTs to the row's `biomarkerId` and sends only the five fields, never `biomarkerId`, so the 0..1 fields the screen does not show survive it. Validation stays on the backend.
4. **A 409 shows as a duplicate `biomarkerId`:** `Já existe uma associação com o biomarkerId <id>.`, with the form left open and its values kept. Every other refusal shows its message and each 422 detail.

## Not decided here

- **Entering the five 0..1 fields**: biospecimenMatrix, assayMethod, cutoff, evidenceLevel and regulatoryStatus.
- **Deleting a row**: the screen and its service create and edit only.
- **An e2e spec** for the screen, which needs a live app and waits for the Docker gate.
