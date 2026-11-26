# Source of Truth — BioAvanceD v2.1

Índice canônico do tip comercial **2.1.0**. Waves posteriores só entram aqui quando mergeadas em `main` com evidência.

## Go-live

| Artefato | Path |
|----------|------|
| Scorecard G0–G13 + waves | [execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md](execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md) |
| Este índice | [SOT_2.1.md](SOT_2.1.md) |
| Archive pré-2.1 | [_archive/pre-2.1/INVENTORY.md](_archive/pre-2.1/INVENTORY.md) |

## ADRs no tip (`main`)

| Tema | Path | Wave |
|------|------|------|
| Acesso + identidade (G10) | [decisions/2026-11-26-access-tenant-only-identity.md](decisions/2026-11-26-access-tenant-only-identity.md) | **W1** |
| TCLE gov.br / ICP | [decisions/2026-11-26-tcle-govbr-icp-identity.md](decisions/2026-11-26-tcle-govbr-icp-identity.md) | pré-2.1 |
| G4-09 gov.br real out of tag (Option B) | [decisions/2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md](decisions/2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md) | **W5/W7** |
| MarkerDB provisional | [decisions/2026-11-26-biomarker-condition-markerdb-provisional.md](decisions/2026-11-26-biomarker-condition-markerdb-provisional.md) | pré-2.1 |
| Outbox biomarcador | [decisions/2026-11-26-biomarker-association-neo4j-outbox.md](decisions/2026-11-26-biomarker-association-neo4j-outbox.md) | pré-2.1 |
| Import oficial biomarcador | [decisions/2026-11-25-biomarker-association-official-import.md](decisions/2026-11-25-biomarker-association-official-import.md) | pré-2.1 |

ADRs W2+ (G3 N/A, Runbook/Termos, drawer, TLS defer, issues-out) entram no SoT **somente** após merge da wave correspondente.

## QA / evidência tip

| Artefato | Path |
|----------|------|
| TRACE Achados 1–6 | [qa/TRACE_20261125_intake_cpf_mask_human_qa.md](qa/TRACE_20261125_intake_cpf_mask_human_qa.md) |
| MANUAL_VERIFY tip | [qa/MANUAL_VERIFY_20261106.md](qa/MANUAL_VERIFY_20261106.md) |
| Ex ante RF016 v2.1 | [evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md](evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md) |
| Release audit `v2.1.0` | [qa/RELEASE_AUDIT_v2.1.0.md](qa/RELEASE_AUDIT_v2.1.0.md) |
| Matriz comercial | [compliance/matriz-rastreabilidade-comercial-v2.1.md](compliance/matriz-rastreabilidade-comercial-v2.1.md) |

## Operação

| Artefato | Path |
|----------|------|
| Install | [operations/install-runbook.md](operations/install-runbook.md) |
| Configuration | [operations/configuration-runbook.md](operations/configuration-runbook.md) |
| HTTPS domínio (IAP **off**; produto tenant) | [runbooks/bioadvanced-iap-access.md](runbooks/bioadvanced-iap-access.md) → `https://www.bioadvanced.dev` |

## Wave status (auditoria)

| Wave | Escopo | Tip `main` |
|------|--------|------------|
| W1 | G0 + G10 | DONE |
| W2–W6 | G1–G13 tip | DONE (G4 com ADR Option B) |
| W7 | Ex ante → tag → prod | **DONE** RF016 PASS + tag `v2.1.0`; domínio www HTTPS sem túnel |

## Fora do go-live 2.1

- DOI Zenodo e packs acadêmicos → archive / evidências históricas; **não** bloqueiam tag.
- G8-GOVBR-REAL (Login Único real) → residual pós-tag; ADR Option B; piloto remoto = ICP/panel.
- Apex DNS `bioadvanced.dev` A `@` se ainda não resolver — usar `www` até Name.com corrigir.
- Mocks de runtime (`GOVBR_OIDC_MOCK`) → só CI; **proibidos** no aceite comercial.
- Corpus `docs/mestrado/*` → keep acadêmico; não é SoT de produto.
- Packs Zenodo sob `_archive/pre-2.1/zenodo-stages/` podem existir só no filesystem; tip git mantém inventário + `ZENODO.md` movido (binários/ui-live não precisam entrar no git).
