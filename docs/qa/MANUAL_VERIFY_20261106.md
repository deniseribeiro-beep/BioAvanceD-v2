# MANUAL_VERIFY — live pass 2026-11-06

Homolog em `0274b0f6` (`feature/homolog-consent-mail-directory`), proxy `:8080`, login `admin`.

## Passes desta sessão

| ID | Resultado | Nota |
|---|---|---|
| ROUTE-MAP | PASS | ~40 rotas de ouro abertas: um `h1` por tela autenticada, sem layout colapsado. |
| SAMPLES-GRID | PASS | `/samples` mostra a grade 9×9; poço ocupado com `data-tooltip` = código da amostra. |
| EMAIL-LOGIN | PASS | O login aceita o e-mail da conta `admin` (mapeamento `username \|\| email` em `auth.routes.js`). A caixa `e2e-admin@bioavanced.test` não é o e-mail gravado nesse usuário. |
| TABLE-ACTIONS | PASS após fix | Ações do inventário passaram a `.table-actions` em linha. |
| BOX-LABEL | PASS após fix | Seletor da grade usa o último segmento do `path` quando `boxName` falta. |

## TCLE gov.br / ICP (wave PHR)

| ID | Resultado | Nota |
|---|---|---|
| TCLE-GOVBR-01 | INSTRUMENTED | Flag `CONSENT_GOVBR_OIDC_ENABLED`; rotas `/api/e-consent/govbr/{status,start,callback}`; botão na `ConsentTokenPage` |
| TCLE-GEO-ACCEPT | INSTRUMENTED | Aceite remoto envia `location` (`readPanelLocation`) + `identityProof` na evidência |
| TCLE-ICP-01 | INSTRUMENTED | `icpBrasil.service` + evidência `identityProvider: icp-brasil` quando proof no accept; flag `CONSENT_ICP_BRASIL_ENABLED` |
| TCLE-MANUAL | INSTRUMENTED | `compose.test.yml` liga `CONSENT_GOVBR_OIDC_ENABLED` + `GOVBR_OIDC_MOCK`; e2e `tcle-govbr-icp.spec.ts` cobre status/start/callback. Manual residual: abrir link do participante na UI e conferir `identityProof` na evidence JSON |

## Skips

| ID | Rota / UI | Por que skip | O que verificar manualmente | Critério de ok |
|---|---|---|---|---|
| BIO-001 | `/biomarker-associations` | **PASS** (2026-11-26) | MarkerDB full JSONL (2505) importado em produção GCP (`bioavanced_dev`) + 2521 no stack test; lista/paginação; suggest Mongo com `orphaCode` do dump; fixture 16 permanece só como sample de smoke |
| SKIP-002 | `/samples/:id`, `/logs/:id`, `/reports/:id`, `/admin/tcle/edit/:id` | Precisam de id real; smoke de ouro usa `demo-id` | Abrir um id existente da lista | Página carrega sem layout colapsado |
| SKIP-003 | `/next/intake` | Wizard foundation sem `h1` de página shell | Percorrer os passos do intake | Conteúdo do wizard visível |
| SKIP-004 | Gate e2e completo (`scripts/e2e-gate.sh`) | Fora do escopo deste passe | Rodar o gate no CI ou na VM com disco livre | Gate verde |
| SKIP-005 | `/samples/withdrawal-return` no menu | Rota existe e abre; item de menu lateral ainda ausente (decisão 27/10) | Confirmar se o produto quer o item no sidebar | Decisão registrada ou item no menu |
