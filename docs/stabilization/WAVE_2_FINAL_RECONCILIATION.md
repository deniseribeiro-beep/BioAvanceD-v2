# Wave 2 — Evidência final de reconciliação backend × Modelo Canônico v2.0.0

## Escopo e autoridade

Esta evidência consolida o critério de conclusão da issue #1132 para o backend do BioAvanceD na branch `stabilize/v2.0.0-prototype`.

Autoridade documental: Modelo Canônico v2.0.0, Dicionário de Dados Consolidado v2.0.0 e artefatos aprovados declarados no `docs/RELEASE_MANIFEST.json`.

O frontend E2E permanece fora do escopo da Wave 2, conforme definido na issue #1132.

Checkpoint funcional anterior a este commit exclusivamente documental: `47a38f85ec25912b8e4f582489912ea6b38664ea`.

## 1. Cobertura do Dicionário Canônico v2.0.0

O catálogo executável lê diretamente o arquivo aprovado `BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx` e exige o contrato exato de 25 colunas do `DICIONARIO_V2`.

Contagens canônicas obrigatórias:

- elementos totais: **1.644**;
- elementos históricos: **929**;
- elementos novos v2: **715**;
- entidades/artefatos canônicos: **146**;
- IDs duplicados permitidos: **0**;
- elementos sem metadados executáveis obrigatórios: **0**;
- elementos fora da preparação Foundation Phase 1: **0**.

O gate `npm run dictionary:validate` falha se qualquer uma dessas condições divergir e calcula SHA-256 do catálogo carregado.

A suíte arquitetural também exige simultaneamente:

- dicionário v2 completo e verificado;
- 146/146 entidades/artefatos com contrato canônico executável;
- **1.644/1.644 elementos representados em seu contrato de entidade**;
- enums governados ativos reconciliados;
- relacionamentos documentados resolvendo para entidades v2 válidas;
- cadeia física normalizada presente e `StorageAssignment` ausente como relação ativa.

Resultado do checkpoint funcional `47a38f85...`: **144/144 testes arquiteturais aprovados, 0 falhas**.

## 2. Auditoria residual — implementações substituídas

Os gates permanentes da Wave 2 exigem residual zero para:

| Invariante | Estado de fechamento |
| --- | --- |
| consumidores de `contracts/canonical/v1` | zero; diretório físico removido |
| `MongoStorageRepositoryLegacy` | removido |
| modelo `StorageAssignment` legado | removido |
| persistência em `storageAssignments` | zero |
| escrita autoritativa em `Sample.storageLocation` | zero |
| `parentSampleId` | zero; autoridade em `parentSpecimenIds` |
| `COMPROMISED` como `specimenStatus` | zero |
| adaptador Neo4j `LineageRepository.js` | removido fisicamente |
| consumidores executáveis do adaptador legado | zero |
| writers Neo4j de domínio fora da fronteira de projeção/rebuild/admin | zero |

O último adaptador de compatibilidade foi eliminado no checkpoint funcional `47a38f85...`, após migração dos consumidores de `sample.service.js`, `sample.routes.js`, `user.routes.js` e `import-lgpd.service.js` para `MongoLineageRepository(db)`.

## 3. RF023 — MongoDB autoritativo e Neo4j derivado

A fronteira operacional v2 estabelece:

- MongoDB como fonte canônica operacional e autoridade do outbox durável;
- mutações de domínio e eventos de projeção no mesmo contexto transacional quando aplicável;
- Neo4j exclusivamente como projeção derivada por outbox/rebuild;
- ausência de dual-write de domínio para Neo4j;
- processo HTTP sem dependência de escrita Neo4j de domínio;
- gates arquiteturais que bloqueiam regressão de writers diretos.

## 4. Armazenamento físico normalizado

A autoridade física v2 utiliza a cadeia:

`SpecimenContainerAssignment → ContainerPositionAssignment → RackLocationAssignment`

com `Container`, `StorageRack` e `StoragePosition` como estruturas canônicas associadas.

Os testes arquiteturais bloqueiam a reintrodução de `StorageAssignment`, `MongoStorageRepositoryLegacy`, coleção `storageAssignments` e escrita embutida autoritativa em `Sample.storageLocation`.

## 5. Consentimento v2

A autoridade normalizada de consentimento inclui as entidades aprovadas:

- `ConsentTemplate`;
- `Consent`;
- `ConsentPermission`;
- `ConsentDecisionEvent`;
- `ConsentRevocation`;
- `ConsentAuthorizationDecision`;
- `ConsentCommunicationEvent`.

As decisões computáveis permanecem restritas a `permit`, `deny` e `review_required`.

O gate arquitetural exige a presença das coleções normalizadas e desses resultados de autorização.

## 6. Identidade civil e PII

`ParticipantIdentity` permanece segregado do participante operacional canônico.

O gate de identidade deriva os campos civis proibidos diretamente do schema canônico v2 de `ParticipantIdentity` e exige que nenhum call site de `appendEvent` envie esses campos ao outbox de projeção. `participantId` permanece permitido apenas como identificador de correlação/pseudonimizado.

Isso preserva a proibição de dados civis nas projeções Neo4j e a separação entre identidade civil e dados operacionais.

## 7. Telemetria v2

- InfluxDB permanece autoridade das leituras brutas (`TelemetryReading`);
- MongoDB persiste `TelemetryExposureSummary` canônico;
- a associação do espécime é resolvida pela cadeia física normalizada;
- `TELEMETRY_EXPOSURE_SUMMARIZED` é projetado explicitamente pela fronteira Neo4j v2;
- incidentes operacionais não introduzem `COMPROMISED` em `specimenStatus`.

## 8. Foundation Data Pipeline — RF022

O pipeline oficial exige, antes da aplicação:

- validação do dicionário canônico v2;
- infraestrutura Foundation disponível;
- MongoDB replica set inicializado;
- execução Foundation one-shot;
- `FoundationDataRun` com `dictionaryReadiness.expectedTotal = 1644` e `loadedTotal = 1644`;
- contabilização histórica `929/929`;
- ausência de população operacional na Foundation;
- ausência de registros operacionais de domínio criados pela Foundation;
- Neo4j vazio antes do início da aplicação;
- aplicação iniciada somente depois da Foundation;
- precedência runtime da Foundation comprovada;
- suíte backend executada após a stack subir.

## 9. Fronteiras de persistência preservadas

- MongoDB: fonte canônica operacional + outbox;
- Neo4j: projeção derivada;
- InfluxDB: telemetria bruta;
- Object Storage: binários/evidências;
- Redis: transitório;
- FHIR R4: fronteira de interoperabilidade, não persistência operacional paralela.

## 10. Gate de fechamento

A Wave 2 somente deve ser encerrada quando os dois workflows oficiais concluírem com `success` no **mesmo HEAD que contém este documento**:

1. `BioAvanceD current-state validation`;
2. `BioAvanceD release manifest integrity`.

O comentário final da issue #1132 deve registrar esse HEAD e os IDs dos dois runs oficiais. Nenhum resultado da avaliação ex ante de identificação física é inferido ou declarado nesta evidência; sua execução permanece fora desta Wave.
