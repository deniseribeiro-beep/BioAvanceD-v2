# Separação CI / E2E / Lab — honestidade metodológica (DSR)

| Pipeline | Onde | Dados | O que afirma na tese |
|---|---|---|---|
| **CI Trilha A** | GitHub Actions (`ci-pipeline.yml`) | Fixtures essential / unit / arch | Contratos, guards, regressão contínua |
| **e2e-gate** | `scripts/e2e-gate.sh` + `compose.test.yml` | N≈1–2 por jornada; Mongo **com** `--replSet rs0` | Jornadas UI/API reais; a11y onde coberto |
| **Lab GCP F3** | VM + BLPP | N=100 / N=1000 | População operacional sintética em escala |

## Pontos obrigatórios no texto da tese

1. E2E **não** carrega o corpus de 1000 — volume e tempo inviáveis no gate.  
2. Lab compose.dev estava **sem** replica set; o e2e-gate **tem** replica set — logo a prova RF006 transacional vive no gate/teste, enquanto o corpus lab usou `lab-direct` (declarar).  
3. BLPP pode gerar 1–2 linhas de fixture a partir do mesmo schema sem misturar corpora.

## O que NÃO se afirma

- Que o CI “validou 1000 participantes”.  
- Que lab-direct ≡ createSample RF006.  
- Que prevalência clínica foi validada.
