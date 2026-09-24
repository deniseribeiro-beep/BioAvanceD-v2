# Wave 1 — Inventário e classificação da estabilização BioAvanceD v2.0.0

## 1. Baseline e escopo

- Branch de trabalho: `stabilize/v2.0.0-prototype`
- HEAD usado como baseline da classificação: `6da08ae7c0b0afc5829e2e642fc4499193a96f78`
- Issues abertas antes das issues criadas pela própria Wave 1: **115**
- Tracker da Wave 1: #1131
- Integridade do manifesto de release: #1130

Esta Wave usa como autoridade os artefatos aprovados presentes em `docs/`. O conteúdo canônico aprovado não é alterado para acomodar implementações legadas. Quando a documentação v2 já define o comportamento/estrutura, o código deve convergir para ela. Quando a documentação não determina uma decisão necessária, a questão permanece aberta como `DECISAO_FORA_DOC`.

O protocolo de avaliação ex ante de identificação física permanece aprovado para execução, porém **não executado**. A estabilização não cria nem infere resultados dessa avaliação.

## 2. Invariantes documentais usados na classificação

A classificação abaixo considera como já aprovados, entre outros, os seguintes pontos do pacote v2.0.0:

- MongoDB é a fonte canônica/autoritativa operacional.
- Neo4j é projeção derivada e deve ser alimentado exclusivamente por outbox durável; escritas diretas de domínio no Neo4j não fazem parte da arquitetura v2.
- FHIR R4 é fronteira de interoperabilidade, não persistência operacional paralela.
- `TelemetryReading` tem autoridade no InfluxDB.
- `StorageAssignment` está depreciado; a identificação/alocação física deve convergir para a cadeia normalizada `SpecimenContainerAssignment → ContainerPositionAssignment → RackLocationAssignment`.
- Identidade civil é segregada; pseudonimização, minimização e restrições de PII são invariantes de governança.
- Consentimento, finalidade, autorização, proveniência, cadeia de custódia e auditoria são invariantes executáveis.
- RF022 define Foundation Data Pipeline one-shot, após health checks e antes de APIs/workers dependentes, com estruturas, contratos, invariantes, índices, outbox, auditoria, testes, rollback e `ReadinessReport`.
- RF023 exige persistência do agregado canônico e do evento de outbox na mesma transação MongoDB e projeção assíncrona no Neo4j.
- RF028/RF029 exigem staging/quarentena/validação para referência e ingestão, com autoridade de persistência por store e auditoria.
- RNF007/RNF008/RNF009/RNF017/RNF019/RNF022/RNF024/RNF028/RNF031/RNF032 permanecem critérios transversais de segurança, escopo, auditoria, testes, outbox, retenção, FHIR e governança.

## 3. Taxonomia da Wave 1

| Classificação | Uso |
|---|---|
| `EXECUTAR_V2` | O objetivo da correção é determinado pela documentação aprovada; não depende de nova decisão de governança. |
| `MIGRAR_REESCREVER_V2` | A implementação atual representa estrutura/contrato legado e deve convergir para a modelagem v2, evitando ampliar o legado. |
| `REMOVER_LEGADO` | Superfície sem papel na arquitetura v2; remover somente após provar ausência de consumidores ativos ou após entregar o substituto v2. |
| `REVALIDAR_TESTE_INFRA` | Questão de CI, teste, wiring, migração ou comportamento operacional que deve ser comprovada no baseline antes de fechar/corrigir. |
| `DECISAO_FORA_DOC` | A documentação aprovada não determina a escolha. A issue fica aberta; não criar regra nova por inferência. |
| `DEPLOYMENT_CHECK` | Só pode ser encerrada de forma confiável no primeiro ambiente/deployment aplicável. |
| `CANDIDATA_FECHAMENTO_SUPERSEDED` | Issue/tracker antigo potencialmente absorvido pela arquitetura/programa v2; revalidar antes de fechar, sem fechamento em lote. |

A classificação é **primária**. Uma issue pode conter subitens já corrigidos e outros ainda abertos; o trabalho posterior deve revalidar o residual exato no HEAD antes de editar ou fechar.

## 4. Classificação das 115 issues preexistentes

### 4.1 `EXECUTAR_V2` — 48 issues

#115, #586, #652, #667, #695, #714, #733, #735, #748, #793, #794, #800, #807, #812, #813, #821, #824, #827, #832, #885, #903, #908, #909, #914, #929, #941, #950, #959, #986, #1005, #1008, #1013, #1020, #1026, #1049, #1053, #1065, #1069, #1074, #1076, #1077, #1087, #1103, #1104, #1106, #1118, #1123, #1127.

Principais fundamentos: governança de referência/ingestão; segregação de identidade e retenção; consentimento versionado e autorizado; RBAC/escopo; auditoria; índices/estrutura de Foundation; outbox; minimização em exportações; telemetria e excursões; testes/validações exigidos pelo contrato.

### 4.2 `MIGRAR_REESCREVER_V2` — 10 issues

#804, #870, #923, #943, #966, #967, #988, #990, #1089, #1124.

Esses itens não devem ser resolvidos consolidando contratos v1.x ou ampliando a topologia física legada. A direção é substituir/convergir para o runtime canônico v2, Foundation, cadeia física normalizada e projeção Neo4j por outbox.

### 4.3 `REMOVER_LEGADO` — 7 issues

#871, #934, #956, #961, #1057, #1066, #1108.

Regra: antes da remoção, provar ausência de consumidor ativo e, quando houver capacidade legítima embutida no legado, preservar essa capacidade no caminho v2. Para #961, a remoção do arquivo rastreado daqui em diante é separada de eventual reescrita de histórico, que não é autorizada por esta classificação.

### 4.4 `REVALIDAR_TESTE_INFRA` — 17 issues

#228, #284, #286, #599, #797, #803, #817, #841, #879, #921, #978, #1006, #1060, #1092, #1098, #1117, #1125.

Essas issues dependem de evidência atual: execução de CI/testes, presença de dados/migrações, cobertura real, wiring de scripts ou comportamento de stack. Não devem ser fechadas apenas porque o texto original está antigo.

### 4.5 `DECISAO_FORA_DOC` — 27 issues

#660, #662, #663, #666, #680, #686, #687, #715, #721, #751, #761, #830, #831, #836, #840, #883, #957, #975, #976, #979, #1002, #1011, #1014, #1030, #1051, #1112, #1120.

A existência do problema/pergunta pode ser técnica e real, mas a documentação aprovada não fornece base suficiente para escolher a política ou o produto final nesses pontos. Permanecem abertas para decisão, sem inventar comportamento.

### 4.6 `DEPLOYMENT_CHECK` — 2 issues

#682, #962.

Dependem de configuração/arquitetura do ambiente de implantação real. Permanecem no checklist de pré-deployment e não bloqueiam a modelagem documental.

### 4.7 `CANDIDATA_FECHAMENTO_SUPERSEDED` — 4 issues

#646, #846, #985, #1055.

Não fechar automaticamente. Revalidar:

- #646: tracker antigo de Wave E2E anterior ao programa de estabilização atual.
- #846: tracker de investigação; os membros concretos continuam classificados separadamente.
- #985: pedido de alteração do dicionário antigo deve ser confrontado com o v2 aprovado; não se altera o pacote aprovado por esta issue.
- #1055: `create-db.js` é conceitualmente substituído pelo Foundation Data Pipeline, mas só deve ser retirado depois que o one-shot v2 estiver implementado e testado.

**Controle de completude:** 48 + 10 + 7 + 17 + 27 + 2 + 4 = **115 issues**, sem duplicação na classificação primária.

## 5. P0 — caminho crítico para o protótipo v2

A prioridade P0 é independente da taxonomia. Os seguintes itens devem ser tratados antes de se considerar o protótipo v2 pronto para avaliação técnica:

#667, #793, #800, #804, #807, #812, #821, #827, #832, #914, #923, #941, #943, #959, #961, #966, #967, #986, #988, #990, #1008, #1013, #1020, #1026, #1049, #1053, #1069, #1074, #1076, #1077, #1087, #1089, #1103, #1104, #1106, #1123, #1124.

Ordem técnica recomendada dentro do P0:

1. **Gate canônico v2 / Foundation** — #941, #943, #966, #967 e substituição controlada de #1055.
2. **LGPD, identidade, escopo e RBAC** — #793, #800, #807, #812, #961, #986, #1008, #1013, #1053, #1076, #1077, #1087, #1103, #1104, #1123.
3. **Consentimento** — #821, #827, #832, #1049.
4. **Outbox/Neo4j** — #1026, #1069; remover dependências de escrita direta antes de estabilizar linhagem/custódia.
5. **Armazenamento v2 / transações** — #804, #923, #988, #990, #1124, já mirando a cadeia física v2 em vez de consolidar `StorageAssignment`/`StorageContainer` legados.
6. **Telemetria/políticas** — #1074, #1089, #1106, com #1118 entrando imediatamente depois no P1.
7. **Auditoria e readiness** — #667, #914, #959.

A #1130, criada pela própria Wave 1, também é bloqueadora de release documental/reprodutível, porém não integra o conjunto original de 115 issues.

## 6. Evidência estática confirmada no baseline

A auditoria branch-specific confirmou os seguintes residuais; isso evita executar títulos de issues antigas como se todos os seus subitens ainda estivessem intactos:

- `.github/workflows/ci-pipeline.yml` continua com `push` e `pull_request` apenas para `main`. Assim, #599 permanece materialmente válida para a branch de estabilização. O workflow também não chama Playwright, mantendo #284 aberta.
- `LineageRepository` ainda faz `MERGE`/`CREATE` diretamente no Neo4j para `Sample`, `CustodyEvent` e posições, inclusive em `validateBeforePersistence`, `createSampleNodeWithParent` e `recordCustodyEvent`. Isso conflita com a regra v2 de projeção exclusiva por outbox e mantém #1069/#1026 no caminho crítico.
- `StorageAssignment.js` e `StorageContainer.js` continuam presentes e ativos no código. `StorageAssignment` ainda se declara como modelo físico principal e `StorageContainer` mantém a hierarquia FREEZER/SHELF/RACK/DRAWER. Como o v2 aprovou a cadeia normalizada substituta, #1124/#988/#990 não devem gerar nova dependência estrutural desse legado.
- `participantIdentity.service.js#getCiphertextOnlyFields()` retorna atualmente apenas `birthDate`. Portanto, #1104 está parcialmente evoluída: `birthDate` já fez o cutover, mas `patientName` e `identityDocument` ainda não estão ciphertext-only. O trabalho deve partir desse residual, não repetir a issue inteira.
- `policy.routes.js` já aplica `requirePermission('viewTemperature')` aos três GETs. A metade de leitura de #1074 foi corrigida; as escritas ainda usam `viewTemperature`, portanto a issue não pode ser tratada como totalmente resolvida.
- `security.service.js` já possui wiring parcial de política de sessão e comentários que reconhecem `authentication.requireMFA`/`enhancedSecurity.requireMFAForAll` como ainda inertes. #914 deve ser trabalhada sobre o residual atual, não sobre a fotografia antiga do corpo da issue.
- O commit imediatamente posterior ao baseline ajustou a instalação do pacote Rollup Linux na CI. #286 precisa de evidência do workflow antes de ser encerrada; a Wave 1 não presume que a causa intermitente foi eliminada.

## 7. Relação das Waves seguintes

### Wave 2 — Gate canônico v2 e Foundation mínimo

Criar o contrato de conformidade v2 executável e o caminho de Foundation necessário para impedir que código v1.x, índices ausentes ou estruturas proibidas sejam promovidos como runtime canônico.

### Wave 3 — Segurança/LGPD/RBAC

Fechar plaintext residual, escopo organizacional, autoridade de permissões, retenção/minimização e superfícies de exportação, preservando questões `DECISAO_FORA_DOC` como abertas.

### Wave 4 — Consentimento

Consolidar template/versão/permissões/decisões/revogação/autorização/evidência/outbox, removendo os caminhos paralelos que produzem estado parcial.

### Wave 5 — Outbox/Neo4j

Eliminar escrita direta de domínio, produzir eventos de espécime/consentimento coerentes e validar replay/reconciliação/projeção sem PII.

### Wave 6 — Armazenamento físico v2

Migrar a estrutura legado para a cadeia física aprovada, incluindo alocação, movimentação, quantidade/destinação, custódia e identificação física sem criar dependências novas em `StorageAssignment`.

### Wave 7 — Telemetria e excursões

Convergir políticas, ingestão, autoridade InfluxDB e `EnvironmentalExcursion`, incluindo deduplicação/episódio e auditoria.

### Wave 8 — Importação e referência

Foundation/reference releases, staging/quarentena, cobertura, rollback, promoção e importação operacional/científica conforme RF028/RF029.

### Wave 9 — Auditoria, infraestrutura e testes

Selagem, CI, Playwright, bootstrap, backup/restore, readiness e gates finais.

### Wave 10 — Limpeza e fechamento

Somente depois das substituições estarem testadas: remover legado, revalidar candidatas a superseded, fechar issues uma a uma e limpar branches antigas.

## 8. Gates antes de declarar o protótipo estável

- integridade documental/release manifest;
- conformidade do modelo/runtime v2;
- Foundation/readiness;
- testes unitários e de arquitetura;
- integração backend;
- frontend typecheck/build;
- Playwright/E2E real;
- transações MongoDB exigidas pelos invariantes;
- RBAC multiorganização;
- consentimento e revogação/autorização;
- outbox, replay e reconciliação Neo4j;
- ciclo de armazenamento e cadeia de custódia v2;
- telemetria e excursões;
- LGPD/identidade/retenção/exportação;
- auditoria e selagem;
- backup/restore;
- smoke test de stack de produção.

A avaliação ex ante de identificação física permanece separada destes gates e continuará sem resultado até sua execução metodologicamente prevista.