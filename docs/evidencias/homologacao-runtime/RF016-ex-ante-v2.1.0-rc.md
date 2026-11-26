# RF016 / RULE-037 — Ensaio ex ante sintético tip `v2.1.0-rc`

| Campo | Valor |
|---|---|
| Protocolo | `BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0` |
| Data de execução | 2026-11-26 |
| Tip candidato | `v2.1.0-rc` @ `24ea19f0` (`docs(v2.1): ADR Option B — G4-09 out of tag gate`) |
| Ambiente | GCP `instance-20261029-155615` + `compose.test.yml` (stack tip 2.1 live) |
| Instrumento | `tests/e2e/physical-chain.spec.ts` via `playwright-runner` (`rf016-v210`) |
| Espécimes reais | **Proibidos** (VAL-027); fixtures `BVA2:synthetic:*` only |
| Resultado | **PASS** |
| Log | [RF016-ex-ante-v2.1.0-rc.e2e.txt](RF016-ex-ante-v2.1.0-rc.e2e.txt) (+ host GCP `e2e-gate-out-rf016-v210/`) |

## Escopo

Reexecução operacional do protocolo ex ante no tip comercial 2.1, sem material biológico, sobre o contrato `/api/physical-chain` e seed de custódia sintético.

## Resultado Playwright

```
Running 4 tests using 1 worker
✓ custody bounds / approval out of force (9.4s)
✓ empty tube placed and labelled (3.8s)
✓ ex ante protocol only once approved_for_execution (RF016 AC7, RULE-037) (2.0s)
✓ disposition compatibility (#1363, RF026 AC6) (1.5s)
4 passed (20.1s)
```

Exit code container `rf016-v210`: **0**

## Mapeamento IDF (inalterado vs v1.0.0 sintético)

Cobertura IDF-001…010 via o mesmo spec; ver [`RF016-ex-ante-sintetico-v1.0.0.md`](RF016-ex-ante-sintetico-v1.0.0.md).

## Declaração

Execução sintética **não** homologa laboratório clínico com material real. Fecha o ensaio W7 tip `v2.1.0-rc` para liberar tag `v2.1.0` sob scorecard G0–G13 + ADR Option B (G4-09 residual pós-tag).
