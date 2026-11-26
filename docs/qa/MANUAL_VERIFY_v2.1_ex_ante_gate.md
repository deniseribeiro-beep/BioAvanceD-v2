# Porta ex ante → produção (W7)

## Entrada (obrigatório)

- [ ] Scorecard G0–G13 complete or ADR out signed ([PENDING](../execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md))
- [ ] Aceite sem mocks (`runtime-mock-hygiene-v2.1.md`)
- [ ] G4 smokes PASS ([MANUAL_VERIFY_v2.1_G4_smokes.md](MANUAL_VERIFY_v2.1_G4_smokes.md))
- [ ] G12 issues escopo 2.1 = 0 open / lista out assinada ([2026-11-26-issues-out-of-v2.1.md](../decisions/2026-11-26-issues-out-of-v2.1.md))

## Ensaio RF016

- Protocolo: [RF016-ex-ante-sintetico-v1.0.0.md](../evidencias/homologacao-runtime/RF016-ex-ante-sintetico-v1.0.0.md)
- Tip candidato: `v2.1.0-rc` (commit SHA: ________)
- Relatório: PASS / FAIL — path: ________
- Falha → item volta ao PENDING; **não** promove prod

## Produção

- [ ] Tag `v2.1.0` + [changelog-v2.1.0.md](../operations/changelog-v2.1.0.md)
- [ ] Deploy per install/configuration runbooks
- [ ] Smoke pós-deploy: login tenant, intake, inventário, uma etiqueta

## Status tip (2026-11-26 residual)

Homolog tip `:8080` **live**; G1/G2 closed; G4 **10/11 PASS** — **G4-09 BLOCKED** (faltam `GOVBR_OIDC_*` staging/real).  
**Não** taguear `v2.1.0` nem ensaiar RF016 promote até G4-09 PASS.
