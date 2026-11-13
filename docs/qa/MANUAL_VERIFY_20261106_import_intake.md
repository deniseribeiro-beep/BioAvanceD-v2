# MANUAL_VERIFY — importação em lote, intake e páginas admin (2026-11-06)

Escopo: plano *Intake Import UX Pass* (FHIR no menu, paginação, intake SPREC/biomarcadores, empty state de associações).

## Automação local (unit)

| Suite | Resultado |
|---|---|
| `useClientPagination` + `ListPagination` + `PatientsPage` + `FhirImportPage` + `AccessRequestsPage` | PASS (rodada parcial) |
| `ClinicalIntakeWizard.clinical.test.jsx` + `.test.jsx` | PASS (43) |

## Checklist homolog (`:8080`)

| ID | Rota | Critério | Status |
|---|---|---|---|
| IMP-001 | Sidebar → Importação em lote | Abre `/patients/import-fhir`; título “Importação em lote” | PENDING_DEPLOY |
| IMP-002 | `/import/lgpd` | Redirect para `/patients/import-fhir` | PENDING_DEPLOY |
| IMP-003 | `/patients` → Importar dados | Navega para `/patients/import-fhir` | PENDING_DEPLOY |
| QUA-001 | `/import/quarantine` | Subtitle + paginação de lotes (10) | PENDING_DEPLOY |
| ACC-001 | `/access-requests` | Subtitle + lista paginada + detalhe em card | PENDING_DEPLOY |
| BKP-001 | `/backup` | `page-shell` + paginação da lista | PENDING_DEPLOY |
| DIC-001 | `/admin/dicionario` | Header app + índice/tabelas legíveis | PENDING_DEPLOY |
| BIO-001 | `/biomarker-associations` | Empty state quando catálogo vazio (sem seed) | PENDING_DEPLOY |
| INT-001 | `/next/intake` passo 2 | Cards SPREC em grid (não texto empilhado) | PENDING_DEPLOY |
| INT-002 | `/next/intake` passo 3 | Seção “Biomarcadores do dicionário clínico” + sugestões HPO/doença | PENDING_DEPLOY |
| SUG-001 | `GET /dictionary/suggest?orphaCode=324` | HPO pode vir de terminologias; biomarcadores vazios se `biomarkerAssociations`=0 | PENDING_HOMOLOG |

## Skips conscientes

| ID | Motivo |
|---|---|
| SKIP-SEED-BIO | Não popular `biomarkerAssociations` / Neo4j neste passe |
| SKIP-UI-GOLD-FULL | Regenerar `tests/e2e/ui-gold-screenshots.spec.ts` após tip-deploy na VM (artefatos em `test-results/ui-gold-screenshots/`) |
| SKIP-LGPD-PAGE | `ImportLGPDPage` fora do nav; API `/import-lgpd` permanece para quarentena histórica |
| SKIP-TIP-DEPLOY | Homolog `:8080` responde 200 em tip `d27cc929`; mudanças deste passe ainda **não commitadas**. Tip-bundle + `deploy-on-vm.sh` após pedido explícito de commit/push |
