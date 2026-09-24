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

## Stage 2 — validação local de 2026-09-23

Autoridade desta sessão: HEAD `dd265f698897dc88e8a951d885b47269a870b1c7`, branch `stabilize/v2.0.0-prototype`. O checkpoint acima é histórico, não o HEAD atual. Havia alterações locais em `api/backend/package.json` e `package-lock.json` (Argon2 e Mongoose), preservadas sem inclusão em commits desta sessão. Node local: 24.19.0; Vitest instalado: 4.1.11; coverage-v8 instalado: 4.1.10.

A primeira tentativa direcionada não coletou testes por ausência de `@rolldown/binding-win32-x64-msvc@1.2.10`. O pacote exato declarado no lockfile foi extraído em `node_modules`, sem alterar manifests. A execução seguinte mediu 6 arquivos, 183 testes: 179 aprovados e 4 falhas (6,31 s).

| Arquivo / caso | Classificação | Evidência e correção somente de teste | Resultado direcionado |
| --- | --- | --- | --- |
| `item8.branch95.models.test.js`: TerminologyRelation | TEST_V2 | Import ausente; usar o modelo público existente. Contrato `contracts/canonical/v2`: `relationVersion` e `relationStatus` obrigatórios. | aprovado |
| `item8.branch95.models.test.js`: datas Sample | TEST_V2 | O export padrão é Mongoose; usar o export público `SampleModel`, como `sample.model.unit.test.js` e `sample.models.test.js`. Nenhuma mudança no modelo. | aprovado |
| `fhir-import-staging.item8.residual.test.js`: consulta de consentimento | TEST_V2 | `getConsentStatus` retorna `{ batch, records }`, como a suíte `services/fhir-import-staging-consent.service.test.js`; conferir identidades/status individuais, não contadores inexistentes. O teste anterior não comprovava `summarize`. | aprovado |
| `batch-validation-engine.unit.test.js`: Patient ausente | TEST_V2 | Migrar mock de documento sem identidade para ausência real de Patient e dados insuficientes para cadastro; verificar rejeição e ausência de criação de Sample. | aprovado |
| `batch-validation-engine.unit.test.js`: falha de persistência Specimen | TEST_V2 | Migrar retorno impossível sem `specimenId` para rejeição de persistência; verificar propagação do erro e ausência de observações. Contrato v2 exige `specimenId`/`participantId`; Wave 2 documenta identidade canônica. | aprovado |
| `batch-validation-engine.service.js`: guards de documento persistido sem identidade | DEFENSIVE_OR_INSTRUMENTATION | Não fabricar documentos persistidos inválidos para atingir os guards. Produção preservada; os dois testes anteriores foram migrados para falhas legítimas. | não perseguir por coverage |

Após esse lote: 6/6 arquivos e 183/183 testes aprovados, zero skips, 7,43 s. Architecture: 169/169, zero falhas/skips. Current-State: aprovado, dicionário com 1.644 elementos (929 históricos + 715 novos), 146 entidades. Release Manifest: 9/9 artefatos íntegros. A medição Full Vitest e a reconciliação de coverage serão registradas após conclusão; estes resultados direcionados não substituem os gates completos.

A primeira rodada Full Vitest terminou em 642,16 s: 559 arquivos (557 aprovados, 2 com falha), 10.021 testes (10.019 aprovados, 2 falhas, zero skips). Como as correções direcionadas foram aplicadas durante a execução, essa rodada é diagnóstica, não um snapshot final imutável. Falhas: a expectativa antiga de batch (executada antes da correção) e `patient.service.item8.branchClosure.unit.test.js:180`, reproduzida isoladamente.

O segundo caso é `TEST_V2`: o mock devolvia `birthDate` descriptografada como string UTC, enquanto o fluxo cifrado real de `participantIdentity.service.js:216` devolve `Date`. No fuso America/Sao_Paulo, o mock compara meia-noite UTC com meia-noite local. O teste foi migrado para `encryptIdentityFields`/`decryptIdentity` reais, verificando ausência do valor plano (`null`), presença de ciphertext, tipo `Date` e retorno da identidade original na detecção de duplicidade. Autoridade: dicionário v2 `P1X-0351`, data exata obrigatória em ParticipantIdentity, fronteira protegida MongoDB; suíte existente `patient.service.identityMigration.unit.test.js`. Produção preservada; o braço de string não é perseguido com mock incompatível com o fluxo cifrado. As duas suítes afetadas passaram: 76/76 testes.

O provedor coverage-v8 instalado foi alinhado a 4.1.11 (Vitest 4.1.11), seguindo o procedimento do workflow diagnóstico. Somente `node_modules` foi atualizado; manifests, thresholds e exclusões de coverage permanecem intactos.

### Resultado consolidado local

- Full Vitest após correções, arquivos estáveis: **559/559 arquivos, 10.021/10.021 testes, zero falhas/skips**, exit 0, **513,61 s**.
- Coverage completo: **559/559 arquivos, 10.021/10.021 testes, zero falhas/skips**, exit 0, **651,93 s**.
- Comandos no backend: `node node_modules/vitest/vitest.mjs run --reporter=dot --reporter=json --outputFile=<arquivo-local>`; coverage acrescenta `--coverage --testTimeout=15000`, conforme workflow diagnóstico. Nenhuma restrição de diretórios ou mudança de threshold.

| Métrica | Cobertos / total | Percentual |
| --- | --- | --- |
| Statements | 26.465 / 27.184 | 97,35% |
| Branches | 22.461 / 23.883 | 94,04% |
| Functions | 3.190 / 3.324 | 95,96% |
| Lines | 25.140 / 25.787 | 97,49% |

Déficit atualizado: `ceil(23883 * 0.95) - 22461 = 22689 - 22461 = 228`. O exit 0 do comando não significa atingir 95%: os thresholds originais do projeto foram preservados.

Dos **1.422** contadores não cobertos, **768** têm hits zero e location vazia, **96** têm contador negativo e location vazia, e **558** têm location de fonte e hits zero. Nesta rodada a diferença resumo menos braços materializados é zero. Portanto **864/1.422 (60,76%)** são contadores sem localização utilizável; não confundir esse cálculo com a decomposição do baseline histórico.

| Arquivo / linha ou branch | Classificação | Evidência atual |
| --- | --- | --- |
| Locations vazias em `coverage-final.json` | DEFENSIVE_OR_INSTRUMENTATION | 768 braços zerados + 96 negativos; não justificam estados artificiais ou `else` em produção. |
| `src/routes/orphanet.js:307–308`, branches 53/54 | DEFENSIVE_OR_INSTRUMENTATION | Global `[0,0]` em cada branch; execução isolada de `orphanet.item8.residual.test.js` produz `[7,7]` em cada branch. Teste existente de linguagem/default/clamp nas linhas 288–316. Prova direta da divergência global versus isolado, sem adicionar teste. |
| `src/services/fhir-import-staging.service.js:211,238` | DEFENSIVE_OR_INSTRUMENTATION | Fallbacks de `matrixType`; `parseSprecRaw` sempre produz `solid` ou `fluid`. Não fabricar matriz ausente. |
| `src/services/fhir-import-staging.service.js:604` | DEFENSIVE_OR_INSTRUMENTATION | Global zerado apesar de teste direto aprovado de preservação do status 400 em `fhir-import-staging.item8.residual.test.js:275`. |
| Outros 558 gaps source-located, incluindo os casos acima | inventário, não classificação coletiva | Maior concentração: intakeWizard 29; orphanet 18; SampleGraphValidator 18; terminologies.routes 16; fhir-import-staging 14; batch-validation-engine 13; sample.service 10. Nem todos foram demonstrados como artefatos; não afirmar impossibilidade matemática de alcançar 95%. |

A execução isolada usou `--coverage.include=src/routes/orphanet.js --coverage.reportsDirectory=../../logs/item8-stage2/orphanet-coverage`, preservando o relatório completo em `api/backend/coverage`. Evidência detalhada, locations e logs locais em `logs/item8-stage2/`; estes artefatos são ignorados pelo Git.

Encerramento conforme critério 18 desta sessão: residual majoritariamente instrumental, com divergência comprovada em teste já existente. Não criar testes adicionais exclusivamente para perseguir o contador global. Status: **BLOCKED_BY_COVERAGE_INSTRUMENTATION**. Não há produção alterada nesta sessão, `PRODUCTION_DEFECT` ou `LEGACY_RETIRE` executado, nem caso funcional `AMBIGUOUS` pendente identificado nos casos selecionados. Esta evidência não equivale a uma revisão exaustiva dos 558 braços localizados.

### Docker / segredos / auditoria final

Em **2026-09-23**, base auditada `dd265f698897dc88e8a951d885b47269a870b1c7`: Docker final **não executado** pelo bloqueio de coverage. Inspecionados `compose.test.yml` e `compose.test.foundation.yml` e os workflows oficiais; nenhum `compose config`, build, healthcheck ou gate de container foi executado. Nenhum serviço foi iniciado nesta sessão; não houve teardown nem remoção de volumes. Não confundir com o checkpoint Docker histórico.

`.env` e `.env.docker`: não tracked e ignorados por Git. Credenciais de containers geradas: **no** (fase não alcançada). Nenhum segredo incluído no diff. O diff da sessão contém apenas quatro arquivos de teste e documentação; as alterações preexistentes de dependências foram preservadas. `git diff --check` aprovado. Nenhuma mudança de branch, reset, descarte, push ou execução de GitHub Actions.

## Stage 2B — reconciliação dirigida dos source-located

HEAD inicial: `0a9ed8b1eb77d2c7a2c0f505309383a62109c00c`. O bloqueio registrado na Stage 2 não é uma conclusão definitiva sobre os 558 gaps. Extração exclusiva de `hits === 0` e `location.start.line` inteira positiva: **558 braços**. Inventário compacto local: `logs/item8-stage2/stage2b-inventory.tsv` (arquivo, linha, id:braço, hits, testes com import relacionado, classificação). Imports são candidatos, não prova de cobertura. As sete entradas já comprovadas — orphanet `53:0/1`, `54:0/1`; FHIR `68:1`, `75:1`, `189:0` — foram retiradas da fila sem repetir a análise.

### Branches examinados nesta etapa

Notação `id:braço` identifica exatamente a entrada do relatório global preservado. As quantidades abaixo contam braços, não testes. Nenhuma produção foi alterada.

| Arquivo / linhas | id:braço (quantidade) | Classificação | Evidência / teste associado / resultado |
| --- | --- | --- | --- |
| `intakeWizard.js:207,329,587,696,762,823` | `42:1;82:0;167:0;190:1;214:1;235:1` (6) | TEST_V2 | Novos testes em `intakeWizard.clinicalEntities.test.js` e `intakeWizard.routes.test.js`: FamilyHistory ORPHA sem display opcional; consent section omitida mantendo quarentena; links Data Matrix com encoding; consentimento ativo com entrada RCS insuficiente mantendo bloqueio; rejeições de infraestrutura sem mensagem em POST/GET. Sete casos novos, incluindo uma variante com mensagem; todos aprovados. |
| `intakeWizard.js:132,170` | `9:1;23:1` (2) | DEFENSIVE_OR_INSTRUMENTATION | `buildClinicalData` sempre entrega phenotypes array; catch MedicationExposure só é alcançado após guard de `atcCode` truthy. Não mutar argumentos durante o await para fabricar estado. Suíte clínica aprovada. |
| `intakeWizard.js:332` | `84:0` (1) | DEFENSIVE_OR_INSTRUMENTATION | Todos os mapas passados possuem arrays literais; testes de rejeição de aliases em `intakeWizard.clinicalEntities.test.js`/`intakeWizard.routes.test.js` passam. O braço verdadeiro continua zero inclusive no relatório isolado; o falso acumula hits apesar dos arrays. |
| `intakeWizard.js:477,480` | `128:1;130:1` (2) | DEFENSIVE_OR_INSTRUMENTATION | Fallback `_id` pressupõe consentimento sem `consentId`. Contrato v2 Consent exige `consentId`; entrypoint `consent.service` usa serviço v2. Não adicionar fixture persistida sem identidade canônica. Teste histórico de ACTIVE `_id` não torna esse estado válido no v2. |
| `intakeWizard.js:525,575` | `146:1;162:1` (2) | DEFENSIVE_OR_INSTRUMENTATION | Colunas não positivas são filtradas antes pela capacidade; freezer sem containerID é rejeitado antes de construir placement. `intakeWizard.routes.test.js`: indisponibilidade física/equipamento e posições aprovados. |
| `intakeWizard.js:576,740` | `163:0;164:0;165:0;205:0;205:1` (5) | DEFENSIVE_OR_INSTRUMENTATION | Fixtures com `name: 'Box A'` e resposta `boxName: 'Box A'` assertada em `exposes currentStoragePlacement...`; expressão verdadeira/nome continua zero no relatório isolado. Não remover nome válido para perseguir fallback. |
| `intakeWizard.js:682,721,762,823` | `183:0;201:0;214:0;235:0` (4) | DEFENSIVE_OR_INSTRUMENTATION | matchType não vazio, erro real de RCS e erros reais de POST/GET já exercitados nas suítes de rotas/clínica. Relatórios isolados mantêm zero. As asserções de mensagem POST/GET foram reforçadas; não contabilizar esses quatro braços como ganho novo. |
| `intakeWizard.js:698` | `192:0` (1) | DEFENSIVE_OR_INSTRUMENTATION | O produtor real `quality-domain`/`rcs-certification` devolve SPREC em `calculation_trace.sprec`, não em `qualityAssessment.sprec`. Não fabricar retorno do serviço apenas para ativar esse if. O novo teste usa avaliação RCS real e verifica bloqueio sem inventar SPREC no topo. |
| `intakeWizard.js:351` | `89:0` (1) | LEGACY_RETIRE | Stage 2D: removida coerção numérica; somente identificador string canônico chega a Device. Teste de rota rejeita número sem consulta. |
| `intakeWizard.js:507` | `136:1;136:2` (2) | LEGACY_RETIRE | Stage 2D: Intake consulta `devices.deviceId` e somente `qualificationStatus === qualified`; aliases isolados falham fechados. Teste de rota aprovado. |
| `intakeWizard.js:514–515` | `138:0;140:0` (2) | LEGACY_RETIRE | Stage 2D: removida travessia especial DRAWER→RACK; DRAWER não é rack implícito. Teste de rota aprovado. |
| `intakeWizard.js:791` | `223:1` (1) | PRODUCTION_DEFECT | Stage 2D: removido fallback plaintext por `birthDate`; ausência de representação protegida retorna 503 sem consulta. Teste de rota aprovado. |
| `SampleGraphValidator.js:31,35,45,52,54,55` | `3:0;4:0;5:0/1/2;6:0;7:0;8:0/1;9:0/1;10:0/1;11:0/1` (15) | DEFENSIVE_OR_INSTRUMENTATION | `hashSampleIntegrityPayload` privado só aparece na declaração; `stableObject` só é chamado por ele e recursivamente. Caminho sem entrada executável. A integridade ativa usa `generateSampleHashFromSample`. Não exportar helper, invocar código morto ou removê-lo sem prova documental de aposentadoria. |
| `SampleGraphValidator.js:65` | `13:0` (1) | DEFENSIVE_OR_INSTRUMENTATION | Único chamador de `normalizeBiomarkerMap` fornece objeto ou `{}`; guard preemptado. Suíte `sample-graph-validator.service.test.js` aprovada. |
| `SampleGraphValidator.js:369,423` | `70:0;77:0` (2) | DEFENSIVE_OR_INSTRUMENTATION | Testes existentes `prefers canonical specimenId...` e `uses canonical specimenId in the compliance report...` assertam esses efeitos e passam; contadores isolados permanecem zero. |
| `sample.service.js:102,111,287` | `17:0;20:0;61:0` (3) | DEFENSIVE_OR_INSTRUMENTATION | Guard interno `add` preemptado pelo loop; id vazio exigiria storage persistido sem vínculo identificável; barcode não string é rejeitado previamente por `SampleModel.validate`. Teste existente de barcode numérico rejeitado passa sem alcançar guard duplicado. |
| `sample.service.js:326,340,352,402,421,523,547` | `71:0;74:0;81:0;91:0;93:0;116:0;124:0` (7) | DEFENSIVE_OR_INSTRUMENTATION | Testes de criação/movimento com quantidade/projeto, erro de ledger, erros RCS/SPREC e override de linkedProject já existentes e aprovados. `sample.service.test.js` assertando movimento/update com projeto override ainda tem `116:0/124:0` zerados isoladamente. `sample.service.item8.executable-residual.test.js` confirma erros reais sem teste duplicado. |

### Resultado do lote examinado

- **57 braços novos classificados:** TEST_V2 **6**; DEFENSIVE_OR_INSTRUMENTATION **45**; AMBIGUOUS **6**; PRODUCTION_DEFECT **0**; LEGACY_RETIRE **0**. Mais sete exclusões comprovadas anteriormente, não contadas novamente: **494/558 ainda não examinados individualmente**.
- Testes finais afetados: `intakeWizard.routes.test.js` **35/35**, `intakeWizard.clinicalEntities.test.js` **38/38**, juntos **73/73**, 4,90 s. Sete testes adicionados; sem skips. Uma tentativa intermediária teve timeout de 5 s em teste preexistente; repetição final passou sem alterar timeout/configuração.
- Evidência isolada anterior às adições: rotas **32/32**, clínica **34/34**, `sample.service.test.js` **147/147**, `sample-graph-validator.service.test.js` **28/28**, com coverage restrito ao respectivo arquivo e diretório separado. Confirmação sem coverage de `sample.service.item8.executable-residual.test.js`: **14/14**. Logs em `logs/item8-stage2/stage2b-*`.
- Contribuição potencial conservadora: **0–6 braços dos 228**, sem promessa sobre o merge V8; sete testes não equivalem a sete branches. Não houve Full Vitest, Coverage completo, Docker ou CI.
- **HUMAN_DECISION_REQUIRED**, restrito aos seis braços ambíguos de compatibilidade acima. Parada pelo critério (b), sem converter esses casos em testes artificiais. Isso não resolve nem bloqueia coletivamente os outros 494: a auditoria da fila restante permanece necessária antes de qualquer conclusão definitiva sobre o gate global.

### Stage 2D — decisões humanas aplicadas

| Case | Classificação final | Produção | Teste | Resultado |
| --- | --- | --- | --- | --- |
| 1 — `351` | LEGACY_RETIRE | yes | ID numérico rejeitado | aprovado |
| 2 — `507 maintenanceStatus` | LEGACY_RETIRE | yes | alias isolado não substitui estado canônico | aprovado |
| 3 — `507 operationalStatus` | LEGACY_RETIRE | yes | alias isolado não substitui estado canônico | aprovado |
| 4 — `514 DRAWER` | LEGACY_RETIRE | yes | DRAWER não resolve rack implícito | aprovado |
| 5 — `515 DRAWER.parent_id` | LEGACY_RETIRE | yes | sem suposição DRAWER→RACK | aprovado |
| 6 — `791 birthDate` | PRODUCTION_DEFECT | yes | ausência de busca protegida falha fechada | aprovado |

Teste direcionado: `intakeWizard.routes.test.js`, 40/40; sem skips. Nenhum dos seis casos permanece `AMBIGUOUS`.

### Stage 2E-1 — lote 1

| Arquivo / linhas | id:braço | Classificação | Evidência / resultado |
| --- | --- | --- | --- |
| `terminologySync.service.js:107,141,196,207,211,215` | `19:1;25:3/4;46:1;48:0;52:0;55:1/2` (6) | DEFENSIVE_OR_INSTRUMENTATION | `terminologySync.service.test.js` e `terminologySync.service.item8.residual.test.js` cobrem normalização ORPHA/OMIM, fonte, referências externas e upsert. Guards de redundância exigem payload normalizado; não fabricar payload sem código. 59/59 aprovados. |

STAGE_2E_1_CURSOR

last_file=src/services/terminologySync.service.js
last_branch=55:2
reviewed_this_session=6
remaining_estimate=488

### Stage 2E-2 — lotes após terminologySync

Inventário base: `logs/item8-stage2/stage2b-inventory.tsv` (HEAD de fechamento Stage 2E topologia `76d6be6a`). Sem regenerar coverage-final nesta sessão antes dos lotes; ids `id:braço` do TSV Stage 2B.

| Arquivo / linhas | id:braço (qtd) | Classificação | Evidência / resultado |
| --- | --- | --- | --- |
| `terminologies.routes.js:30` | `2:1` (1) | TEST_V2 | `q=ORPHA:` → `buildDelimitedCodeRegex` retorna null; asserção sem cláusula delimitada em `terminologies.routes.item8.residual.test.js`. |
| `terminologies.routes.js:187,216,220` | `44:*;50:1;52:0` (subset) | TEST_V2 | Live Orphadata com `ORPHAcode:'ORPHA:'` → `getOrphaNumeric` vazio; `bulkUpsertOrphanetRedundancy` não chama `bulkWrite`. |
| `terminologies.routes.js` restante (16−TEST_V2) | ver TSV | DEFENSIVE_OR_INSTRUMENTATION | Callers sempre passam arrays; `updatedAt`/`fonte` setados pelos normalizadores; `hydrateFromOrphadata` só com `search` truthy. Suítes residual+main cobrem aliases/limites/ORPHA. |
| `backup.service.js` (9) | TSV | DEFENSIVE_OR_INSTRUMENTATION | `!encryption` após assert de chave; skip `manifest.json`; `err.error` nesting; fallbacks mongodump/mongorestore já em `backup.service.item8.executable-residual.test.js` e jsonFallback. Não fabricar chave ausente entre checks. |
| `equipment-sensor-quarantine.service.js` (9) | TSV | DEFENSIVE_OR_INSTRUMENTATION | Ternário sensor/equipamento e opcionais de incidente/location cobertos por residual existente; guards de ids vazios preemptados. |
| `database/mongo.js` (8) | TSV | DEFENSIVE_OR_INSTRUMENTATION | `ensureMongoUri`/`getMongoUriLogDetails` com uri vazia; ramos tls/srv e cloud gate já exercitados nas suítes de conexão. |
| `user.routes.js` (7 source-located) | TSV | DEFENSIVE_OR_INSTRUMENTATION | `registerSample` actor/topology/`202` já em `user.routes.coverage.test.js`; audit `userAccountId` pós Stage 2E. |
| `createLinkedFileController.js` (7) | TSV | DEFENSIVE_OR_INSTRUMENTATION | Extensão rejeitada e ObjectId já em `createLinkedFileController.test.js`; ternários de encryption. |
| `storage.routes.js:53` | `4:1` (1) | TEST_V2 | Fallback `message: 'Erro interno'` quando o erro não tem `message`; teste em `storage.routes.test.js`. |
| `storage.routes.js` actor | — | TEST_V2 | Fixture usava `userId`; produção lê `userID` (`actorId()`). Corrigido o teste. |
| `storage.routes.js` restante | TSV | DEFENSIVE_OR_INSTRUMENTATION | `req.body \|\| {}`, opcionais de parent/room/equipment já cobertos nas suítes de topologia. |
| `daily-merkle.job.js` (7) | TSV | DEFENSIVE_OR_INSTRUMENTATION | `isSigningConfigError` (markers, ENOENT do key file, path alheio) já em `daily-merkle.job.test.js`; `!error` defensivo. |

**Resultado do lote Stage 2E-2:** TEST_V2 **4** (terminologies delimited + empty numeric; storage Erro interno + actor userID); DEFENSIVE_OR_INSTRUMENTATION nos demais braços dos oito arquivos da fila. Produção inalterada. Suítes direcionadas: `terminologies.routes.item8.residual.test.js` 6/6; `storage.routes.test.js` 18/18.

STAGE_2E_2_CURSOR

last_file=src/workers/jobs/daily-merkle.job.js
last_branch=18:0
reviewed_this_session=70
remaining_estimate=418

### Stage 2E-2 — rodada Full Vitest + Coverage consolidada

> **SUPERSEDED / diagnostic-only.** Exit **1** com suíte vermelha por drift pós–Stage 2E topologia (fakes `samples` vs `specimens`). **Não é gate Item 8** e **não** deve ser usada para o déficit 95%. Substituída pela Stage 2E-3 abaixo (suíte verde). Drift de testes fechado em `005185cb` / docs Stage 2E checkpoint.

Comando (backend): `node ./node_modules/vitest/vitest.mjs run --coverage --reporter=dot --testTimeout=15000`. Log local: `logs/item8-stage2/stage2e2-cov-run.log`. Duração: **770,19 s**. Exit **1**.

| Métrica | Valor |
| --- | --- |
| Test Files | 150 failed \| 413 passed (563) |
| Tests | 1559 failed \| 8483 passed (10042) |
| Statements | 88,68% (24.502 / 27.627) |
| Branches | 85,82% (20.550 / 23.943) |
| Functions | 91,93% (3.113 / 3.386) |
| Lines | 88,72% (23.220 / 26.171) |

Déficit bruto vs 95% deste total (`ceil(0,95 × 23.943) = 22.746`): **2.196** braços — **inválido como gate** (suíte vermelha).

### Stage 2E-3 — rodada Full Vitest + Coverage consolidada (suíte verde)

HEAD: `005185cb`. Comando (backend): `node ./node_modules/vitest/vitest.mjs run --coverage --reporter=dot --testTimeout=15000`. Log: `logs/item8-stage2/stage2e3-cov-run.log`. Artefatos: `coverage-final-stage2e3.json`, `coverage-summary-stage2e3.json`, inventário `stage2e3-inventory.tsv`. Duração: **785,31 s**. Exit **0**.

| Métrica | Valor |
| --- | --- |
| Test Files | 563 passed (563) |
| Tests | 10062 passed (10062) |
| Statements | 97,23% (26.862 / 27.627) |
| Branches | 94,01% (22.510 / 23.943) |
| Functions | 95,89% (3.247 / 3.386) |
| Lines | 97,40% (25.491 / 26.171) |

Déficit branches vs 95% (`ceil(0,95 × 23.943) = 22.746`): **236** braços. Statements / Functions / Lines já ≥ 95%. Source-located zero-hit no inventário novo: **565** braços / **164** arquivos (768 locations V8 vazias excluídas). Lint + architecture + `current-state:ci` exit 0 no host.

STAGE_2E_3_CURSOR

last_file=(pending lote 1)
last_branch=
reviewed_this_session=0
remaining_estimate=565

### Stage 2E-3 — lote 1 (pós–daily-merkle)

Fila: `intakeWizard.js` + `intakeWizard.routes.js`, `SampleGraphValidator.js`, `orphanet.js` (só source-located do TSV Stage 2E-3).

| Arquivo / linhas | id:braço (qtd) | Classificação | Evidência / resultado |
| --- | --- | --- | --- |
| `intakeWizard.js` 132,170,332,475,478,519,570*,676,690,692,715 | TSV (13) | DEFENSIVE_OR_INSTRUMENTATION | Stage 2B/2D: phenotypes/`atcCode`/aliasMap/consentId/capacity/placement/matchType/GOVERNANCE_BLOCKED/SPREC/`Error.message` — não fabricar; Stage 2D LEGACY/PRODUCTION não reabertos. |
| `intakeWizard.js:734` | `197:1` (1) | TEST_V2 | Box só com `boxID` → fallback `boxName`/`readable` em `intakeWizard.routes.test.js`. |
| `intakeWizard.routes.js:121,133` | `37:1;38:1` (2) | TEST_V2 | Specimen `findOne` null → `wasQuarantined=false` e sem QuarantineAction (`intakeWizard.routes.governance.test.js`). |
| `intakeWizard.routes.js:138` | `42:1` (1) | DEFENSIVE_OR_INSTRUMENTATION | `INTAKE_GOVERNANCE` reason sempre setado ao quarentenar. |
| `intakeWizard.routes.js:141` | `45:1` (1) | TEST_V2 | Release sem `userID` → `authorizedBy: 'SYSTEM'`. |
| `SampleGraphValidator.js` 31–65,369,423 | TSV (18) | DEFENSIVE_OR_INSTRUMENTATION | `stableObject`/`hashSampleIntegrityPayload` sem call sites; guards preemptados por `_loadSample`/`specimenId` canônico (L403–405). |
| `orphanet.js` (18) | TSV | DEFENSIVE_OR_INSTRUMENTATION | Isolado cobre quase tudo (153/155); merge global V8 zero — mesmo padrão 307–308 já documentado; sem duplicar residual. |

**Resultado lote 1:** TEST_V2 **4** (intakeWizard boxID + governance SYSTEM + specimen ausente ×2 comportamentos); DEFENSIVE nos demais. Produção inalterada. Suítes: `intakeWizard.routes*.test.js` + validators/orphanet verdes (92 testes no smoke do lote).

STAGE_2E_3_CURSOR

last_file=src/routes/orphanet.js
last_branch=54:1
reviewed_this_session=54
remaining_estimate=511

### Stage 2E-3 — avaliação do déficit vs 95%

Baseline Stage 2E-3: Branches **94,01%** (22.510 / 23.943), déficit **236** para 22.746. Statements / Functions / Lines já ≥ 95%.

O lote 1 adicionou **4** `TEST_V2` pontuais; a maior parte dos 54 braços revisados é `DEFENSIVE_OR_INSTRUMENTATION` (helpers mortos / merge V8 / contratos que não se fabricam). Isso **não** fecha o déficit 236.

**Decisão:** continuar a fila (próximos: `fhir-import-staging.service.js`, `batch-validation-engine.service.js`, `sample.service.js`, …) em ondas seguintes; **não** chase cego do contador global nem declarar Item 8 fechado. Re-medição Full+coverage só após lote(s) com volume material de `TEST_V2` executável.

Docker espelho (`backend-unit-runner` / `current-state:ci`): exit 0 — `logs/item8-stage2/docker-stage2e3.log`.
