# Item 8 — kickoff marco 100% backend

Status: **aberto após fechamento do marco 95%** (Stage 2E-4).

## Pré-condição

Marco **95%** fechado na issue [#228](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/228):

| Métrica | Gate 95% (HEAD `446b061e`) |
| --- | --- |
| Statements | 97,75% |
| Branches | 95,13% |
| Functions | 96,13% |
| Lines | 97,79% |
| Full Vitest | 591 / 10347 verdes |
| Docker `current-state:ci` | exit 0 |

## Inventário inicial do 100%

Fonte: [`logs/item8-stage2/stage2e4-gate-inventory.tsv`](../../logs/item8-stage2/stage2e4-gate-inventory.tsv)

- Source-located zero-hit: **304** braços / **108** arquivos
- Locations V8 vazias (não fila TEST_V2): **757**

Concentração residual (muitos já classificados DEFENSIVE/MERGE no Stage 2B–2E):

1. `orphanet.js`, `SampleGraphValidator.js`
2. `terminologies.routes.js`, `batch-validation-engine.service.js`
3. `fhir-import-staging.service.js`, `intakeWizard.js`, `sample.service.js`
4. `backup.service.js`, `equipment-sensor-quarantine.service.js`
5. `mongo.js`, `terminologySync.service.js`, `redis.js`
6. `createLinkedFileController.js`, `daily-merkle.job.js`, `storage.routes.js`, `user.routes.js`

## Política proposta para o marco 100%

1. Continuar **só** `TEST_V2` legítimo (sem fabricar estado impossível).
2. Para cada residual DEFENSIVE/MERGE/UNREACHABLE: documentar no inventário com evidência (teste isolado vs merge global, contrato interno).
3. Se após esgotar TEST_V2 o numerador V8 global ainda for &lt; 100%: registrar bloqueio `BLOCKED_BY_COVERAGE_INSTRUMENTATION` / contrato e decidir com o time se a issue #228 aceita exclusão explícita documentada (não “skip” oportunista).
4. Protocolo operacional: lotes + `[skip ci]` + Full Vitest local + Docker `current-state:ci` antes de reconciliar na #228.

## Próximo passo de execução

Abrir Stage **2F / Item 8-100** com:

1. Remedir Full+coverage no HEAD pós–wave G (`4ed47b0d`+) e regenerar inventário.
2. Classificar os 304 zeros (não chase cego dos tops DEFENSIVE).
3. Lotes TEST_V2 nos arquivos ainda com yield real.
4. Reconcile na #228 ao atingir 100% nas quatro métricas **ou** ao fechar a política de braços instrumentais.
