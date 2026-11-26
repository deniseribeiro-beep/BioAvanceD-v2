# SIGTAP full import — v2.1 (G2)

Operational runbook: **Tabela Unificada SIGTAP** (`tb_procedimento.txt`) → JSONL → MongoDB `terminologyConcepts` → intake wizard typeahead (`GET /dictionary/procedures/search`).

Tracking: BioAvanceD v2.1 **G2** (SIGTAP full path readiness). Large binaries stay off GitHub — stage under `docs/data/` on the operator host or homolog VM (see `docs/decisions/2026-11-25-biomarker-association-official-import.md`).

## 1. Dump presence (local repo)

| Asset | Repo path | Status at doc time |
|-------|-----------|-------------------|
| Bundled sample JSONL | `api/backend/src/reference-data/reference-imports/fixtures/sigtap-procedures-sample.jsonl` | **Present** (~200 rows) |
| Lab converter | `api/backend/src/reference-data/reference-imports/lab/convertSigtapTabelaToJsonl.js` | **Present** |
| Import CLI | `api/backend/scripts/reference-imports/import-sigtap-procedures.js` | **Present** |
| Full `tb_procedimento.txt` | `docs/data/TabelaUnificada_202611_v2611051737/tb_procedimento.txt` | **Present** (~1.7 MB, **5068** procedures, competência **202611**) |

**Source (operator):** [SIGTAP — Tabela Unificada](http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp) → download the competência ZIP → extract (keep DATASUS folder name `TabelaUnificada_<YYYYMM>_…` or stage under `docs/data/sigtap/<YYYYMM>/`). Fixed-width, encoding **Latin-1**.

## 2. Staging layout (homolog / prod host)

**Preferred (as staged locally):**

```text
docs/data/TabelaUnificada_202611_v2611051737/
  tb_procedimento.txt          # from DATASUS ZIP
  sigtap-procedures.jsonl      # converter output (generated; do not commit)
```

**Alternate:**

```text
docs/data/sigtap/<YYYYMM>/
  tb_procedimento.txt
  sigtap-procedures.jsonl
```

Do not commit `tb_procedimento.txt` or full JSONL to Git.

## 3. Convert (fixed-width → JSONL)

From `api/backend` (host with Node.js, no DB required):

```bash
# Full table (competência 202611 staged dump)
npm run reference:lab:convert:sigtap -- \
  --in "../../docs/data/TabelaUnificada_202611_v2611051737/tb_procedimento.txt" \
  --out "../../docs/data/TabelaUnificada_202611_v2611051737/sigtap-procedures.jsonl"

# Smoke convert (first 50 rows)
npm run reference:lab:convert:sigtap -- \
  --in "../../docs/data/TabelaUnificada_202611_v2611051737/tb_procedimento.txt" \
  --out "/tmp/sigtap-smoke.jsonl" \
  --limit 50
```

Stdout reports `{"records":N,"outPath":"..."}`. For ZIP `TabelaUnificada_202611_v2611051737` expect **`records: 5068`** (>> 200 vs bundled sample).

**Homolog note:** import uses `bulkWrite` with `writeConcern: { w: 1 }`. Standalone lab Mongo (no replica-set majority) otherwise stalls when the driver injects `w=majority`.

**Sample-path verify (no full dump):** converter unit test + dry-run import on bundled fixture (§5).

## 4. Import into MongoDB

Target collection: `terminologyConcepts`  
`systemUri`: `https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS`  
`sourceId`: `SRC_SIGTAP`  
`semanticType`: `procedure`

Requires `MONGO_URI` in `api/backend/.env` (or env in the container).

```bash
cd api/backend

# Validate file only (no MongoDB)
npm run reference:import:sigtap-procedures:dry-run
npm run reference:import:sigtap-procedures:dry-run -- \
  --in "../../docs/data/TabelaUnificada_202611_v2611051737/sigtap-procedures.jsonl"

# Upsert (homolog / prod)
npm run reference:import:sigtap-procedures -- \
  --in "../../docs/data/TabelaUnificada_202611_v2611051737/sigtap-procedures.jsonl"
```

### Docker (homolog tip :8080 / test stack)

```bash
# From repo root — adjust compose file/env to your stack
docker compose --env-file .env.test.example -f compose.test.yml exec -T backend-app-test \
  node scripts/reference-imports/import-sigtap-procedures.js \
  --in src/reference-data/reference-imports/fixtures/sigtap-procedures-sample.jsonl
```

For full JSONL, mount `docs/data/...` into the backend container or `docker cp` the file before import.

## 5. Verify counts

**mongosh** (replace DB name):

```javascript
const SIGTAP = "https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS";
const n = db.terminologyConcepts.countDocuments({ systemUri: SIGTAP, obsolete: { $ne: true } });
print("sigtap_concepts=" + n);
// After full import: n >> 200 (sample only). After sample only: n ≈ 200.
db.terminologyConcepts.findOne(
  { systemUri: SIGTAP, code: "0201010208" },
  { code: 1, display: 1, sourceId: 1 }
);
```

**API smoke** (backend up, authenticated if required by your deployment):

```bash
curl -s "http://127.0.0.1:8080/api/dictionary/procedures/search?query=BIOP&limit=5"
```

Expect `procedures[]` with `source: "SIGTAP"`, `code` 10-digit, `display` populated.

## 6. Intake typeahead smoke (human / G4)

1. Ensure Mongo has SIGTAP concepts (§4–5).
2. Open intake wizard → **Passo 3** → **Procedimentos**.
3. In **Procedimento**, type at least 2 characters (e.g. `BIOP` or `020101`).
4. Pick a suggestion; **Código SIGTAP** fills automatically.
5. Set **Data de realização**, **Adicionar procedimento**; row appears in the list.

See also: `docs/qa/MANUAL_VERIFY_v2.1_G2_sigtap.md`.

## 7. Automated checks (CI-friendly)

```bash
cd api/backend
npm test -- tests/unit/convertSigtapTabelaToJsonl.test.js
npm test -- tests/unit/import-sigtap-procedures.test.js
npm test -- tests/unit/dictionary.procedures.search.test.js
```

Frontend (wizard wiring):

```bash
cd frontend
npm test -- src/components/v2/intake/ClinicalIntakeWizard.clinical.test.jsx
```

## 8. Rollback / re-import

Import is **upsert** on `(systemUri, code)`. Re-running the same JSONL is idempotent for display/metadata. To drop SIGTAP only:

```javascript
db.terminologyConcepts.deleteMany({
  systemUri: "https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS",
  sourceId: "SRC_SIGTAP",
});
```

Re-import from JSONL afterward. Do not run in prod without backup (`docs/operations/backup-restore-runbook.md`).

## 9. Related npm scripts

| Script | Purpose |
|--------|---------|
| `reference:lab:convert:sigtap` | `convertSigtapTabelaToJsonl.js` |
| `reference:import:sigtap-procedures` | Upsert JSONL → Mongo |
| `reference:import:sigtap-procedures:dry-run` | Parse/count only |

Defined in `api/backend/package.json`.