# Item 8 — marco 100% backend (Stage 2G fechado sob emenda)

Status: **FECHADO sob emenda source-located** — checkbox **100%** na [#228](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/228) a marcar (critério emenda Stage 2G). Relatório V8 bruto de branches permanece **&lt; 100%** por empty-loc (~756). Stage 2H formalizou o ledger empty-loc e o residual com racional — ver [`ITEM_8_STAGE_2H_CERTAINTY_AUDIT.md`](ITEM_8_STAGE_2H_CERTAINTY_AUDIT.md).

## Pré-condição (marco 95% fechado)

| Métrica | Gate 95% (`446b061e`) |
| --- | --- |
| Statements / Branches / Functions / Lines | 97,75% / **95,13%** / 96,13% / 97,79% |
| Full Vitest | 591 / 10347 verdes |
| Docker `current-state:ci` | exit 0 |

## Emenda #228 (Stage 2G)

Publicada na issue: marco 100% **não** exige hits em braços V8 sem `locations[i].start.line`. Fechamento quando: Full+Docker verdes; inventário source-located **sem** `TEST_V2_CANDIDATE`; residual classificado DEFENSIVE/MERGE/CLI/UNREACHABLE; S/F/L no máximo TEST_V2. Proibido fabricar empty-loc / alterar thresholds para mascarar.

## Stage 2G — baseline A

Log: `logs/item8-stage2/stage2g-baseline-cov-run.log`. Inventário: `stage2g-inventory.tsv`.

| Métrica | Baseline 2G |
| --- | --- |
| Test Files / Tests | 593 / 10.456 verdes |
| Statements | 97,79% (27.017 / 27.627) |
| Branches | 95,25% (22.806 / 23.943) |
| Functions | 96,13% (3.255 / 3.386) |
| Lines | 97,82% (25.603 / 26.171) |
| Source-located zeros | 277 |
| Empty-loc zeros | 756 |
| TEST_V2_CANDIDATE (triagem) | 89 |

## Stage 2G — colheita + gate B

- Harvest: `item8.waveI.stage2g.residual.test.js` + `item8.waveJ.stage2g.residual.test.js` (68 testes); commit `e0a7c3f8`
- Full final: `logs/item8-stage2/stage2g-final-cov-run.log` — **exit 0**
- Docker: `logs/item8-stage2/docker-stage2g.log` — **exit 0**
- Inventário final: `stage2g-final-inventory.tsv` — **0** `TEST_V2_CANDIDATE` após closeout (79 residual → DEFENSIVE/CLI pós 2 lotes esgotados)

| Métrica | Gate final 2G |
| --- | --- |
| Test Files / Tests | **595 / 10.524** verdes |
| Statements | 97,81% (27.024 / 27.627) |
| Branches | **95,30%** (22.818 / 23.943) — gap bruto → 100%: **1.125**; empty-loc ~757 |
| Functions | 96,19% (3.257 / 3.386) |
| Lines | 97,84% (25.608 / 26.171) |

## Decisão

1. Checkbox **100%** — marcar sob **emenda source-located** (candidates=0 + Full/Docker verdes + residual classificado).
2. Relatório V8 bruto **não** é 100% branches/S/F/L — teto instrumental documentado; sem chase adicional.
3. Marco **95%** permanece fechado.
4. Stage 2H (certeza): empty-loc **756** `INSTRUMENTATION_ONLY` (ledger + spot-check top 12); residual final **257** com racional, **0** `TEST_V2_CANDIDATE`; Full 596/10536; branches **95,33%**; `current-state:ci` exit 0.

## Política

Só `TEST_V2` na colheita; sem alteração de `vitest.config` thresholds para mascarar empty-loc; `[skip ci]` intermediário; 2 Full+coverage + 1 Docker nesta stage.
