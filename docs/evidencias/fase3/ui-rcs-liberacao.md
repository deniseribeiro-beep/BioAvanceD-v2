# U2 — RCS + liberação/retirada/devolução (lab)

**Data:** 2026-11-02 (UTC)  
**Amostra:** barcode `BR-2026-10107` · specimenId `7238080` · `_id` `6ae7e84536322acf39af04a5`  
**Run:** `blpp-9002-10000-1793583172977` (applyMode **service**)  
**Qualidade BLPP:** GOOD / UI “Adequada / Boa Qualidade”

## Fluxo exercitado

| Passo | Ação | Resultado |
|---|---|---|
| 1 | Abrir `/samples/withdrawal-return` | OK (após correção de rota estática) |
| 2 | Buscar `BR-2026-10107` | Sample Data + histórico allocate/create |
| 3 | Retirada parcial 10 µL (disp. 16 µL) | Confirmado; disponível→6 µL; pendente devolução 10 µL |
| 4 | Devolução total 10 µL, condição Íntegra | Processado (ver captura 04d) |
| 5 | Detalhe `/samples/6ae7e84536322acf39af04a5` | Compliance graph ética/qualidade/clínica/integridade |

## Achados

- Liberação operacional = withdrawal/return com trilha de movimentação.
- RCS/governance na UI: campo Qualidade no painel Estado + `compliance-graph` no detalhe (releasable/blocked).
- Correção pré-requisito: `App.tsx` registrava `/samples/:id` antes das rotas estáticas.

## Figuras

`ui/04-withdrawal-return.png`, `04b-withdrawal-confirm.png`, `04c-withdrawal-done.png`, `04d-return-done.png`, `06-sample-detail-rcs.png`
