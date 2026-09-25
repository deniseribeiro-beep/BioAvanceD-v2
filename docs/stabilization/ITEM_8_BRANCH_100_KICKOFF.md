# Item 8 — marco 100% backend (Stage 2F)

Status: **`BLOCKED_BY_COVERAGE_INSTRUMENTATION`** — checkbox **100%** na [#228](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/228) **não** marcado.

## Pré-condição (marco 95% fechado)

| Métrica | Gate 95% (`446b061e`) |
| --- | --- |
| Statements / Branches / Functions / Lines | 97,75% / **95,13%** / 96,13% / 97,79% |
| Full Vitest | 591 / 10347 verdes |
| Docker `current-state:ci` | exit 0 |

## Stage 2F — baseline A

HEAD de medição: pós–wave G + timeouts. Log: `logs/item8-stage2/stage2f-baseline-cov-run.log`. Inventário: `stage2f-inventory.tsv`.

| Métrica | Baseline 2F |
| --- | --- |
| Statements | 97,77% (27.013 / 27.627) |
| Branches | 95,18% (22.790 / 23.943) |
| Functions | 96,13% (3.255 / 3.386) |
| Lines | 97,81% (25.600 / 26.171) |
| Source-located zeros | 293 / 101 arquivos |
| Empty-location zeros (V8) | **757** |
| Gap branches → 100% | **1.153** |

Triagem bulk (`triage-stage2f-inventory.js`): DEFENSIVE 160 · CLI 18 · MERGE 10 · **TEST_V2_CANDIDATE 105** (`stage2f-test-v2-candidates.tsv`).

## Stage 2F — colheita + gate B

- Harvest: `tests/unit/item8.waveH.stage2f.residual.test.js` (59 TEST_V2); timeouts de carga em auth-rate-limiter / wave G.
- Commit harvest: `d9c10790`.
- Full Vitest+coverage B: `logs/item8-stage2/stage2f-final-cov-run.log` — **exit 0**.

| Métrica | Gate final 2F |
| --- | --- |
| Test Files / Tests | 593 / 10.456 verdes |
| Statements | 97,79% (27.017 / 27.627) |
| Branches | **95,25%** (22.806 / 23.943) |
| Functions | 96,13% (3.255 / 3.386) |
| Lines | 97,82% (25.603 / 26.171) |
| Gap branches → 100% | **1.137** |

Docker: `logs/item8-stage2/docker-stage2f.log` (`current-state:ci`).

## Por que 100% branches é bloqueado

Mesmo cobrindo **todos** os source-located zeros restantes (~280 após harvest), o denominador V8 ainda inclui **~757** braços com `locations[i]` vazio (implicit else / instrumentação). Item 8 **proíbe** fabricar estados só para o contador. Teto realista de branches com a config atual ≪ 100%.

## Decisão

1. **Não** marcar checkbox **100%** na #228.
2. Status Stage 2F: `BLOCKED_BY_COVERAGE_INSTRUMENTATION`.
3. Próximo passo **humano** (fora desta stage de testes): emenda na #228 (carve-out documentado de empty-loc / DEFENSIVE) **ou** ajuste de provedor/config de coverage — depois reabrir colheita se o denominador mudar.

## Política mantida

Só `TEST_V2`; inventário classificado; `[skip ci]` intermediário; no máximo 2 Full+coverage + 1 Docker nesta stage.

---

## Stage 2G — desbloqueio normativo + colheita source-located

**Emenda #228** publicada (comentário Stage 2G): marco 100% fecha quando inventário source-located não tem `TEST_V2_CANDIDATE` pendente + Full/Docker verdes + residual classificado; empty-loc V8 não exige hit. Aprovação operacional = execução deste plano pelo maintainer.

Status: **em execução**.
