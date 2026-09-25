# Item 8 — Stage 2H Certainty Audit

Status: **FECHADO**. Auditoria de certeza pós-emenda source-located (Stage 2G). Não reabre o critério do marco 100%; formaliza empty-loc e elimina fechamento em lote dos residuals.

## Política

- Empty-loc: classificar `INSTRUMENTATION_ONLY` e **parar** — sem teste fantasma, sem `else` artificial, sem mascarar thresholds.
- Source-located: cada zero com `start.line` recebe classe + racional de uma frase.
- Classes: `DEFENSIVE_OR_INSTRUMENTATION` | `MERGE_ARTIFACT` | `CLI_UNREACHABLE` | `UNREACHABLE` | `TEST_V2_CANDIDATE` | `AMBIGUOUS`.
- WaveK só para candidatos reabertos na reauditoria; residual pós-gate reclassificado com racional (não closeout cego).

## Artefatos

| Artefato | Caminho |
| --- | --- |
| Coverage gate | `logs/item8-stage2/coverage-final-stage2h-final.json` |
| Full log | `logs/item8-stage2/stage2h-final-cov-run.log` |
| current-state:ci | `logs/item8-stage2/docker-stage2h.log` |
| Empty-loc ledger | `logs/item8-stage2/stage2h-empty-loc.tsv` |
| Empty-loc by file | `logs/item8-stage2/stage2h-empty-loc-by-file.tsv` |
| Empty-loc spot-check | `logs/item8-stage2/stage2h-empty-loc-spotcheck.json` |
| Residual (pré-waveK) | `logs/item8-stage2/stage2h-residual-inventory.tsv` |
| Residual final | `logs/item8-stage2/stage2h-final-inventory.tsv` |
| WaveK tests | `api/backend/tests/unit/item8.waveK.stage2h.residual.test.js` |

## Empty-loc (classificar e parar)

| Métrica | Valor |
| --- | --- |
| Empty-location zeros | **756** |
| Arquivos com empty-loc | 107 |
| Classificação | 100% `INSTRUMENTATION_ONLY` |
| Spot-check top 12 | `locations[i].start` vazio em todas as amostras (`top12AllEmptyStart: true`) |

Fila de produto para empty-loc: **vazia**. Contador V8 bruto permanece &lt; 100% por este denominador.

## Residuals source-located

### Pré-waveK (reauditoria)

Partiu de `stage2g-final-inventory.tsv` (267). Closeout-cego 2G (56 braços): reauditoria por fonte reabriu **19** `TEST_V2_CANDIDATE`; 7 desses foram reclassificados com racional (private/preempted/heavy) sem harvest; **12** colhidos na waveK.

### Gate final 2H

| Métrica | Valor |
| --- | --- |
| Source-located zeros | **257** |
| `DEFENSIVE_OR_INSTRUMENTATION` | 181 |
| `MERGE_ARTIFACT` | 44 |
| `CLI_UNREACHABLE` | 32 |
| `TEST_V2_CANDIDATE` | **0** |
| Linhas sem `rationale` | **0** |

## Gate numérico

| Métrica | Stage 2H final |
| --- | --- |
| Test Files / Tests | **596 / 10.536** verdes |
| Statements | 97,82% (27.025 / 27.627) |
| Branches | **95,33%** (22.826 / 23.943) |
| Functions | 96,19% (3.257 / 3.386) |
| Lines | 97,85% (25.609 / 26.171) |
| current-state:ci | exit 0 |

## Stop

1. Empty-loc ledger fechado — sem chase adicional.
2. Residual source-located com racional por braço; candidates = 0.
3. Relatório V8 bruto de branches **não** é 100% — teto instrumental documentado.
4. Marco 100% sob emenda source-located (2G) permanece válido; checkbox #228 é ação humana.
