# PENDING_HUMAN_REVIEW — Passo 3 / MarkerDB wave (2026-11-25)

Decisões humanas registradas 2026-11-25/26. Itens **DECIDED** saem da fila de bloqueio; implementação segue o plano `phr_decisions_execution`.

| ID | Item | Decisão | Status |
|----|------|---------|--------|
| PHR-001 | Dump MarkerDB full | Re-download **9 datasets TSV+XML** de https://markerdb.ca/downloads (2024-09-12). XML=autoridade, TSV=fallback. Staging `docs/data/markerdb/` (fora do Git pesado). Pack consolidado → Zenodo (DOI manual pelo operador). Uso **não-comercial** + citação Wishart 2021. Gap vs ELM-0275..0285 **antes** do import; atualizar modelo se faltar campo. | DECIDED → exec |
| PHR-002 | SRC_CPATH / SRC_FDA_PGX | Redistribuição de dumps oficiais = **regra permanente**. Planejar FONTES/ADR; converters + compose RF028 nesta release; dumps no pack Zenodo quando disponíveis. | DECIDED → exec |
| PHR-003 | Neo4j outbox BiomarkerAssociation | Contrato aprovado: `BIOMARKER_ASSOCIATION_UPSERTED`, aggregate `BiomarkerAssociation`/`biomarkerId`, payload orpha+analyte+role+context, 1 evento por par doença↔analito, Cypher `POSSUI_BIOMARCADOR`. Ordem: outbox+projector **antes** do dump full; rebuild one-shot + contínuo. | DECIDED → exec |
| PHR-004 | Issues GitHub open | In: open com labels (bug → enhancement); unlabeled no fim (baixa). Out: documentar 1 linha. Sem decisão documentada → parar e perguntar. | DECIDED → exec |

## PHR-004 — Issues open (snapshot 2026-11-26)

Prioridade bug → enhancement → demais → unlabeled.

| # | Label | In/Out | Motivo |
|---|-------|--------|--------|
| 1583 | bug | IN | Timeout flaky vitest — afeta gate |
| 1465 | bug | IN | TLS 1.0/1.1 — hardening (pode ser pós-gate se não no e2e local) |
| 1542 | enhancement | IN | FE standardization faltando na branch docker-e2e — alinhamento merge |
| 1566 | enhancement | IN | Converters full-lab ausentes — relacionado RF028/Zenodo pack |
| 1562 | enhancement | IN | Snapshot mongodump full-lab — alinhado pack Zenodo |
| 1561 | enhancement | IN | Performance promotion 1.1M rows |
| 1407 | enhancement | IN | DatasetSnapshot manifest |
| 1325 | enhancement | OUT | W11 deployment hardening — plano próprio pós-wave |
| 1320 | enhancement | OUT | RCS v4 W10 — plano próprio |
| 1580 | enhancement | OUT | Vídeo showcase CD — não bloqueia funcional |
| 1565 | ci | OUT | Spot VM OIDC opcional/pago |
| 1560 | question | OUT | Conta GCP — operacional humano |
| 1326 | tracking | OUT | Roadmap W4–W11 — tracking, não desta wave |
| 682 | enhancement | OUT | Checklist NODE_ENV — pré-deploy produção pública |

Gate pré-existente (e2e-gate-out-ci2): corrigir nesta wave antes do merge — `rnf027-axe` `/facility-management`, `ui-mongo-binding` samples.

## Git / gate

- Branch: `feature/docker-e2e-backend-integration` → merge `main`
- Critério: gate GCP tmux **0 failed**; depois commit/push/merge com skip CI
- TCLE gov.br/ICP-Brasil: **após** MarkerDB/outbox/gate verde
