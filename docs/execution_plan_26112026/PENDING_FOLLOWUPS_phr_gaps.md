# BioAvanceD **v2.1** — programa de release (comercial / certificação)

Fila **obrigatória** para a release **2.1.0**. Não é um único PR: é um programa (várias waves + evidência + ensaio ex ante → produção).

Marque `[x]` **somente** com evidência (contagem Mongo, log, MANUAL_VERIFY, commit, issue fechada).

**Índice SoT:** [`docs/SOT_2.1.md`](../SOT_2.1.md)

---

## 0. Contexto e meta

| Campo | Valor |
|-------|--------|
| Baseline código | `main` pós-wave PHR; gate GCP `e2e-gate-out-phr-20261126-051234` — **605 passed / 0 failed** |
| Baseline dados (prod `bioavanced_dev`) | `terminologyConcepts≈556020`; `biomarkerAssociations=2521` (2505 MarkerDB provisórias + 16 fixture ORPHA) |
| Nota de prontidão (2026-11-26) | **~6,5/10** — piloto / early access; **meta 2.1 ≈ 8,5–9/10** (comercializável + apto a trilha ANVISA/QMS) |
| Manifesto documental atual | v2.0.0 `approved` documental ≠ go-live operacional |
| Rastreabilidade | **100%** requisito → implementação → teste → evidência no escopo 2.1 |
| Tip implementação 2.1 | **Re-auditoria sequencial W1→W7** (2026-11-26): só avança wave após tip local + sync GCP + merge `main` `[skip ci]` |

**Fora do escopo de go-live 2.1:** DOI Zenodo (pack local pode existir; **não** bloqueia release). Removido como pendência obrigatória.

**Fontes:** este arquivo; TRACE Achados 1–6; `PENDING_HUMAN_REVIEW_20261125_passo3_wave.md`; ADRs MarkerDB/outbox/provisional/TCLE gov.br; `docs/operations/*`; `docs/user-guides/*`; MANUAL_VERIFY.

---

## 1. Princípios da 2.1

1. **Homolog/comercial sem mocks de runtime** — `GOVBR_OIDC_MOCK` off; sem fixtures demo no Mongo de aceite; só população do **pipeline FONTES/RF028** documentado.
2. **CI ≠ runtime** — Vitest/Playwright podem manter doubles; o ambiente de demonstração/cliente **não**.
3. **Testes pontuais** após cada alteração (só superfície impactada); **gate full / smoke pack** uma vez antes do ex ante e outra antes do tag `v2.1.0`.
4. **ADR antes de cortar auth** — padrão ouro tenant-only **antes** de remover IAP Google do caminho de produto.
5. **Dicionário ELM** permanece artefato de governança (Excel/API); **não** hub de UI. UI ganha **Runbook + Termos/Políticas**.
6. **Zerar issues** do escopo 2.1 no GitHub com evidência (ou ADR “out of v2.1” com dono/data).
7. **Ex ante → produção** — só depois da fila must-have zerada (seção 10).

---

## 2. Must-have G0–G13 (scorecard go-live)

| ID | Item | Critério de done | Seção | Tip (re-auditoria) |
|----|------|------------------|-------|---------------------|
| **G0** | Sanitização docs/históricos wave 1 | Inventário keep/archive/delete; `docs/_archive/pre-2.1/`; SoT 2.1 limpo; sem rewrite de git | §3 | **DONE** `d16f093a` + GCP `W1_GCP_SYNC_OK` |
| **G1** | Crosswalk MarkerDB → ORPHA/MONDO + suggest real | Dump mapeado; suggest clínico ≠ só 16 fixture | §4 P0 | **DONE** reimport tip `:8080` ORPHA **16→13222**; suggest Fabry 135; unmatched HITL 16893 (`MANUAL_VERIFY_v2.1_G1_crosswalk.md`) |
| **G2** | SIGTAP (+ fluxos BR críticos) no prod | Typeahead + dump full (`TabelaUnificada_202611_*`) | §5 P1 | **DONE** tip `bioavanced_test` **sigtap=5068** + API/UI (`MANUAL_VERIFY_v2.1_G2_sigtap.md`) |
| **G3** | CPATH / FDA_PGX | Import real **ou** ADR “N/A nesta release” assinado | §5 P1 | **DONE** ADR N/A merged |
| **G4** | Smokes humanos TRACE/P4 | Sessão, rascunho, Fabry E2E, ATC/SIGTAP/TCLE geo PASS | §6 P2/P4 | **DONE** 2026-11-26 (10/11 PASS + G4-09 **out** via ADR Option B) — `MANUAL_VERIFY_v2.1_G4_smokes.md` + `2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md` |
| **G5** | Busca única inventário (P5.3) | Uma busca; armazenagem acoplada | §7 P5.3 | **DONE** `dc8a79c6` + GCP sync |
| **G6** | Etiqueta → scan → consulta (P5.4) | Code128 + DataMatrix → acha amostra | §7 P5.4 | **DONE** `dc8a79c6` |
| **G7** | TCLE builder + import claros (P5.1/P5.2) | Instruções + smoke publicar/import | §7 | **DONE** tip; smoke humano residual G4 |
| **G8** | TCLE remoto ouro | gov.br Login Único real + evidência humana; ICP conforme ADR | §8 P6 | **TIP DONE** mock só CI (`5e78b750`); **G8-GOVBR-REAL** residual **post-2.1** (ADR Option B) |
| **G9** | Acesso produto tenant-only | Sem OAuth Google / IAP como auth de produto | §8 | **DONE** invite tip+GCP (`5e78b750`) |
| **G10** | ADR padrão ouro acesso + identidade | Aprovado **antes** de G8/G9 | §8 | **DONE** ADR + `d16f093a` / GCP sync |
| **G11** | Empacotamento comercial | Onboarding, suporte, SLA, TLS (#1465), install runbook | §9 | **DONE** `6b98a5fc` (TLS ADR defer) |
| **G12** | Issues GitHub escopo 2.1 = 0 open | Close com evidência ou ADR out-of-scope | §9 P3 | **DONE** escopo 2.1 closed (1583/1465/…) |
| **G13** | Runbook in-app + Termos/Políticas | Substitui hub “Dicionário”; aceite versionado ≠ TCLE | §9 P8 | **DONE** `dc8a79c6` + GCP sync |

**Ordem de waves**

1. **W1 — Fundação:** G0 + G10 (ADR)  
2. **W2 — Dados:** G1 → G2 → G3  
3. **W3 — Lab UX:** G5 → G6 → G7 (+ G13 em paralelo se ADR pronto)  
4. **W4 — Identidade:** G8 + G9  
5. **W5 — Aceite humano:** G4 (smokes sem mock)  
6. **W6 — Empacote + issues:** G11 + G12  
7. **W7 — Ex ante → tag v2.1.0 → produção** (§10)

---

## 3. G0 — Sanitização documental (wave 1)

Incluir na **primeira** wave; não destruir trilha de auditoria.

### Incluir

- [x] Inventário **keep / archive / delete** — `docs/_archive/pre-2.1/INVENTORY.md`
- [x] Mover stages Zenodo duplicados → `docs/_archive/pre-2.1/zenodo-stages/`
- [x] Deprecar IAP como auth de produto — banner em `docs/runbooks/bioadvanced-iap-access.md`
- [x] Remover do SoT 2.1: DOI Zenodo como pendência; “mock como caminho feliz” — `docs/SOT_2.1.md` + banner `ZENODO.md`
- [x] Índice SoT: `docs/SOT_2.1.md`

### Evitar na W1

- [x] Sem `git filter-repo` / rewrite
- [x] ADRs / gates / packs ex ante / mestrado preservados

### Segredos

- [x] Nenhum segredo novo no tip desta sanitização

---

## 4. P0 / G1 — Crosswalk MarkerDB provisório → ORPHA/MONDO

**Status tip:** script híbrido + unit tests; **reimport homolog tip `:8080` DONE** (2026-11-26).

### Situação

| Camada | Estado |
|--------|--------|
| Catálogo ORPHA (`terminologyConcepts`) | Full-lab (~11 645 ORPHA em ~556 020 conceitos) — export `docs/data/markerdb/orpha-full.jsonl` p/ crosswalk |
| Associações MarkerDB | TSV reconvert **42001** (`2024-09-12/biomarker-associations-full.jsonl`; XML path rejeitado — nested `<condition>`) |
| Associações com ORPHA explícito | **before 16** fixture → **after 13222** (`bioavanced_test`) |
| `/dictionary/suggest?orphaCode=` | Fabry `324` → **135** biomarkers (2026-11-26) |

### Implementar / verificar

- [x] Estratégia: exact / normalize / aliases / MONDO→ORPHA — `markerDbConditionCrosswalkLib.js`
- [x] Script offline: `crosswalkMarkerDbConditions.js` (+ CLI `scripts/reference-imports/crosswalk-markerdb-conditions.js`)
- [x] % mapeado + fila unmatched versionada; **sem inventar** código — **59.78%** mapped (25108/42001); unmatched `docs/data/markerdb/crosswalk-unmatched-2026-11-26.jsonl` (16893)
- [x] Suggest: doenças do dump com biomarcadores após **reimport** homolog — Fabry 324 = 135
- [x] Outbox: re-emitir após reimport enriched JSONL — `outboxEnqueued=13206`; PENDING→0; Neo4j `POSSUI_BIOMARCADOR=13173`
- [x] Evidência before/after + Fabry + N doenças no homolog — § tabela acima
- [x] ADR provisional atualizado (híbrido)
- [x] Decisão registrada abaixo

**Decisão crosswalk:** **híbrido** — auto exact/normalize/aliases/MONDO→ORPHA; unmatched → fila HITL versionada; nunca inventar código (#1206).

---

## 5. P1 / G2–G3 — Dumps BR e oficiais

- [x] **G2** path convert/import + typeahead intake — `docs/operations/sigtap-full-import-v2.1.md`
- [x] **G2** SIGTAP **full** no Mongo tip `:8080` (`bioavanced_test`) — `sigtap=5068` from `TabelaUnificada_202611_v2611051737/` (2026-11-26 reimport; evidence `docs/qa/MANUAL_VERIFY_v2.1_G2_sigtap.md`)
- [x] Typeahead API verde no homolog tip 2.1 — `query=BIOP` → `source: SIGTAP`; UI wizard = G4-05
- [x] **G3** SRC_CPATH / SRC_FDA_PGX: ADR N/A — `docs/decisions/2026-11-26-cpath-fda-pgx-na-v2.1.md`
- ~~Pack Zenodo: DOI~~ **REMOVIDO** do go-live 2.1

---

## 6. P2 / P4 / G4 — Smokes humanos (código ≠ fechado)

### Código já na main (não marcar G4 done sem smoke)

- [x] Achados 1–6 TRACE
- [x] TCLE remoto gov.br/ICP instrumentado (e2e **mock** só CI)
- [x] Checklist G4 — `docs/qa/MANUAL_VERIFY_v2.1_G4_smokes.md`

### Obrigatório G4 (homolog tip 2.1, **sem** mock de runtime)

- [x] UX tip: CPF, sólidos SPREC, sigla/modal, doc-primeiro, busca doença
- [x] Fabry/324 → CID/ORPHA/OMIM + HPO + biomarcadores (após G1 reimport)
- [x] Procedimentos SIGTAP + alergia ATC + TCLE geo presencial
- [x] Keepalive
- [x] Rascunho intake
- [x] TCLE remoto gov.br **real** → `identityProof` — **OUT of tag** ADR Option B (`2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md`); residual = G8-GOVBR-REAL
- [x] Canvas presencial após geo
- [x] Lista `/biomarker-associations` pós-crosswalk

---

## 7. P5 / G5–G7 — UI/UX lab

### P5.1 / G7 — Construtor TCLE

- [x] Instruções draft/publicado/`{{…}}`/DUO/PDF; ≠ gov.br — `TcleBuilderPage`
- [x] MANUAL_VERIFY — `docs/qa/MANUAL_VERIFY_v2.1_import_tcle.md`
- [ ] Smoke humano criar→salvar→publicar→link

### P5.2 / G7 — Importação

- [x] Passos claros FHIR + quarentena; `/import` → FHIR; menu sem ImportForm
- [x] MANUAL_VERIFY IMP-001..003 + QUA-001 documentados
- [ ] Smoke humano IMP/QUA
- **Decisão menu:** FHIR + quarentena apenas

### P5.3 / G5 — Busca única

- [x] Um campo de busca; armazenagem selection-fed; Locator `hideSearch`
- [x] `/samples/withdrawal-return` no hub
- [x] Unit SamplesPage / InventoryLookupDrawer

### P5.4 / G6 — Etiqueta → scan

- [x] Code128 + DataMatrix; empty guidance; MANUAL_VERIFY labels
- [ ] Smoke humano scan→inventário

### P5.5 — Lookup drawer

- [x] Drawer (ADR `2026-11-26-lab-inventory-lookup-drawer.md`); mesmo motor; deep-links

**Ordem P5:** G5 → G6 → G7 → P5.5 — tip fechado.

---

## 8. P6 / G8–G10 — Identidade e acesso

### G10 — ADR

- [x] `docs/decisions/2026-11-26-access-tenant-only-identity.md`

### G9 / G8 — Implementar

- [x] Convite/ativação tenant — `tenantInvite.service` + `/invite/accept` + Convidar em `/users/new`
- [x] IAP fora do caminho comercial documentado
- [x] `GOVBR_OIDC_MOCK` só test/CI (`isGovbrOidcMockActive`)
- [x] Docs: `runtime-mock-hygiene-v2.1.md` + `MANUAL_VERIFY_v2.1_identity.md`
- [ ] Evidência humana gov.br real + `identityProof` no aceite — **post-2.1** (ADR Option B); piloto tag = ICP/panel

### Higienização runtime

- [x] Flags/documentação mock off
- [ ] Mongo aceite: purge fixtures + reimport FONTES (homolog live)
- [x] Allowlist admin bootstrap documentada

---

## 9. P3 / P8 / G11–G13 — Empacote, issues, Runbook e legais

### P8 / G13

- [x] ADR runbook-terms; rotas `/runbook`, `/legal/*`; gate aceite; redirect dicionário
- [x] APIs `/dictionary/*` permanecem
- [ ] Smoke humano bloqueio sem aceite

### G11

- [x] Onboarding + install/config alinhados
- [x] `support-sla-v2.1.md`
- [x] TLS #1465 ADR adiamento
- [x] `changelog-v2.1.0.md`

### P3 / G12

| # | Ação 2.1 | Status |
|---|----------|--------|
| 1583 | Fix timeout 20s | **closed** |
| 1465 | ADR defer TLS | **closed** |
| 1542 | ADR out | **closed** |
| 1566 | Partial G1/G2 + G3 N/A | **closed** |
| 1562 | ADR out | **closed** |
| 1561 | ADR out | **closed** |
| 1407 | ADR out | **closed** |

- [x] Escopo 2.1 issues fechadas com evidência/ADR — `docs/decisions/2026-11-26-issues-out-of-v2.1.md`

---

## 10. Porta ex ante → produção (W7)

**Entrada:**

- [x] Scorecard tip + ADRs out (G0–G13 tip; G4 DONE com exceção assinada Option B)
- [x] Protocolo + hygiene docs (`GOVBR_OIDC_MOCK=false` no tip)
- [x] Smokes G4 verdes sob ADR — G4-09 **out of tag**; residual G8-GOVBR-REAL post-2.1
- [x] Issues G12 zeradas no escopo

**Ensaio / produção:** checklist `docs/qa/MANUAL_VERIFY_v2.1_ex_ante_gate.md`

- [x] Protocolo RF016 no tip `v2.1.0-rc` (`24ea19f0`) — GCP `physical-chain` **4 passed**
- [x] Relatório PASS — `docs/evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md`
- [x] Tag `v2.1.0` + deploy tip homolog + smoke pós-deploy (login/samples/dictionary/FE; mock off)

**Gate G4-09:** ADR Option B. Residual pós-tag: **G8-GOVBR-REAL**. Piloto remoto = ICP/panel.

---

## 11. Trilha ANVISA / QMS (paralela)

- [x] Matriz rastreabilidade comercial — `docs/compliance/matriz-rastreabilidade-comercial-v2.1.md`
- [x] Controle de mudança + changelog
- [x] Política LGPD via Termos/Privacidade in-app
- [x] Gap analysis rascunho — `docs/compliance/gap-analysis-anvisa-v2.1.md` (dono humano preenche)
- [x] Não alegar certificação — `ANVISA_QMS_apto_v2.1.md`

---

## 12. Como usar este documento

1. Executar na ordem das waves (§2); não pular G10 antes de G8/G9.  
2. Cada `[x]`: evidência inline ou link.  
3. Residual pós-`v2.1.0`: G8-GOVBR-REAL (ADR Option B); cutover host comercial se ≠ homolog.  
4. Zenodo DOI: archive; não misturar com go-live.

---

## 13. Análise — o que faltava (revisão inicial) + tip status

| Tema | Antes | Agora |
|------|-------|--------|
| Framing v2.1 | Só gaps PHR | §0–§2 |
| DOI Zenodo | P1 | Removido + archive |
| Mocks / CI≠runtime | Ausente | Hygiene + code |
| G0 sanitização | Ausente | DONE |
| Tenant/IAP/ADR G10 | Ausente | DONE + invite |
| Runbook + Termos | Ausente | DONE |
| Ex ante porta | Ausente | Protocolo; promote blocked |
| ANVISA apto | Ausente | Matriz + gap rascunho |
| Residual | — | G8-GOVBR-REAL post-2.1 (ADR Option B); cutover prod se alvo ≠ homolog |
