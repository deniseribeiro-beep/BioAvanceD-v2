# Porta ex ante → produção (W7)

## Entrada (obrigatório)

- [x] Scorecard G0–G13 complete or ADR out signed ([PENDING](../execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md)) — G4 DONE com ADR Option B
- [x] Aceite sem mocks (`runtime-mock-hygiene-v2.1.md`) — tip `GOVBR_OIDC_MOCK=false`
- [x] G4 smokes PASS sob exceção ([MANUAL_VERIFY_v2.1_G4_smokes.md](MANUAL_VERIFY_v2.1_G4_smokes.md) + [ADR G4-09 out](../decisions/2026-11-26-g4-09-govbr-real-out-of-v2.1-tag.md))
- [x] G12 issues escopo 2.1 = 0 open / lista out assinada ([2026-11-26-issues-out-of-v2.1.md](../decisions/2026-11-26-issues-out-of-v2.1.md))

## Ensaio RF016

- Protocolo: [RF016-ex-ante-sintetico-v1.0.0.md](../evidencias/homologacao-runtime/RF016-ex-ante-sintetico-v1.0.0.md)
- Tip candidato: `v2.1.0-rc` (commit SHA: ________)
- Relatório: PASS / FAIL — path: ________
- Falha → item volta ao PENDING; **não** promove prod

## Produção

- [ ] Tag `v2.1.0` + [changelog-v2.1.0.md](../operations/changelog-v2.1.0.md)
- [ ] Deploy per install/configuration runbooks
- [ ] Smoke pós-deploy: login tenant, intake, inventário, uma etiqueta

## Status tip (2026-11-26 Option B)

Homolog tip `:8080` **live**; G0–G13 tip closed (G4 com exceção assinada).  
G4-09 / G8-GOVBR-REAL = **residual post-2.1** — piloto remoto TCLE = ICP/panel até Login Único real.  
**Entrada W7 liberada** para ensaio RF016 → tag (não inventar `GOVBR_OIDC_*`).
