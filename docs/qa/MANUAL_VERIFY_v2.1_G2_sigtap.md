# MANUAL_VERIFY v2.1 — G2 SIGTAP typeahead

**Goal:** Confirm SIGTAP procedure suggest works end-to-end on homolog tip 2.1 after import.

**Prerequisites**

- Mongo `terminologyConcepts` with `systemUri` = `https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS` (full dump **5068** from `docs/data/TabelaUnificada_202611_v2611051737/` **or** bundled sample ~200 rows).
- Runbook: `docs/operations/sigtap-full-import-v2.1.md`.

| Step | Action | Expected |
|------|--------|----------|
| G2-API-1 | `GET /api/dictionary/procedures/search?query=BIOP&limit=5` | `200`, `procedures.length > 0`, at least one `source: "SIGTAP"` |
| G2-API-2 | Search `query=0101010010` | Row with code `0101010010` and ATIVIDADE display |
| G2-WIZ-1 | Intake Passo 3 → Procedimentos → type `BIOP` | Dropdown with SIGTAP matches |
| G2-WIZ-2 | Select first suggestion | Name + 10-digit code filled |
| G2-WIZ-3 | Add date + **Adicionar procedimento** | Item in list; draft cleared |
| G2-MONGO-1 | `countDocuments` BRTabelaSUS | **Full:** count >> 200. **Sample-only:** ≈ 200 |

**Evidence to attach (G2 close):** screenshot of typeahead + API JSON snippet + mongosh count.

**Not in scope v2.1:** allergy DCB typeahead (separate backlog); institutional procedures merge still via same API.