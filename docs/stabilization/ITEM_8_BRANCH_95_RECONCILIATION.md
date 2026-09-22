# Item 8 — inventário de branches para o marco 95/95/95/95

Baseline de medição: `f94e8f0dff82df5341699dcbf5d125ae999f8e2f` (`stabilize/v2.0.0-prototype`).

## Regra operacional

Este inventário aplica a regra do projeto: comportamento v2 válido sem teste → somente teste; comportamento inválido → produção + teste; legado sem função v2 → remover/migrar com suporte documental; branch defensiva/impossível ou artefato de instrumentação → não fabricar estado inválido; ambiguidade documental → interromper e solicitar decisão.

## Baseline consolidado

- Full Vitest: 555/555 arquivos e 9.960/9.960 testes.
- Architecture: 169/169.
- Coverage: Statements 97,30% (26.451/27.184), Branches 93,65% (22.368/23.883), Functions 96,14% (3.196/3.324), Lines 97,46% (25.134/25.787).
- Para 95% de branches: 22.689 cobertas; déficit matemático: 321.
- Branch paths não cobertos pelo relatório V8: 1.515.
- Desses, 852 não possuem localização-fonte utilizável (`location.start.line` ausente; incluem 95 contagens instrumentais negativas). São classificados como `INSTRUMENTATION_ONLY` e não serão perseguidos por alteração de produção/teste.
- Restam 663 branch paths com localização real de fonte. Esse é o universo legítimo para classificação v2.

## Concentração dos gaps com localização real

| Arquivo | Real/source-located | Instrumentação sem localização | Total reportado não coberto |
|---|---:|---:|---:|
| `src/routes/intakeWizard.js` | 29 | 13 | 42 |
| `src/services/SampleGraphValidator.js` | 18 | 8 | 26 |
| `src/routes/orphanet.js` | 18 | 3 | 21 |
| `src/interface/routes/terminologies.routes.js` | 16 | 5 | 21 |
| `src/services/batch-validation-engine.service.js` | 14 | 32 | 46 |
| `src/services/fhir-import-staging.service.js` | 14 | 11 | 25 |
| `src/services/sample.service.js` | 10 | 34 | 44 |
| `src/services/backup.service.js` | 9 | 15 | 24 |
| `src/services/equipment-sensor-quarantine.service.js` | 9 | 3 | 12 |
| `src/database/mongo.js` | 8 | 7 | 15 |
| `src/services/terminologySync.service.js` | 8 | 0 | 8 |
| `src/interface/routes/user.routes.js` | 7 | 35 | 42 |
| `src/controllers/createLinkedFileController.js` | 7 | 11 | 18 |
| `src/interface/routes/storage.routes.js` | 7 | 0 | 7 |
| `src/workers/jobs/daily-merkle.job.js` | 7 | 0 | 7 |
| `src/controllers/sample-file.controller.js` | 6 | 44 | 50 |
| `src/services/import.service.js` | 6 | 22 | 28 |
| `src/config/redis.js` | 6 | 11 | 17 |
| `src/services/log.service.js` | 6 | 5 | 11 |
| `src/routes/eConsent.js` | 6 | 4 | 10 |
| `src/services/session.service.js` | 6 | 1 | 7 |
| `src/services/patientBiomarkerTimeseries.service.js` | 6 | 0 | 6 |
| `src/reference-data/reference-imports/pipeline.js` | 6 | 1 | 7 |
| `src/interface/routes/cid.routes.js` | 6 | 1 | 7 |
| `src/infrastructure/services/TelemetryMonitor.js` | 6 | 1 | 7 |
| `src/controllers/import-lgpd.controller.js` | 5 | 23 | 28 |
| `src/interface/routes/result.routes.js` | 5 | 24 | 29 |
| `src/services/PatientIdentityService.js` | 5 | 3 | 8 |
| `src/services/temperature.service.js` | 5 | 2 | 7 |
| `src/scripts/testEnvironment.js` | 5 | 7 | 12 |
| `src/scripts/migrateClinicalUnitOrganizations.js` | 5 | 2 | 7 |
| `src/scripts/migrateRoleAssignmentScopes.js` | 5 | 0 | 5 |
| `src/scripts/createFirstAdmin.js` | 5 | 0 | 5 |
| `src/models/DispositionAction.js` | 5 | 0 | 5 |
| `src/interface/routes/logs.routes.js` | 5 | 0 | 5 |
| `src/interface/controllers/auto-assign-sample.controller.js` | 5 | 0 | 5 |
| `src/infrastructure/middleware/rbac.js` | 5 | 0 | 5 |
| `src/foundation/foundation-v2.service.js` | 5 | 0 | 5 |
| `src/controllers/audit.controller.js` | 5 | 0 | 5 |
| `src/models/StorageBox.js` | 4 | 7 | 11 |
| `src/models/Log.js` | 4 | 2 | 6 |
| `src/infrastructure/middleware/auth.js` | 4 | 0 | 4 |
| `src/core/use-cases/AllocateSampleUseCase.js` | 4 | 0 | 4 |
| `src/scripts/migrateUserOrganizations.js` | 4 | 0 | 4 |
| `src/routes/dictionary.js` | 4 | 0 | 4 |
| `src/workers/worker.js` | 4 | 3 | 7 |
| `src/services/scheduler.service.js` | 4 | 6 | 10 |
| `src/services/neo4jCanonicalProjection.service.js` | 4 | 0 | 4 |
| `src/services/participantIdentity.service.js` | 4 | 0 | 4 |
| `src/scripts/clearMfaLockForUser.js` | 4 | 0 | 4 |
| `src/services/DrugService.js` | 4 | 0 | 4 |
| `src/services/rbac-assignment.service.js` | 4 | 0 | 4 |
| `src/interface/routes/phone-codes.routes.js` | 4 | 0 | 4 |
| `src/models/Patient.js` | 4 | 0 | 4 |
| `src/models/ReferenceImportRun.js` | 4 | 0 | 4 |
| `src/core/use-cases/MoveSampleUseCase.js` | 4 | 0 | 4 |
| `src/services/mqtt-ingestion-audit.service.js` | 4 | 0 | 4 |

## Critério de fechamento

O marco não será tratado como concluído por contagem estática. Cada branch selecionada deve ficar em uma das classes: `TEST_V2`, `PRODUCTION_DEFECT`, `LEGACY_RETIRE`, `DEFENSIVE_OR_INSTRUMENTATION`, `AMBIGUOUS`. Somente `TEST_V2`, correções documentadas de `PRODUCTION_DEFECT` e remoções documentadas de `LEGACY_RETIRE` podem contribuir legitimamente para o fechamento. A confirmação numérica final depende de uma única rodada consolidada de Coverage após o lote.

## Ordem de trabalho

A priorização considera somente branch paths com linha-fonte real. Os grandes números brutos do relatório (`auth.service.js` 58, `sample-file.controller.js` 50 etc.) não são usados como fila automática, pois a maior parte deles é instrumentação de braços implícitos sem localização. Por exemplo, `auth.service.js` tem 58 reportados, mas só 3 source-located; `sample-file.controller.js`, 50 reportados e 6 source-located.


## Classificação v2 — rodada estática antes de novo Actions

O déficit de **321** é uma diferença matemática entre o numerador atual e o numerador mínimo para 95%; ele não identifica 321 branches específicas. Por isso a reconciliação usa os branch paths do `coverage-final.json` e separa evidência executável de artefato do provedor antes de decidir qualquer alteração.

### Artefato de instrumentação já verificado

No artefato do baseline `f94e8f0`, **757 braços zerados** possuem localização V8 sintética vazia (`start/end { }`). O próprio `COVERAGE_NOTES.md` documenta esse padrão como o `implicit else` fantasma do `@vitest/coverage-v8`: adicionar teste não o torna coberto e adicionar `else` artificial em produção é proibido pela regra do projeto. Há ainda **95 contagens** da diferença entre o total de não cobertos do resumo (1.515) e os braços materializados no `branchMap`; elas não têm branch path individual utilizável. Assim, **852 contagens são classificadas `INSTRUMENTATION_ONLY`**, sem mudança de produção e sem teste artificial.

Isso é suficiente para demonstrar que o número bruto 321 **não pode ser tratado como uma fila de 321 testes**. Não significa, porém, que o threshold numérico já tenha sido alcançado: somente uma nova medição consolidada poderá confirmar quantos contadores reais os testes legítimos adicionais alteraram.

### Casos source-located já verificados por teste existente

A inspeção cruzada entre `coverage-final.json`, fonte e suíte atual mostrou source locations zeradas no merge global que já possuem teste direto de comportamento. Exemplos:

- `auth.service.js`: o fallback de role/hierarchy e os fluxos de lockout/MFA/defaults já são exercitados por `auth.service.processLogin.unit.test.js` e suítes residuais; 52/55 braços zerados do arquivo são locations vazias e os 3 source-located não justificam duplicação cega.
- `NotificationService.js`: a queda para `failed` quando uma rejeição não possui `message` é diretamente assertada em `NotificationService.item8.residual.test.js`, embora o merge global ainda marque o braço correspondente como zero. Classificação: `DEFENSIVE_OR_INSTRUMENTATION` até medição isolada, sem novo teste duplicado.
- `orphanet.js`: linguagem padrão, clamp de limite, aliases CID/OMIM, deduplicação e fallback de sincronização já são exercitados por `orphanet.item8.residual.test.js`.
- `terminologies.routes.js`: aliases, hidratação local/remota, limites e normalização ORPHA já possuem cobertura comportamental direta em `terminologies.routes.item8.residual.test.js`.

### Branches estruturais que não serão artificialmente expostas

- `fhir-import-staging.service.js`: os fallbacks `sprec.matrixType || 'fluid'` e `sprec.matrixType || undefined` aparecem como source-located, porém `parseSprecRaw()` sempre produz `fluid` ou `solid`; criar um estado interno sem `matrixType` apenas para o contador violaria o contrato real.
- `sample-file.controller.js`: os braços de identificador vazio e de Sample persistida sem `specimenId` pertencem a estados que violam a identidade canônica v2; não serão fabricados por mocks apenas para coverage.
- guards de rota `if (!db)` comprovadamente preemptados por middleware permanecem classificados conforme `COVERAGE_NOTES.md`, sem duplicação de estados impossíveis.

### Testes legítimos adicionados nesta rodada

Sem alterar produção, foram acrescentados testes para comportamentos executáveis e documentados:

- modelos canônicos e validações opcionais/obrigatórias;
- utilitários de transação, criptografia, barcode, índices, anonimização e ledger;
- use cases de custódia/linhagem (Allocate/Move/Release/Register);
- normalizadores de reference data;
- `batch-validation-engine.service.js`: erro não-`Error` de criação de Patient, Patient vinculada sem `participantId` canônico e Specimen criada sem `specimenId` canônico;
- `fhir-import-staging.service.js`: preservação de erro 400 canônico de `normalizeEntries` e contagem independente de `WARNING`/`NEEDS_EMAIL`.

Todos os commits desta rodada usam `[skip ci]`. O baseline oficial continua sendo `f94e8f0`; nenhum novo percentual será inferido sem a futura rodada consolidada.
