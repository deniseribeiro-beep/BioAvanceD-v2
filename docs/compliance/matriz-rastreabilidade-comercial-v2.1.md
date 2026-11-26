# Matriz rastreabilidade — escopo comercial BioAvanceD 2.1

Regra: requisito → implementação → teste → evidência. Escopo = PENDING G0–G13 + W7.  
Release: tag **`v2.1.0`**. Domínio paliativo: **`https://www.bioadvanced.dev`** (IAP off).

| Req (G*) | Implementação | Teste | Evidência |
|----------|---------------|-------|-----------|
| G0 Sanitização docs | `docs/_archive/pre-2.1/`, `SOT_2.1.md` | Revisão inventário | `docs/_archive/pre-2.1/INVENTORY.md` |
| G1 Crosswalk MarkerDB | `markerDbConditionCrosswalkLib.js` + TSV import | unit + tip suggest Fabry 135 | `docs/qa/MANUAL_VERIFY_v2.1_G1_crosswalk.md` |
| G2 SIGTAP | convert/import + intake typeahead | unit + tip sigtap=5068 | `docs/qa/MANUAL_VERIFY_v2.1_G2_sigtap.md`, `docs/operations/sigtap-full-import-v2.1.md` |
| G3 CPATH/FDA_PGX | ADR N/A | n/a | `docs/decisions/2026-11-26-cpath-fda-pgx-na-v2.1.md` |
| G4 Smokes humanos | tip 2.1 | MANUAL_VERIFY G4 (G4-09 out ADR) | `docs/qa/MANUAL_VERIFY_v2.1_G4_smokes.md`, `docs/decisions/2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md` |
| G5 Busca única | SamplesPage + SampleLocator | unit SamplesPage | `docs/qa/MANUAL_VERIFY_v2.1_labels.md` |
| G6 Etiquetas | SampleLabelPage Code128/DataMatrix | unit + manual | `docs/qa/MANUAL_VERIFY_v2.1_labels.md` |
| G7 TCLE+import | TcleBuilder + FHIR/quarantine | MANUAL_VERIFY import_tcle | `docs/qa/MANUAL_VERIFY_v2.1_import_tcle.md` |
| G8 TCLE gov.br | govbrOidc + mock hygiene | unit + human residual G8-GOVBR-REAL | `docs/qa/MANUAL_VERIFY_v2.1_identity.md` (REAL = post-tag) |
| G9 Tenant-only | tenantInvite + invite UI | unit tenantInvite | `docs/qa/MANUAL_VERIFY_v2.1_identity.md` |
| G10 ADR acesso | ADR tenant-only; IAP off no LB | review + smoke domínio | `docs/decisions/2026-11-26-access-tenant-only-identity.md`, `docs/runbooks/bioadvanced-iap-access.md` |
| G11 Empacote | install/config/SLA/changelog | doc review | `docs/operations/support-sla-v2.1.md`, `docs/operations/changelog-v2.1.0.md` |
| G12 Issues | ADR outs + closes | `gh issue list` | `docs/decisions/2026-11-26-issues-out-of-v2.1.md` |
| G13 Runbook+legal | productLegal + RunbookPage | unit productLegal | MANUAL_VERIFY import_tcle / legal routes |
| W7 Ex ante | RF016 protocol tip RC | `physical-chain` 4/4 GCP | `docs/evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md`, `docs/qa/MANUAL_VERIFY_v2.1_ex_ante_gate.md` |
| Domínio HTTPS | LB + cert Google + proxy `:8080` | smoke www login/API | `docs/runbooks/bioadvanced-iap-access.md`, `docs/qa/RELEASE_AUDIT_v2.1.0.md` |

## Residual pós-tag (não reabre W7)

| Item | Owner | Evidência alvo |
|------|-------|----------------|
| G8-GOVBR-REAL | product/ops | `identityProof.provider: govbr`, `mock: false` |
| Apex DNS `bioadvanced.dev` A `@` | ops | `nslookup bioadvanced.dev` → `136.110.235.22` |
| Domínio grafia correta (futuro) | product | novo registro + cert SAN |
