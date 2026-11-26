# Porta ex ante → produção (W7)

## Entrada (obrigatório)

- [x] Scorecard G0–G13 complete or ADR out signed ([PENDING](../execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md)) — G4 DONE com ADR Option B
- [x] Aceite sem mocks (`runtime-mock-hygiene-v2.1.md`) — tip `GOVBR_OIDC_MOCK=false`
- [x] G4 smokes PASS sob exceção ([MANUAL_VERIFY_v2.1_G4_smokes.md](MANUAL_VERIFY_v2.1_G4_smokes.md) + [ADR G4-09 out](../decisions/2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md))
- [x] G12 issues escopo 2.1 = 0 open / lista out assinada ([2026-11-26-issues-out-of-v2.1.md](../decisions/2026-11-26-issues-out-of-v2.1.md))

## Ensaio RF016

- Protocolo: [RF016-ex-ante-sintetico-v1.0.0.md](../evidencias/homologacao-runtime/RF016-ex-ante-sintetico-v1.0.0.md)
- Tip candidato: `v2.1.0-rc` (commit SHA: `24ea19f0`)
- Relatório: **PASS** — [RF016-ex-ante-v2.1.0-rc.md](../evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md)
- Log GCP: `e2e-gate-out-rf016-v210/e2e.txt` — **4 passed** (`physical-chain.spec.ts`)
- Falha → item volta ao PENDING; **não** promove prod

## Produção

- [x] Tag `v2.1.0` + [changelog-v2.1.0.md](../operations/changelog-v2.1.0.md)
- [x] Deploy tip homolog GCP (`instance-20261029-155615` compose.test + access-proxy `:8080`) — tip live; docs Option B pushed `main`
- [x] Smoke pós-deploy tip: login admin **200**, `GET /api/samples` **200**, `GET /api/dictionary/search?query=324` **200**, FE `/samples` `/clinical-intake` `/labels` **200**, `GOVBR_OIDC_MOCK=false`; etiqueta/cadeia física coberta pelo RF016 PASS

## Status (2026-11-26 W7)

**W7 tip fechado:** RF016 PASS → tag `v2.1.0`. Domínio: `https://www.bioadvanced.dev` (IAP off). Residual: **G8-GOVBR-REAL** (ADR Option B). Auditoria: `RELEASE_AUDIT_v2.1.0.md`.
