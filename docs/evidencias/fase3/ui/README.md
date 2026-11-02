# UI 100% — inventário de evidências (Fase 3)

**Ambiente:** lab GCP `us-central1-a` via tunnel `127.0.0.1:5173`  
**Operador:** `admin` (após forceReset + troca de senha lab)  
**Corpus:** BLPP N=10000 `applyMode=service` runId `blpp-9002-10000-1793583172977` (+ corpus lab-direct prévio; totais ~20k)

## Índice figura → rota → achado

| Fig | Rota | Achado |
|---|---|---|
| 00-login.png | `/login` | Auth OK; forceReset/troca de senha exercitado |
| 01-dashboard.png | `/dashboard` | Shell autenticado; overview |
| 02-patients.png | `/patients` | Diretório + consentimento Assinado |
| 03-samples.png | `/samples` | Inventário (janela local 50) + busca |
| 04-withdrawal-return-routing-bug-before.png | `/samples/withdrawal-return` | Antes: `:id` capturava a rota |
| 04-withdrawal-return.png | `/samples/withdrawal-return` | Após fix: busca por barcode |
| 04b-withdrawal-confirm.png | idem | Confirmação retirada parcial 10 µL |
| 04c-withdrawal-done.png | idem | Pós-retirada / formulário devolução |
| 05-custody-reports.png | `/samples/custody-reports` | Custódia + View sample movements |
| 06-sample-detail-rcs.png | `/samples/:id` | Governance Graph + RCS-GOV (blocked) |
| 07-quality-descriptions.png | `/quality-descriptions` | Catálogo GOOD/COMPROMISED/UNKNOWN |
| 08-intake.png | `/next/intake` | Intake Wizard Step 1/3 |
| 09-import-lgpd.png | `/import/lgpd` | Import CSV/XLSX + templates |
| 10-import-quarantine.png | `/import/quarantine` | Quarentena vazia (sem rejeições) |
| 11-import-fhir.png | `/patients/import-fhir` | Import FHIR R4 |
| 12-facility.png | `/facility-management` | Equipamentos/sensores/temperatura |
| 13-reports.png | `/reports` | Central de relatórios (L8 export) |
| 14-report-templates.png | `/reports/templates` | Templates ACTIVE |
| 15-system-management.png | `/system-management` | Admin users/RBAC (L9) |
| 16-access-requests.png | `/access-requests` | RF024 solicitações |
| 17-consents.png | `/consents` | Histórico TCLE por participantId |
| 18-tcle-builder.png | `/admin/tcle/new` | Construtor de TCLE |
| 19-dictionary.png | `/admin/dicionario` | Dicionário + Export PDF (L8) |
| 20-backup.png | `/backup` | Backup Management |
| 21-logs.png | `/logs` | Gate RBAC presente; falso negativo Admin vs Auditor (documentado) |
| 22-user-security.png | `/user/security` | MFA Inactive / score Weak |
| 23-biomarkers.png | `/biomarker-associations` | Lista vazia + Nova Associação |
| 24-results.png | `/results` | Analysis Files / upload |
| 25-settings.png | `/settings/parameters` | Tipos de análise |

## Correções aplicadas durante a captura

1. **Roteamento:** rotas estáticas `/samples/withdrawal-return` e `/samples/custody-reports` registradas antes de `/samples/:id`.
2. **Detalhe de amostra:** fallback `GET /samples/:id` quando o ID não está na janela in-memory de 50.

## Fluxo U2 (obrigatório)

Ver [`../ui-rcs-liberacao.md`](../ui-rcs-liberacao.md) — barcode `BR-2026-10107`.

## Fora do inventário autenticado (intencional)

- `/patient/e-consent/*` — fluxo titular sem login (token)
- `/mfa-setup`, `/reset-password` — sob demanda
