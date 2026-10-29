**BIOAVANCED**

Documento Unificado de Requisitos

Requisitos funcionais e não funcionais auditados contra o Modelo Canônico v2.0.0

| **Controle** | **Valor** |
|----|----|
| Versão | 4.0.0 - 12 de setembro de 2026 |
| Baseline auditado | Documento Unificado v3.0.0 |
| Base canônica | BioAvanceD Canonical Data Model v2.0.0 - aprovado e final |
| Escopo funcional | RF001-RF029; |
| Escopo não funcional | RNF001-RNF032 |
| Elementos canônicos | 1644 elementos; 929 históricos preservados; 715 V2E adicionados |
| Entidades/artefatos | 146 |
| Status | Aprovado e final; adoção coordenada com a release canônica v2.0.0 |
| Protocolo ex ante | v1.0.0 - approved_for_execution; execução ainda não realizada |

| **Princípio vinculante: flexibilidade configuracional com invariantes arquiteturais e de governança. Configuração não pode desabilitar identidade, consentimento, finalidade, acesso, proveniência, custódia, auditoria, autoridade dos stores, outbox, fronteira FHIR ou admissibilidade do RCS.** |
|----|

# 1. Resultado da auditoria

A auditoria preservou os 29 requisitos funcionais e os 32 requisitos não funcionais existentes. Não foi criado RF030. A referência funcional futura foi removida do conjunto vigente e substituída por uma declaração arquitetural de estruturas inativas e condicionadas, incorporada aos requisitos aplicáveis sem representar IA implementada.

| **Conjunto** | **Total** | **Alterados** | **Mantidos após auditoria** |
|--------------|-----------|---------------|-----------------------------|
| RF           | 29        | 22            | 7                           |
| RNF          | 32        | 22            | 10                          |

## 1.1 Inconsistências corrigidas

- Referências textuais a RF030 e atribuição incorreta da Fase 3 foram eliminadas; a ingestão operacional permanece em RF029.

- RF022 permanece Foundation Data Pipeline; RF023 permanece outbox/projeção Neo4j; RF028 permanece referência; RF029 permanece ingestão operacional/científica.

- PARTIAL, DEPLETED, DESTROYED e DISPOSED deixaram de ser estados operacionais no RF006.

- Consentimento amplo e dinâmico deixaram de ser tratados como equivalentes.

- RF016 distingue tubo, posição, rack, identificador e espécime e incorpora o protocolo ex ante.

- RCS passou a exigir snapshot imutável e resolvível com matriz, cinco eixos, códigos SPREC, severidades, seis evidências, P_bio, classes e rota.

- Os planos de pipeline anteriores deixaram de ser autoridade; RF022/RNF031 agora derivam da release canônica v2.0.0.

- RF009, RF017, RF023, RF029 e RNF004/RNF016/RNF019/RNF025 incorporam as correções de telemetria e grafo; a ingestão remota usa MQTT, HTTPS ou adaptador homologado.

- RF011 governa InteroperabilityMappingRelease e identifier.system sob bioadvanced.dev.

# 2. Modelo de fases

| **Fase** | **Finalidade** | **População permitida** | **Gate** |
|----|----|----|----|
| Fase 1 - Foundation | Preparar integralmente entidades, campos, contratos, enums, índices, configurações, invariantes, mappings, importadores, outbox, auditoria, testes e rollback. | Somente metadados estruturais, configurações e dados sintéticos isolados de teste; nenhum dado operacional fictício. | FoundationDataRun, ConfigurationValidationRun e ReadinessReport sem P0/invariante falho. |
| Fase 2 - Referências | Popular terminologias, ontologias, catálogos, mappings, perfis e templates aprovados. | ReferenceDatasetRelease e registros vinculados, com licença, origem, checksum e cobertura. | Qualidade, cobertura, issues, promoção e rollback validados. |
| Fase 3 - Operacional/científica | Receber dados autorizados pelos contratos preparados. | Participantes, consentimentos, espécimes, custódia, clínicos, telemetria, arquivos, estudos, ensaios, etiquetas e ciência. | Consentimento/finalidade, referências ativas, proveniência, auditoria e store correto. |
| Futuro condicionado | Possível ativação de artefatos de modelos em projeto separado. | Nenhuma instância ativa no escopo atual. | Novo projeto, ética, finalidade, validação, documentação e aprovação. |

# 3. Convenções e regras de interpretação

- Nomes de entidades e campos canônicos permanecem em inglês; português é rótulo de apresentação.

- Aplicação F1 estrutura / F3 operação significa preparação integral na Fase 1 e população operacional na Fase 3.

- Critério de aceite especifica evidência verificável; não constitui alegação de implementação concluída.

- ModelArtifact, ModelCard, ModelEvaluationRun, AlgorithmicDecisionReview e ModelMonitoringEvent permanecem inativos e condicionados.

- Conformidade com normas significa alinhamento documental; não certificação.

# 4. Matriz funcional resumida

| **ID** | **Módulo** | **Aplicação** | **Auditoria** |
|----|----|----|----|
| RF001 | Segurança e autenticação | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF002 | Dashboard e autorização | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF003 | Gestão de usuários | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF004 | Cadastro integrado e governança da coleção | F1 estrutura / F3 operação | Alterado |
| RF005 | Participante e dados clínicos | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF006 | Rastreabilidade, quantidade e cadeia de custódia | F1 estrutura / F3 operação | Alterado |
| RF007 | Arquivos científicos e dados brutos | F1 estrutura / F3 operação | Alterado |
| RF008 | Relatórios | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF009 | Telemetria e monitoramento ambiental | F1 estrutura / F2 perfis / F3 operação | Alterado |
| RF010 | TCLE específico, amplo, escalonado e dinâmico | F1 estrutura / F3 operação | Alterado |
| RF011 | Interoperabilidade HL7 FHIR R4 | F1 estrutura / F2 perfis e mappings / F3 intercâmbio | Alterado |
| RF012 | Auditoria e integridade criptográfica | Transversal | Alterado |
| RF013 | Backup e restauração | F1 estrutura / transversal | Mantido com auditoria de coerência |
| RF014 | Políticas e configuração governada | F1 estrutura / transversal | Alterado |
| RF015 | Alertas e notificações | F1 estrutura / F3 operação | Alterado |
| RF016 | Identificação física e leitura unificada | F1 estrutura / F2 homologação / F3 operação | Alterado |
| RF017 | Equipamentos e armazenamento | F1 estrutura / F2 perfis / F3 operação | Alterado |
| RF018 | Qualificação pré-analítica - SPREC e RCS | F1 estrutura e regras / F2 releases / F3 avaliação | Alterado |
| RF019 | Quarentena lógica | F1 estrutura / F2-F3 execução | Alterado |
| RF020 | Metadados institucionais, regimes e MIABIS | F1 estrutura / F2 mapping / F3 operação | Alterado |
| RF021 | Estudos, protocolos, ética e custódia | F1 estrutura / F3 operação | Alterado |
| RF022 | Foundation Data Pipeline | Fase 1 | Alterado |
| RF023 | Outbox e projeção Neo4j | F1 estrutura / F2-F3 operação | Alterado |
| RF024 | Solicitações de acesso e distribuição | F1 estrutura / F3 operação | Alterado |
| RF025 | Ensaios, reagentes e não conformidades | F1 estrutura / F3 operação | Mantido com auditoria de coerência |
| RF026 | Retenção, destinação e fechamento | F1 estrutura / F3 operação | Alterado |
| RF027 | Workflows e dados ômicos | F1 estrutura / F3 operação | Alterado |
| RF028 | Importação de dados de referência | F1 mecanismos / F2 população | Alterado |
| RF029 | Ingestão operacional e científica | Fase 3 | Alterado |

# 5. Requisitos funcionais RF001-RF029

## RF001 - Segurança e autenticação

| **Atributo** | **Definição** |
|----|----|
| Módulo | Segurança e autenticação |
| Ator primário | Usuário autenticável |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | UserAccount; Session; SecurityConfiguration; AuditEvent |
| Status da auditoria | Mantido com auditoria de coerência |

**Requisito:** O sistema deve autenticar usuários por credenciais protegidas por hash seguro, RBAC, aplicar autenticação multifator conforme a política de segurança e emitir sessões autenticadas, expiráveis e revogáveis.

Critérios de aceitação:

1\. Rejeitar o acesso quando a senha ou o fator adicional forem inválidos.\
2. Bloquear temporariamente a conta após o limite configurado de tentativas malsucedidas.\
3. Criar sessão com prazo de expiração e papéis associados.\
4. Invalidar a sessão após logout, inativação da conta ou revogação administrativa.\
5. Registrar tentativas e decisões de autenticação em AuditEvent.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF002 - Dashboard e autorização

| **Atributo**           | **Definição**                      |
|------------------------|------------------------------------|
| Módulo                 | Dashboard e autorização            |
| Ator primário          | Usuário autenticado                |
| Aplicação              | F1 estrutura / F3 operação         |
| Entidades/contratos v2 | Role; Permission; AccessPolicy     |
| Status da auditoria    | Mantido com auditoria de coerência |

**Requisito:** O sistema deve apresentar dashboards, menus, indicadores e ações conforme as permissões efetivas e o escopo de acesso do usuário autenticado.

Critérios de aceitação:

1\. O Técnico visualiza operações autorizadas de cadastro, custódia e armazenamento.\
2. O Coordenador visualiza indicadores operacionais, alertas e relatórios de governança.\
3. O Administrador visualiza segurança, usuários, auditoria e configurações.\
4. O Usuário Externo visualiza somente dados e relatórios previamente autorizados.\
5. O backend valida a permissão independentemente da ocultação da função no frontend.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF003 - Gestão de usuários

| **Atributo**           | **Definição**                                     |
|------------------------|---------------------------------------------------|
| Módulo                 | Gestão de usuários                                |
| Ator primário          | Administrador                                     |
| Aplicação              | F1 estrutura / F3 operação                        |
| Entidades/contratos v2 | UserAccount; Role; Permission; UserRoleAssignment |
| Status da auditoria    | Mantido com auditoria de coerência                |

**Requisito:** O sistema deve permitir ao Administrador gerenciar o ciclo de vida de contas de usuário, seus papéis, permissões, escopos, credenciais, MFA e sessões.

Critérios de aceitação:

1\. Validar unicidade de e-mail e username.\
2. Aplicar a política de complexidade e histórico de senhas.\
3. Atribuir papel com vigência e escopo institucional.\
4. Inativar a conta sem excluir o histórico.\
5. Revogar sessões e permitir redefinição controlada do MFA.\
6. Auditar criação, edição, bloqueio, inativação e alterações de papel.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF004 - Cadastro integrado e governança da coleção

| **Atributo** | **Definição** |
|----|----|
| Módulo | Cadastro integrado e governança da coleção |
| Ator primário | Técnico / Coordenador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | Participant; Collection; BiobankGovernanceContext; BiorepositoryContext; Consent; Specimen |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve disponibilizar fluxo integrado para registrar participantes, estudos, coleções, consentimentos e espécimes, aplicando o regime de governança computável, as aprovações vigentes, as regras pré-analíticas e os bloqueios versionados.

Critérios de aceitação:

1\. Gerar participantId e specimenId únicos e imutáveis, mantendo a identidade civil segregada.

2\. Exigir Collection.governanceRegime igual a biobank ou biorepository para material humano de pesquisa.

3\. Exigir exatamente um contexto compatível com o regime e uma aprovação aplicável vigente.

4\. Para biorrepositório, exigir studyId, protocolId, protocolVersion, CAAE, instituição e responsável conforme aplicabilidade.

5\. Para biobanco, registrar finalidade ampla, política, instância de acesso, custódia e condições para uso futuro.

6\. Validar material, origem, coleta, processamento e variáveis SPREC aplicáveis.

7\. Bloquear cadastro ou ativação incompatível com consentimento, protocolo, aprovação, custódia ou regra de governança.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF005 - Participante e dados clínicos

| **Atributo** | **Definição** |
|----|----|
| Módulo | Participante e dados clínicos |
| Ator primário | Coordenador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | Participant; ParticipantIdentity; ClinicalObservation |
| Status da auditoria | Mantido com auditoria de coerência |

**Requisito:** O sistema deve registrar o participante de forma pseudonimizada, manter a identidade civil em fronteira protegida e associar dados clínicos, diagnósticos e fenotípicos estruturados por terminologias versionadas.

Critérios de aceitação:

1\. Gerar participantId único.\
2. Armazenar dados civis diretos somente em ParticipantIdentity.\
3. Impedir a projeção de identificadores civis para o Neo4j.\
4. Permitir codificação por HPO, ORPHA, CID, MONDO ou OMIM, somente quando houver ReferenceDatasetRelease ativa e validada para o sistema e a versão adotados.\
5. Preservar código, sistema, versão e descrição da terminologia utilizada.\
6. Permitir texto narrativo apenas nos campos destinados a observações complementares.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF006 - Rastreabilidade, quantidade e cadeia de custódia

| **Atributo** | **Definição** |
|----|----|
| Módulo | Rastreabilidade, quantidade e cadeia de custódia |
| Ator primário | Técnico |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | Specimen; CustodyEvent; CustodianshipAssignment; OperationalStateDecision; DispositionAction |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve registrar a cadeia de custódia e controlar separadamente o estado operacional do espécime, sua quantidade derivada e as ações de destinação.

Critérios de aceitação:

1\. Registrar origem, destino, custódia, responsável, finalidade, instante e quantidade de cada movimentação.

2\. Usar em specimenStatus somente available, reserved, checked_out, quarantined, unavailable e closed.

3\. Derivar quantityStatus como full, partial ou depleted a partir de initialQuantity e currentQuantity; impedir edição manual.

4\. Atualizar currentQuantity e a versão do ledger por operação atômica e reconciliável.

5\. Representar transfer, return, destroy e preserve em DispositionAction, com estado planned, approved, executed, cancelled ou blocked.

6\. Impedir movimentações incompatíveis com quarentena, indisponibilidade, fechamento, consentimento, custódia ou legal hold.

7\. Preservar CustodyEvent e OperationalStateDecision como histórico append-only.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF007 - Arquivos científicos e dados brutos

| **Atributo**           | **Definição**                              |
|------------------------|--------------------------------------------|
| Módulo                 | Arquivos científicos e dados brutos        |
| Ator primário          | Pesquisador                                |
| Aplicação              | F1 estrutura / F3 operação                 |
| Entidades/contratos v2 | DataFile; DataFileVersion; RetentionPolicy |
| Status da auditoria    | Alterado                                   |

**Requisito:** O sistema deve receber, validar, versionar e armazenar arquivos científicos e evidências vinculados a entidades canônicas, mantendo integridade, acesso, retenção e proveniência sem sobrescrita silenciosa.

Critérios de aceitação:

1\. Validar tamanho, MIME, extensão e política de formato.

2\. Calcular checksum e armazenar o binário exclusivamente no Object Storage.

3\. Registrar URI, versão do objeto, tamanho, criptografia, owner, retenção, acesso e vínculos canônicos no MongoDB.

4\. Criar DataFileVersion para substituições, preservando checksum e versão anteriores.

5\. Vincular arquivos a espécime, consentimento, aprovação, ensaio, estudo, dataset, workflow ou outra entidade aplicável.

6\. Auditar upload, acesso, criação de versão, remoção lógica e destinação.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF008 - Relatórios

| **Atributo**           | **Definição**                             |
|------------------------|-------------------------------------------|
| Módulo                 | Relatórios                                |
| Ator primário          | Coordenador                               |
| Aplicação              | F1 estrutura / F3 operação                |
| Entidades/contratos v2 | AccessPolicy; DatasetSnapshot; AuditEvent |
| Status da auditoria    | Mantido com auditoria de coerência        |

**Requisito:** O sistema deve gerar relatórios operacionais, gerenciais, científicos e de auditoria conforme as permissões do usuário, com filtros dinâmicos e exportações controladas.

Critérios de aceitação:

1\. Aplicar filtros por período, coleção, tipo, origem, estado e localização.\
2. Restringir os dados conforme AccessPolicy, papel e consentimento.\
3. Pseudonimizar ou omitir dados identificadores quando necessário.\
4. Exportar somente nos formatos habilitados.\
5. Registrar o evento de exportação.\
6. Permitir a criação de novos modelos de relatório sem depender de uma lista fixa.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF009 - Telemetria e monitoramento ambiental

| **Atributo** | **Definição** |
|----|----|
| Módulo | Telemetria e monitoramento ambiental |
| Ator primário | Sistema |
| Aplicação | F1 estrutura / F2 perfis / F3 operação |
| Entidades/contratos v2 | TelemetryReading; TelemetryDatastream; TelemetryIngestionEvent; TelemetryValidationIssue; SpecimenContainerAssignment; ContainerPositionAssignment; RackLocationAssignment; TelemetryExposureSummary; EnvironmentalExcursion |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve ingerir, validar e persistir medições ambientais idempotentes no InfluxDB, correlacioná-las temporalmente a equipamentos, locais e espécimes e produzir evidências derivadas reproduzíveis.

Critérios de aceitação:

1\. Persistir todos os campos de TelemetryReading exclusivamente no InfluxDB; sensorId, equipmentId, storageLocationId e thresholdProfileId referenciam mestres no MongoDB sem deslocar a autoridade da leitura.

2\. Exigir telemetryReadingId, sourceEventId, idempotencyKey, payloadHash, schemaVersion e canonicalModelReleaseId.

3\. Distinguir observedAt, receivedAt e persistedAt em UTC e registrar clockStatus.

4\. Vincular a leitura a TelemetryDatastream, Device e StorageLocation aprovados.

5\. Associar a exposição ao Specimen somente por the normalized SpecimenContainerAssignment, ContainerPositionAssignment and RackLocationAssignment chain e pelo intervalo semiaberto \[placedAt, removedAt).

6\. Produzir TelemetryExposureSummary com janela, cobertura, contagem, estatísticas, excursões, hashes do conjunto/consulta e versão de cálculo.

7\. Detectar lacunas, valores inválidos, clock drift e excursões; rejeitar ou quarentenar sem preencher ausência como zero.

8\. Proibir PII na telemetria e impedir projeção de TelemetryReading bruto no Neo4j.

9\. Aceitar MQTT, HTTPS ou adaptador homologado diretamente no contrato de ingestão, sem autoridade paralela.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF010 - TCLE específico, amplo, escalonado e dinâmico

| **Atributo** | **Definição** |
|----|----|
| Módulo | TCLE específico, amplo, escalonado e dinâmico |
| Ator primário | Participante / Representante / Sistema |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | ConsentTemplate; Consent; ConsentPermission; ConsentDecisionEvent; ConsentRevocation; ConsentAuthorizationDecision; ConsentCommunicationEvent |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve gerenciar ConsentTemplate imutável e versionado, Consent e permissões granulares, distinguindo consentimento specific, broad, tiered e dynamic e preservando decisões, comunicações, supersessões e revogações sem sobrescrita.

Critérios de aceitação:

1\. Versionar ConsentTemplate com idioma, jurisdição, aprovação ética, documento, checksum, vigência e supersessão.

2\. Vincular cada Consent à versão exata apresentada e ao participante pseudonimizado.

3\. Registrar permissões computáveis para finalidade, compartilhamento, uso comercial, retorno de resultados, contato futuro, transferência e restrições aplicáveis.

4\. Registrar canal, signatário, papel, autenticação, instante, evidência e hash em ConsentDecisionEvent append-only.

5\. Calcular o estado vigente por histórico e supersessão, sem sobrescrever manifestações anteriores.

6\. Registrar revogação com escopo e efeito prospectivo, preservando histórico, usos anteriores e obrigações legais de retenção.

7\. Produzir ConsentAuthorizationDecision com permit, deny ou review_required, regras e justificativas.

8\. Registrar comunicações e eventos de outbox aplicáveis.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF011 - Interoperabilidade HL7 FHIR R4

| **Atributo** | **Definição** |
|----|----|
| Módulo | Interoperabilidade HL7 FHIR R4 |
| Ator primário | Sistema |
| Aplicação | F1 estrutura / F2 perfis e mappings / F3 intercâmbio |
| Entidades/contratos v2 | InteroperabilityMappingRelease; FHIRProfileRegistry; IdentifierNamespaceRegistry; Patient; Specimen; Consent; Observation; DiagnosticReport; Provenance; AuditEvent; DocumentReference; ResearchStudy |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve importar e exportar representações HL7 FHIR R4 por mappings versionados entre o modelo canônico e os recursos aplicáveis, mantendo FHIR exclusivamente como fronteira de interoperabilidade.

Critérios de aceitação:

1\. Validar FHIR 4.0.1, estrutura, perfil, identifier systems e campos obrigatórios.

2\. Persistir InteroperabilityMappingRelease no MongoDB com release canônica, versão FHIR, guia e versão, jurisdição, perfis, recursos, namespaces, terminologias, URI/hash do mapping, relatório de conformidade, cobertura, perdas de round-trip, aprovação, vigência e supersessão.

3\. Governar identifier.system internos sob https://bioadvanced.dev/fhir/NamingSystem/ por IdentifierNamespaceRegistry.

4\. Mapear Patient, Specimen, Consent, Observation, DiagnosticReport, Provenance, AuditEvent, DocumentReference e ResearchStudy quando aplicável.

5\. Preservar identificadores canônicos, proveniência, configuração e versão do mapping.

6\. Registrar campos não mapeados e limitações de round-trip sem forçar equivalência.

7\. Garantir que serializadores e adaptadores não realizem persistência operacional nem escrita direta no MongoDB ou Neo4j.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF012 - Auditoria e integridade criptográfica

| **Atributo**           | **Definição**                                 |
|------------------------|-----------------------------------------------|
| Módulo                 | Auditoria e integridade criptográfica         |
| Ator primário          | Sistema                                       |
| Aplicação              | Transversal                                   |
| Entidades/contratos v2 | AuditEvent; MerkleRoot; CanonicalModelRelease |
| Status da auditoria    | Alterado                                      |

**Requisito:** O sistema deve registrar AuditEvent append-only e verificável, incluindo ator pseudonimizado, finalidade, política, correlação, alvo, resultado, versão canônica e integridade criptográfica.

Critérios de aceitação:

1\. Registrar ator pseudonimizado, finalidade, policyVersion, ação, alvo, resultado, occurredAt, recordedAt e correlationId.

2\. Registrar canonicalModelReleaseId e configuração efetiva quando aplicável.

3\. Calcular canonicalEventHash e preservar previousEventHash quando houver encadeamento.

4\. Permitir consolidação por MerkleRoot sem alterar eventos.

5\. Impedir alteração e exclusão pela aplicação.

6\. Detectar divergência ou adulteração.

7\. Sanitizar payloads e impedir segredos ou PII desnecessária.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF013 - Backup e restauração

| **Atributo**           | **Definição**                      |
|------------------------|------------------------------------|
| Módulo                 | Backup e restauração               |
| Ator primário          | Administrador                      |
| Aplicação              | F1 estrutura / transversal         |
| Entidades/contratos v2 | SecurityConfiguration; AuditEvent  |
| Status da auditoria    | Mantido com auditoria de coerência |

**Requisito:** O sistema deve permitir ao Administrador configurar, executar, acompanhar e validar rotinas de backup e restauração.

Critérios de aceitação:

1\. Exibir estado, data e resultado das execuções.\
2. Permitir execução manual autorizada.\
3. Registrar checksum e evidência de conclusão.\
4. Permitir teste controlado de restauração.\
5. Auditar alterações da política de backup.\
6. Aplicar frequência, retenção, criptografia, RPO e RTO definidos nos requisitos não funcionais.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF014 - Políticas e configuração governada

| **Atributo** | **Definição** |
|----|----|
| Módulo | Políticas e configuração governada |
| Ator primário | Administrador autorizado |
| Aplicação | F1 estrutura / transversal |
| Entidades/contratos v2 | ConfigurationProfile; ConfigurationRelease; ConfigurationValidationRun; GovernanceInvariantCatalog; AccessPolicy; RetentionPolicy |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve permitir a administração de políticas e pontos configuráveis somente por perfis e releases versionados, sem permitir override de invariantes arquiteturais ou de governança.

Critérios de aceitação:

1\. Catalogar tipo, escopo, valores permitidos, defaults, dependências, owner e vigência de cada configuração.

2\. Criar nova ConfigurationRelease para cada alteração; impedir edição de release ativa.

3\. Executar validações estrutural, semântica, de dependência, conflito, segurança e invariantes antes da ativação.

4\. Bloquear release inválida e permitir rollback governado.

5\. Versionar AccessPolicy, RetentionPolicy e demais políticas aplicáveis.

6\. Impedir que configuração altere identidade canônica, autoridade dos stores, consentimento, outbox, auditoria, fronteira FHIR ou admissibilidade do RCS.

7\. Registrar proposta, aprovação, ativação, rollback e tentativa de violação.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF015 - Alertas e notificações

| **Atributo** | **Definição** |
|----|----|
| Módulo | Alertas e notificações |
| Ator primário | Sistema |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | ConsentCommunicationEvent; AuditEvent; EnvironmentalExcursion |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve gerar notificações multicanal a partir de eventos versionados de segurança, telemetria, consentimento, qualidade e governança, incluindo comunicações de consentimento quando aplicáveis.

Critérios de aceitação:

1\. Criar notificação a partir de regra e ConfigurationRelease identificáveis.

2\. Enviar somente pelos canais habilitados e registrar tentativas, falhas, entrega e confirmação.

3\. Aplicar escalonamento quando configurado.

4\. Não incluir dados pessoais, clínicos, genéticos ou científicos desnecessários.

5\. Vincular a comunicação ao evento originador, à finalidade e ao consentimento quando aplicável.

6\. Aplicar os tempos máximos definidos nos RNFs.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF016 - Identificação física e leitura unificada

| **Atributo** | **Definição** |
|----|----|
| Módulo | Identificação física e leitura unificada |
| Ator primário | Técnico / Sistema |
| Aplicação | F1 estrutura / F2 homologação / F3 operação |
| Entidades/contratos v2 | Container; StorageRack; StoragePosition; ContainerPositionAssignment; SpecimenContainerAssignment; LabelIdentifier; LabelTemplate; DeviceProfile; IdentificationPolicy; LabelPrintEvent; ScanEvent; UnifiedIdentifierResolverContract; PhysicalIdentificationValidationProtocol |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve distinguir e gerenciar recipientes, posições, racks, identificadores e espécimes, incluindo o ciclo de leitura e as atribuições temporais, sem substituir identidades canônicas.

Critérios de aceitação:

1\. Tratar o Data Matrix aplicado ao tubo como identificador de Container; tubo vazio não cria nem implica Specimen.

2\. Modelar rack, posição e recipiente separadamente; para o fixture aprovado, preparar grade 8 por 12 com 96 posições únicas.

3\. Registrar posição e conteúdo por atribuições temporais append-only, bloqueando ocupações ativas incompatíveis.

4\. Registrar identifierOrigin, carrierPlacement e immutableAtSource; exigir emissão, template e lote somente quando aplicáveis a identificadores institucionais.

5\. Suportar Data Matrix, Code 128 e QR Code conforme política; confirmar instrumentalmente a simbologia do código linear do rack.

6\. Limitar o resolvedor a capturar, decodificar, normalizar e resolver; manter autorização da operação no backend.

7\. Executar o protocolo ex ante somente quando PhysicalIdentificationValidationProtocol.approvalStatus=approved_for_execution, com tubos vazios, dados sintéticos e evidências versionadas; esse status documental não constitui resultado do ensaio.

8\. Bloquear nome, CPF, prontuário, diagnóstico, dado genético e conteúdo pessoal ou clínico desnecessário.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF017 - Equipamentos e armazenamento

| **Atributo** | **Definição** |
|----|----|
| Módulo | Equipamentos e armazenamento |
| Ator primário | Coordenador |
| Aplicação | F1 estrutura / F2 perfis / F3 operação |
| Entidades/contratos v2 | Device; DeviceProfile; DeviceRegistration; DeviceCommunicationProfile; StorageLocation; SpecimenContainerAssignment; ContainerPositionAssignment; RackLocationAssignment; TelemetryDatastream |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve gerenciar equipamentos, dispositivos, sensores, perfis homologados, comunicação e a topologia temporal de armazenamento dos espécimes.

Critérios de aceitação:

1\. Representar a hierarquia física configurada sem alterar os contratos canônicos.

2\. Impedir ocupação simultânea incompatível da mesma posição.

3\. Vincular the normalized SpecimenContainerAssignment, ContainerPositionAssignment and RackLocationAssignment chain explicitamente a Specimen, StorageLocation e Device.

4\. Usar \[placedAt, removedAt) e impedir sobreposição incompatível para o mesmo espécime.

5\. Vincular TelemetryDatastream a sensor, equipamento, local, propriedade, unidade e validade.

6\. Registrar instalação, movimentação, homologação e retirada.

7\. Manter credencial fora do payload canônico, registrando somente credentialReference opaca.

8\. Preservar histórico e bloquear local ou dispositivo indisponível, interditado ou não homologado.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF018 - Qualificação pré-analítica - SPREC e RCS

| **Atributo** | **Definição** |
|----|----|
| Módulo | Qualificação pré-analítica - SPREC e RCS |
| Ator primário | Sistema |
| Aplicação | F1 estrutura e regras / F2 releases / F3 avaliação |
| Entidades/contratos v2 | SpecimenPreanalytics; RCSAssessment; RCSInputSnapshot; RCSPreanalyticalAxisInput; RCSGovernanceEvidenceSnapshot; RCSRulePackage; SPRECMappingRelease; RCSValidationStudy |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve registrar as entradas completas e produzir RCSAssessment determinístico, contextual e integralmente recalculável por finalidade, analito, família de ensaio e protocolo, sem criar qualidade absoluta no Specimen.

Critérios de aceitação:

1\. Manter SPREC 2.0 como baseline atual do RCS, com mapping versionado e checksum; tratar SPREC 4.0 somente como roadmap.

2\. Permitir zero ou múltiplos RCSAssessment por Specimen e exigir contexto de uso, analito, família de ensaio e protocolo/version.

3\. Criar exatamente um RCSInputSnapshot imutável e resolvível por avaliação, com ID, URI, hash, schemaVersion, fontes e instante.

4\. Registrar matrix explicitamente como fluid ou solid, materialTypeCode e matrixMappingReleaseId; não inferir a matriz por regra não versionada.

5\. Para fluid, exigir exatamente P_pre, P_cent1, P_cent2, P_post e P_store; para solid, P_warm, P_cold, P_fix, P_fixTime e P_store.

6\. Em cada eixo, preservar sprecCode observado, severity entre 0 e 1, maximumWeight, weightedPenalty, mapping release, status de resolução, contexto aplicável e evidências.

7\. Preservar individualmente metadataComplete, terminologyValid, traceabilityOk, monitoringOk, documentationOk e semanticCompatible, com referências, versão/checksum das regras e resultado agregado.

8\. Calcular P_bio somente após gate aprovado; derivar score=100-P_bio, scoreBasedGrade, finalGrade, gradeRoute e routeReasons.

9\. Diante de ausência crítica, unknown, invalid, incompatibilidade ou Not scored, impedir penalidade zero automática e a rota baseada em escore.

10\. Preservar pacote/checksum, ambiente, instante e justificativas; tornar entradas congeladas e resultados não editáveis.

11\. Não representar o RCS como validade clínica, qualidade analítica do ensaio ou medida universal.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF019 - Quarentena lógica

| **Atributo** | **Definição** |
|----|----|
| Módulo | Quarentena lógica |
| Ator primário | Sistema |
| Aplicação | F1 estrutura / F2-F3 execução |
| Entidades/contratos v2 | QuarantineAction; Specimen; Nonconformance; ReferenceImportIssue; InvariantViolation |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve aplicar quarentena lógica orientada a eventos quando o espécime, lote, local, configuração, referência ou processo apresentar condição incompatível com uso, processamento, distribuição ou promoção.

Critérios de aceitação:

1\. Acionar quarentena por revogação relevante, excursão, falha de governança, não conformidade, referência inválida ou violação de invariante.

2\. Representar Specimen.specimenStatus como quarantined, sem alterar quantityStatus.

3\. Bloquear retirada, processamento, envio, uso e promoção incompatíveis.

4\. Registrar causa, evento, regra, instante, correlação e evidência.

5\. Permitir liberação somente por ator autorizado, regra satisfeita e evidência.

6\. Auditar a decisão e emitir outbox quando houver projeção permitida.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF020 - Metadados institucionais, regimes e MIABIS

| **Atributo** | **Definição** |
|----|----|
| Módulo | Metadados institucionais, regimes e MIABIS |
| Ator primário | Coordenador |
| Aplicação | F1 estrutura / F2 mapping / F3 operação |
| Entidades/contratos v2 | Organization; Network; Biobank; Collection; BiobankGovernanceContext; BiorepositoryContext; CollectionGovernanceApproval; CollectionGovernanceEvent |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve gerenciar organizações, redes, biobancos, coleções e recursos de pesquisa, distinguindo biobank e biorepository por regime de governança computável e mantendo mappings MIABIS versionados sem perda silenciosa das regras nacionais.

Critérios de aceitação:

1\. Cadastrar Organization, Network, Biobank, Collection e associações previstas.

2\. Exigir governanceRegime e contexto exclusivo compatível.

3\. Registrar aprovações, vigência, CAAE, instituição e responsabilidades quando aplicáveis.

4\. Impedir conversão silenciosa de regime; registrar evento, justificativa e aprovação.

5\. Exportar Biobank e Collection pelo mapping MIABIS aprovado.

6\. Preservar no modelo canônico regime, CAAE, aprovação, custódia e demais extensões nacionais.

7\. Registrar relatório de perda de round-trip.

8\. Não declarar conformidade plena ou certificação sem avaliação formal independente.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF021 - Estudos, protocolos, ética e custódia

| **Atributo** | **Definição** |
|----|----|
| Módulo | Estudos, protocolos, ética e custódia |
| Ator primário | Coordenador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | Study; Protocol; CollectionGovernanceApproval; CustodianshipAssignment |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve gerenciar estudos, protocolos, versões, pesquisadores, instituições, aprovações éticas e atribuições temporais de custódia compatíveis com o regime da coleção.

Critérios de aceitação:

1\. Gerar studyId e protocolId e versionar o protocolo.

2\. Registrar CAAE, documento, checksum, autoridade, vigência e estado da aprovação.

3\. Para biorrepositório, exigir estudo, protocolo, versão, instituição, pesquisador e prazo ou condição de encerramento.

4\. Registrar custodianOrganizationId, responsibleInvestigatorId, local e período.

5\. Garantir uma atribuição ativa compatível por espécime/localidade.

6\. Impedir operação com aprovação, protocolo, contexto ou custódia inativos/incompatíveis.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF022 - Foundation Data Pipeline

| **Atributo** | **Definição** |
|----|----|
| Módulo | Foundation Data Pipeline |
| Ator primário | Sistema / DevOps |
| Aplicação | Fase 1 |
| Entidades/contratos v2 | FoundationDataRun; CanonicalModelRelease; ConfigurationValidationRun; GovernanceInvariantCatalog; ReadinessReport |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve executar o Foundation Data Pipeline como job one-shot da Fase 1, derivado da release canônica vigente, para preparar integralmente estruturas, contratos, configurações, invariantes e controles necessários às Fases 2 e 3.

Critérios de aceitação:

1\. Ler e validar CanonicalModelRelease, dicionário, schemas, enums, mappings, policies e checksums; a release final v2.0.0 contém 1644 elementos, incluindo os 929 históricos.

2\. Preparar entidades, objetos, referências, cardinalidades, índices, restrições, configurações, catálogos de invariantes, importadores, quarentena, outbox, auditoria, testes e rollback.

3\. Preparar os contratos e gates de RCSInputSnapshot, eixos pré-analíticos, evidências de governança e recálculo integral.

4\. Executar depois dos health checks e antes das APIs/workers dependentes, separado do startup interno da aplicação.

5\. Registrar FoundationDataRun com release, checksums, migrationPlan, etapas, checkpoints, dry-run, apply, verify, rollback e relatório.

6\. Validar ConfigurationRelease antes da ativação.

7\. Preparar mecanismos da Fase 2 sem popular referências.

8\. Não criar participantes, identidades, consentimentos, espécimes, telemetria, arquivos, estudos, ensaios ou workflows operacionais.

9\. Gerar ReadinessReport e bloquear promoção diante de P0 não tratado, violação de invariante ou erro estrutural fatal.

10\. Preservar rollback para release anterior e evidência append-only.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF023 - Outbox e projeção Neo4j

| **Atributo** | **Definição** |
|----|----|
| Módulo | Outbox e projeção Neo4j |
| Ator primário | Sistema |
| Aplicação | F1 estrutura / F2-F3 operação |
| Entidades/contratos v2 | GraphProjectionOutboxEvent; GraphProjectionCheckpoint; SpecimenContainerAssignment; ContainerPositionAssignment; RackLocationAssignment; TelemetryExposureSummary; CanonicalModelRelease; AuditEvent |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve persistir o agregado canônico e seu GraphProjectionOutboxEvent na mesma transação MongoDB e atualizar o Neo4j exclusivamente por consumidor assíncrono, temporal, versionado e idempotente.

Critérios de aceitação:

1\. Registrar eventId, eventType/version, aggregateType/id/version, schemaVersion e canonicalModelReleaseId.

2\. Calcular payloadHash e idempotencyKey.

3\. Persistir agregado e evento na mesma transação MongoDB.

4\. Aplicar eventos por aggregateVersion e registrar GraphProjectionCheckpoint.

5\. Representar relações temporais por validTime=\[from,to) e transactionTime quando aplicável.

6\. Garantir Pi(Pi(G,o_k),o_k)=Pi(G,o_k), replay, rebuild e reconciliação.

7\. Processar com lease, retry, backoff e dead letter.

8\. Proibir dual-write e escrita direta de domínio no Neo4j.

9\. Não projetar identidade civil, PII nem TelemetryReading bruto; somente topologia, intervalos, excursões e resumos autorizados.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF024 - Solicitações de acesso e distribuição

| **Atributo** | **Definição** |
|----|----|
| Módulo | Solicitações de acesso e distribuição |
| Ator primário | Pesquisador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | AccessRequest; AccessPolicy; ConsentAuthorizationDecision; CollectionGovernanceApproval |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve registrar solicitações de acesso a dados ou espécimes e produzir decisão governada baseada em consentimento, finalidade, estudo/protocolo, política, aprovação e custódia.

Critérios de aceitação:

1\. Registrar solicitante, organização, estudo, protocolo, finalidade e itens solicitados.

2\. Avaliar ConsentPermission vigente, AccessPolicy, regime da coleção, aprovação, restrições e finalidade.

3\. Produzir permit, deny ou review_required com regras e justificativas.

4\. Registrar policyVersion, configurationReleaseId e instante da decisão.

5\. Vincular aprovação e vigência à disponibilização, remessa ou DispositionAction.

6\. Bloquear acesso expirado, negado, revogado, incompatível ou sob revisão.

7\. Auditar e correlacionar a decisão à operação efetiva.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF025 - Ensaios, reagentes e não conformidades

| **Atributo**           | **Definição**                          |
|------------------------|----------------------------------------|
| Módulo                 | Ensaios, reagentes e não conformidades |
| Ator primário          | Técnico                                |
| Aplicação              | F1 estrutura / F3 operação             |
| Entidades/contratos v2 | Assay; ReagentLot; Nonconformance      |
| Status da auditoria    | Mantido com auditoria de coerência     |

**Requisito:** O sistema deve gerenciar ensaios, lotes de reagentes, equipamentos, controles, não conformidades e ações corretivas.

Critérios de aceitação:

1\. Vincular espécimes, protocolo, operador e laboratório.\
2. Registrar lotes e validade de reagentes.\
3. Registrar equipamentos utilizados.\
4. Registrar controles do ensaio.\
5. Abrir não conformidade e ação corretiva.\
6. Preservar causa, ação, responsável e verificação de eficácia.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF026 - Retenção, destinação e fechamento

| **Atributo** | **Definição** |
|----|----|
| Módulo | Retenção, destinação e fechamento |
| Ator primário | Coordenador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | RetentionPolicy; DispositionAction; Specimen; OperationalStateDecision |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve aplicar RetentionPolicy e controlar DispositionAction separadamente do estado operacional do espécime, preservando legal hold, autorização, execução e evidências.

Critérios de aceitação:

1\. Vincular classes de dado e espécimes à política versionada, jurisdição, base, prazo e evento inicial.

2\. Aplicar legal hold e revisão obrigatória conforme a política.

3\. Registrar action igual a transfer, return, destroy ou preserve.

4\. Controlar actionStatus como planned, approved, executed, cancelled ou blocked.

5\. Exigir autorização, responsável, instante e evidência para execução.

6\. Impedir destruição ou transferência incompatível com consentimento, ética, custódia ou legal hold.

7\. Aplicar specimenStatus=closed somente após consumo total validado ou destinação autorizada e executada, com auditoria.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF027 - Workflows e dados ômicos

| **Atributo** | **Definição** |
|----|----|
| Módulo | Workflows e dados ômicos |
| Ator primário | Pesquisador |
| Aplicação | F1 estrutura / F3 operação |
| Entidades/contratos v2 | WorkflowRun; DatasetSnapshot; DataFile; OmicsQualification; DeidentificationProcess |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve registrar workflows científicos reproduzíveis e a proveniência ponta a ponta de dados, arquivos, snapshots e qualificações específicas de ensaio.

Critérios de aceitação:

1\. Registrar workflow, versão, código/container digest, dependências, parâmetros, hardware, seed e ambiente.

2\. Vincular DatasetSnapshot e manifestos imutáveis de entrada e saída.

3\. Registrar versões/checksums de arquivos, referências e ferramentas.

4\. Preservar lineage fonte→ingestão→transformação→snapshot→resultado.

5\. Registrar qualificação ômica ou QC como específica ao ensaio, separada do RCS.

6\. Registrar falha, retomada e derivação.

7\. Não ativar ModelArtifact, ModelCard ou modelos de IA neste requisito.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF028 - Importação de dados de referência

| **Atributo** | **Definição** |
|----|----|
| Módulo | Importação de dados de referência |
| Ator primário | Administrador / Sistema |
| Aplicação | F1 mecanismos / F2 população |
| Entidades/contratos v2 | ReferenceDatasetRelease; ReferenceImportRun; ReferenceImportIssue; ReferenceCoverageManifest; TerminologyConcept; TerminologyRelation |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve importar, validar, versionar e promover dados de referência aprovados na Fase 2 por releases explícitas, preservando origem, licença, cobertura, qualidade e rollback.

Critérios de aceitação:

1\. Registrar origem, versão, licença, URI, checksum, formato, parserVersion e mappingVersion antes da carga.

2\. Adquirir somente fontes aprovadas e preservar o asset no Object Storage quando aplicável.

3\. Executar staging, parsing, normalização, validação, quarentena e checkpoint.

4\. Registrar cada execução e cada issue sem descarte ou correção silenciosa.

5\. Vincular conceitos e relações à release de origem.

6\. Gerar ReferenceCoverageManifest com assets/endpoints, expectedCount, obtainedCount e exclusões justificadas.

7\. Executar DataQualityAssessment e bloquear promoção com licença, integridade, cobertura ou erro fatal inválidos.

8\. Promover release explicitamente, publicar outbox e reconciliar projeção.

9\. Manter rollback para release anterior.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RF029 - Ingestão operacional e científica

| **Atributo** | **Definição** |
|----|----|
| Módulo | Ingestão operacional e científica |
| Ator primário | Sistema / Ator autorizado |
| Aplicação | Fase 3 |
| Entidades/contratos v2 | Participant; Consent; Specimen; TelemetryReading; TelemetryIngestionEvent; DatasetSnapshot; DataQualityAssessment; MissingDataReason; WorkflowRun |
| Status da auditoria | Alterado |

**Requisito:** O sistema deve receber, validar e persistir na Fase 3 dados operacionais, clínicos, laboratoriais, científicos, telemétricos e ômicos autorizados, usando exclusivamente as estruturas e releases preparadas nas fases anteriores.

Critérios de aceitação:

1\. Validar payload contra CanonicalModelRelease, schema, cardinalidade, nomes canônicos e ConfigurationRelease vigentes.

2\. Exigir origem, sourceRecordId, temporalidade, ator, finalidade, política, consentimento e proveniência conforme aplicabilidade.

3\. Usar referências ativas; encaminhar códigos ou registros inválidos para revisão/staging/quarentena sem correção silenciosa.

4\. Persistir documentos operacionais no MongoDB, TelemetryReading integral no InfluxDB, binários no Object Storage e dados transitórios somente no Redis.

5\. Deduplicar telemetria e preservar tempos, hashes, datastream, local e correlação; MQTT, HTTPS e adaptadores aprovados convergem para o mesmo contrato canônico.

6\. Emitir outbox na mesma transação MongoDB e projetar relações autorizadas no Neo4j sem PII nem leitura bruta.

7\. Preservar missingness por reasonCode, sem converter ausência em zero.

8\. Permitir DatasetSnapshot, LabelDefinition, FeatureDefinition, CohortDefinition e DatasetPartition somente em uso científico autorizado e versionado.

9\. Manter ModelArtifact, ModelCard, ModelEvaluationRun, AlgorithmicDecisionReview e ModelMonitoringEvent inativos até projeto futuro formal.

10\. Auditar decisões, ingestões, rejeições, transformações e acessos.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

# 6. Matriz não funcional resumida

| **ID** | **Categoria** | **Requisito** | **Prioridade** | **Auditoria** |
|----|----|----|----|----|
| RNF001 | Desempenho | Tempo de resposta da interface | Alta | Mantido com auditoria de coerência |
| RNF002 | Desempenho | Latência na consulta e resolução de identificadores | Alta | Alterado |
| RNF003 | Disponibilidade | Disponibilidade do serviço | Alta | Mantido com auditoria de coerência |
| RNF004 | Resiliência | Resiliência da coleta remota de telemetria | Crítica | Alterado |
| RNF005 | Usabilidade | Curva de aprendizado | Alta | Mantido com auditoria de coerência |
| RNF006 | Suportabilidade | Documentação técnica e de usuário | Alta | Alterado |
| RNF007 | Privacidade e LGPD | Segregação da identidade e pseudonimização | Crítica | Alterado |
| RNF008 | Segurança | Autorização baseada em papéis, permissões e escopo | Crítica | Alterado |
| RNF009 | Auditoria e rastreabilidade | Registro imutável e verificável de auditoria | Crítica | Alterado |
| RNF010 | Confiabilidade | Backup, recuperação e continuidade | Crítica | Mantido com auditoria de coerência |
| RNF011 | Qualidade de dados | Integridade, qualidade e missingness | Crítica | Alterado |
| RNF012 | Conformidade | Apoio aos processos alinhados à ISO 20387 | Alta | Mantido com auditoria de coerência |
| RNF013 | Conformidade e segurança | Gestão de segurança alinhada à ISO/IEC 27001 | Alta | Mantido com auditoria de coerência |
| RNF014 | Portabilidade | Conteinerização e reprodutibilidade de ambientes | Alta | Alterado |
| RNF015 | Observabilidade | Monitoramento de aplicação, infraestrutura e filas | Alta | Alterado |
| RNF016 | Escalabilidade | Escalabilidade e autoridade poliglota | Alta | Alterado |
| RNF017 | Qualidade de software | Automação de testes e gates de integração | Crítica | Alterado |
| RNF018 | Validação | Validação em múltiplas camadas | Crítica | Alterado |
| RNF019 | Resiliência de eventos | Outbox durável, retries e reconciliação | Crítica | Alterado |
| RNF020 | Criptografia | Proteção criptográfica e gestão de segredos | Crítica | Mantido com auditoria de coerência |
| RNF021 | Segurança de sessão | Ciclo de vida seguro de sessões e tokens | Crítica | Mantido com auditoria de coerência |
| RNF022 | Privacidade e retenção | Minimização, retenção e destinação de dados | Crítica | Alterado |
| RNF023 | Evolução do modelo | Versionamento de schemas e migrações controladas | Crítica | Alterado |
| RNF024 | Interoperabilidade | FHIR R4 como fronteira sem efeitos colaterais | Crítica | Alterado |
| RNF025 | Temporalidade | Consistência de timestamps e sincronização de relógios | Alta | Alterado |
| RNF026 | Desempenho de alertas | Latência e confiabilidade das notificações críticas | Alta | Mantido com auditoria de coerência |
| RNF027 | Acessibilidade e compatibilidade | Acesso inclusivo e compatibilidade de interface | Média | Mantido com auditoria de coerência |
| RNF028 | Manutenibilidade | Modularidade, qualidade interna e governança arquitetural | Crítica | Alterado |
| RNF029 | Segurança de arquivos | Integridade e proteção do Object Storage | Alta | Alterado |
| RNF030 | Reprodutibilidade | Proveniência computacional de workflows e dados ômicos | Alta | Alterado |
| RNF031 | Governança e ciclo de vida | Foundation integral, versionada e governada | P0 | Alterado |
| RNF032 | Governança e ciclo de vida | Proveniência, cobertura, promoção e rollback de referências | P0 | Alterado |

# 7. Requisitos não funcionais RNF001-RNF032

## RNF001 - Tempo de resposta da interface

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Desempenho                                 |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** A interface deve responder às interações ordinárias do usuário em até 2 segundos no percentil 95, considerando o ambiente de referência documentado.

Critérios de aceitação:

1\. Cliques, navegação e abertura de formulários simples atendem ao limite estabelecido.

2\. Operações com duração superior a 500 ms exibem indicador de processamento.

3\. Downloads, importações extensas e indisponibilidade de serviços externos são medidos separadamente.

4\. O resultado é verificado por testes E2E e telemetria do frontend.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF002 - Latência na consulta e resolução de identificadores

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Desempenho                                 |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Consultas simples por identificadores canônicos e a resolução de identificadores físicos devem retornar em até 3 segundos no percentil 95 com pelo menos 100.000 registros operacionais no ambiente de referência.

Critérios de aceitação:

1\. Pesquisar por specimenId, participantId pseudonimizado, accessionIdentifier ou LabelIdentifier indexado.

2\. Resolver encodedValue sem autorizar a operação no componente de captura.

3\. Paginar listagens e evitar varredura integral.

4\. Registrar plano de execução, índices e perfil de carga.

5\. Avaliar consultas gráficas e relatórios analíticos em cenários próprios.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF003 - Disponibilidade do serviço

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Disponibilidade                            |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** A plataforma deve operar continuamente, com disponibilidade mensal alvo de pelo menos 99,5%, desconsideradas janelas de manutenção previamente comunicadas.

Critérios de aceitação:

1\. O tempo total de manutenção programada não excede 4 horas por mês.

2\. Indisponibilidades são registradas com início, término, causa e impacto.

3\. Serviços críticos possuem health checks e mecanismos de reinicialização controlada.

4\. A disponibilidade é calculada e publicada em relatório operacional.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF004 - Resiliência da coleta remota de telemetria

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Resiliência                                |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** O subsistema de monitoramento ambiental deve preservar medições durante falhas temporárias de conectividade e sincronizá-las posteriormente sem perda ou duplicação lógica.

Critérios de aceitação:

1\. Manter buffer durável na borda com sourceEventId, observedAt, deviceId, sequenceNumber quando disponível e payloadHash.

2\. Sincronizar por telemetryReadingId/idempotencyKey e confirmar somente após persistência no InfluxDB.

3\. Preservar ordem temporal possível sem confiar exclusivamente no relógio do dispositivo.

4\. Detectar lacunas, duplicatas, clock drift e mensagens corrompidas.

5\. Registrar receivedAt e persistedAt no servidor.

6\. Suportar MQTT, HTTPS ou adaptador homologado diretamente no contrato canônico.

7\. Não armazenar PII no dispositivo, payload ou buffer.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF005 - Curva de aprendizado

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Usabilidade                                |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** Usuários com conhecimento básico de informática devem executar as operações essenciais após treinamento de até 4 horas.

Critérios de aceitação:

1\. Pelo menos 80% dos participantes do teste de usabilidade concluem cadastro, consulta e movimentação sem erro crítico.

2\. Mensagens de erro indicam o problema e a ação necessária.

3\. A terminologia da interface é consistente com o domínio do biobanco.

4\. Operações irreversíveis exigem confirmação explícita.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF006 - Documentação técnica e de usuário

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Suportabilidade                            |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A plataforma deve possuir documentação versionada e coerente com CanonicalModelRelease, dicionário, requisitos, mappings, pipeline, schemas e testes.

Critérios de aceitação:

1\. Disponibilizar guias técnicos e de usuário por papel.

2\. Documentar instalação, configuração, backup, restauração, APIs, eventos, outbox e troubleshooting.

3\. Referenciar o modelo canônico v2.0.0 e registrar changelog e migração.

4\. Documentar as três fases, gates, releases de referência, ingestão e rollback.

5\. Documentar limitações de mappings e itens futuros condicionados.

6\. Não conter segredos, credenciais ou dados pessoais reais.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF007 - Segregação da identidade e pseudonimização

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Privacidade e LGPD                         |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A identidade civil deve permanecer segregada e criptografada, enquanto registros científicos, grafos, etiquetas e exportações usam identificadores pseudonimizados ou opacos.

Critérios de aceitação:

1\. Participant utiliza participantId canônico; dados civis ficam em ParticipantIdentity protegido.

2\. Somente serviço autorizado resolve a identidade para finalidade legítima e auditada.

3\. Não projetar ParticipantIdentity ou PII para Neo4j.

4\. Proibir nome, CPF, prontuário, diagnóstico, dado genético e dados clínicos desnecessários em etiquetas/códigos.

5\. Sanitizar logs, relatórios, notificações e exportações.

6\. Registrar DeidentificationProcess para datasets exportados quando aplicável.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF008 - Autorização baseada em papéis, permissões e escopo

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Segurança                                  |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** O controle de acesso deve ser aplicado no backend por papéis, permissões, finalidade, escopo, consentimento, regime de governança e políticas versionadas.

Critérios de aceitação:

1\. Aplicar deny by default.

2\. Usar códigos estáveis e rótulos localizados.

3\. Considerar organização, biobanco, coleção, estudo, protocolo e recurso.

4\. Registrar AccessPolicy/version, ConfigurationRelease e razões da decisão.

5\. Produzir permit, deny ou review_required quando houver avaliação de uso.

6\. Não considerar ocultação no frontend ou resolução de etiqueta como autorização.

7\. Invalidar cache/sessão quando papéis ou políticas exigirem.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF009 - Registro imutável e verificável de auditoria

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Auditoria e rastreabilidade                |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Eventos críticos devem ser registrados em AuditEvent append-only, correlacionável, pesquisável e criptograficamente verificável.

Critérios de aceitação:

1\. Auditar autenticação, dados sensíveis, configuração, consentimento, custódia, etiqueta, acesso, RCS, referências, exportação e administração.

2\. Registrar ator pseudonimizado, finalidade, policyVersion, ação, alvo, resultado, occurredAt, recordedAt, correlationId e canonicalModelReleaseId.

3\. Sanitizar payloads e impedir segredos/PII desnecessária.

4\. Calcular canonicalEventHash e preservar previousEventHash quando aplicável.

5\. Permitir MerkleRoot sem modificar eventos.

6\. Impedir edição ou exclusão pela aplicação.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF010 - Backup, recuperação e continuidade

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Confiabilidade                             |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** A plataforma deve adotar estratégia de backup 3-2-1, com cópias criptografadas e restauração testada.

Critérios de aceitação:

1\. Há pelo menos três cópias, em duas tecnologias ou mídias, com uma cópia fora do ambiente principal.

2\. O RPO alvo dos dados operacionais é de até 24 horas.

3\. O RTO alvo para recuperação completa é de até 12 horas.

4\. A retenção mínima padrão é de 30 dias, ajustável por política e exigência legal.

5\. Testes de restauração são executados periodicamente e validados por checksum.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF011 - Integridade, qualidade e missingness

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Qualidade de dados                         |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Dados canônicos, configurações, releases e importações devem ser validados e avaliados por dimensões mensuráveis de qualidade antes da ativação ou promoção.

Critérios de aceitação:

1\. Validar IDs, campos, tipos, cardinalidades, enums, unidades, referências e regras condicionais.

2\. Rejeitar relações órfãs, posições duplicadas, transições inválidas e escritas em campos derivados.

3\. Usar DataQualityAssessment para completude, validade, consistência, unicidade, atualidade e proveniência.

4\. Representar ausência por MissingDataReason: unknown, not_collected, not_applicable, withheld ou error.

5\. Não converter ausência, unknown ou incompatibilidade em zero.

6\. Quarentenar registros inválidos sem correção silenciosa.

7\. Bloquear releases diante de erro fatal ou cobertura injustificada.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF012 - Apoio aos processos alinhados à ISO 20387

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Conformidade                               |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** O sistema deve apoiar processos de competência, rastreabilidade, qualidade e gestão de registros coerentes com os princípios aplicáveis da ISO 20387.

Critérios de aceitação:

1\. A linhagem do participante ao espécime, processamento, localização e destinação é recuperável.

2\. Métodos, equipamentos, não conformidades e evidências possuem histórico.

3\. A documentação mantém matriz de rastreabilidade entre requisitos e funcionalidades.

4\. O sistema não declara certificação ou conformidade formal sem avaliação institucional independente.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF013 - Gestão de segurança alinhada à ISO/IEC 27001

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Conformidade e segurança                   |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** A segurança da informação deve ser orientada por risco e por controles compatíveis com os princípios da ISO/IEC 27001.

Critérios de aceitação:

1\. Ativos, riscos, responsáveis e tratamentos são documentados.

2\. Há controles de acesso, gestão de incidentes, continuidade, backup, registro e revisão periódica.

3\. Exceções de segurança possuem aprovação, prazo e risco residual.

4\. O sistema não declara certificação ISO/IEC 27001 sem auditoria formal da organização.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF014 - Conteinerização e reprodutibilidade de ambientes

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Portabilidade                              |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Os componentes implantáveis e os jobs de pipeline devem ser conteinerizados, versionados e reproduzíveis sem tornar tecnologia de orquestração específica um invariante.

Critérios de aceitação:

1\. Usar artefatos declarativos com versão ou digest imutável.

2\. Manter configurações e segredos fora da imagem.

3\. Aplicar health checks, limites e privilégios mínimos.

4\. Usar a mesma família de artefatos entre ambientes.

5\. Manter Kubernetes opcional.

6\. Executar Foundation Data Pipeline como job one-shot separado do startup da API.

7\. Condicionar liberação de APIs/workers ao ReadinessReport.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF015 - Monitoramento de aplicação, infraestrutura e filas

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Observabilidade                            |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A plataforma deve produzir métricas, logs e rastreamento correlacionado para aplicação, persistências, filas, configurações, importações e gates.

Critérios de aceitação:

1\. Monitorar frontend, APIs, workers, MongoDB, Neo4j, InfluxDB, Redis, Object Storage e integrações.

2\. Alertar para indisponibilidade, latência, erros, recursos, filas e dead letter.

3\. Propagar traceId/correlationId.

4\. Manter logs observacionais separados do AuditEvent normativo.

5\. Monitorar FoundationDataRun, ConfigurationValidationRun, ReferenceImportRun, issues, cobertura, promoção, outbox e reconciliação.

6\. Distinguir falhas das Fases 1, 2 e 3.

7\. Permitir ferramentas equivalentes conforme configuração aprovada.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF016 - Escalabilidade e autoridade poliglota

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Escalabilidade                             |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Cada mecanismo de persistência deve escalar conforme sua classe de carga sem criar fonte canônica concorrente ou permitir dual-write.

Critérios de aceitação:

1\. MongoDB é fonte operacional e autoridade do outbox.

2\. Neo4j é projeção derivada temporal para relacionamentos e linhagem, reconstruível pelo outbox.

3\. InfluxDB é autoridade integral de TelemetryReading e séries temporais; referências aos mestres não transferem campos da leitura ao MongoDB.

4\. Object Storage contém binários; MongoDB contém seus metadados.

5\. Redis contém apenas cache, locks e dados transitórios.

6\. FHIR R4 não é mecanismo de persistência operacional.

7\. Testes documentam capacidade, índices, particionamento e limites por componente.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF017 - Automação de testes e gates de integração

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Qualidade de software                      |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A esteira de integração deve executar testes automatizados e gates de modelo, contratos, invariantes, segurança e fases antes da incorporação ou promoção.

Critérios de aceitação:

1\. Executar testes unitários, integração, contrato, arquitetura, segurança e E2E.

2\. Cobrir jornadas críticas e casos negativos de governança.

3\. Bloquear lint, typecheck, schema, mapping, invariante ou jornada crítica falhos.

4\. Usar somente dados sintéticos autorizados.

5\. Verificar os 1644 elementos da release final v2.0.0 e os 929 IDs históricos.

6\. Testar configuração, consentimento, regimes, estados/quantidade/destinação, etiquetas e PII.

7\. Para RCS, testar matrizes fluid/solid, cinco eixos, códigos/severidades, seis evidências, hash/URI, recálculo P_bio/RCS, classes A-E, rotas score_based_certification e governance_failure, unknown e Not scored.

8\. Testar idempotência, checkpoint, quarentena, outbox, reconciliação, promoção e rollback.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF018 - Validação em múltiplas camadas

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Validação                                  |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Entradas, configurações e artefatos devem ser validados no ponto apropriado, permanecendo o backend e os contratos canônicos como autoridade.

Critérios de aceitação:

1\. Validar UX no frontend e repetir regras no backend.

2\. Rejeitar propriedades desconhecidas e aliases legados com fieldPath explícito, preferencialmente HTTP 422.

3\. Validar ConfigurationRelease antes da ativação.

4\. Impedir escrita manual em quantityStatus, severidades congeladas, P_bio, score, classes e rota do RCS.

5\. Verificar hash, URI resolvível, cinco eixos compatíveis com a matriz e seis evidências antes da certificação.

6\. Impedir que leitor/resolvedor físico autorize operações.

7\. Não depender exclusivamente do cliente para regra crítica.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF019 - Outbox durável, retries e reconciliação

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Resiliência de eventos                     |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Eventos do outbox devem ser duráveis, versionados, ordenáveis, idempotentes e reconciliáveis, preservando a autoridade do MongoDB e a reconstrução integral do Neo4j.

Critérios de aceitação:

1\. Persistir agregado e outbox na mesma transação.

2\. Registrar schemaVersion, canonicalModelReleaseId, aggregateVersion e eventTypeVersion.

3\. Usar entrega pelo menos uma vez e consumidor idempotente; reaplicar o mesmo evento não altera o estado projetado.

4\. Aplicar por aggregateVersion e persistir GraphProjectionCheckpoint por partição/projetor.

5\. Aplicar lease, timeout, retries, backoff e dead letter.

6\. Permitir replay e rebuild do grafo a partir do outbox.

7\. Detectar e reparar projeções ausentes/divergentes.

8\. Proibir escrita direta, PII e leituras brutas de telemetria no Neo4j.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF020 - Proteção criptográfica e gestão de segredos

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Criptografia                               |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** Dados, credenciais e segredos devem ser protegidos durante armazenamento, transmissão e processamento.

Critérios de aceitação:

1\. Comunicações externas utilizam TLS 1.2 ou superior.

2\. Senhas são armazenadas somente por algoritmo de hash adaptativo apropriado.

3\. Tokens de recuperação e códigos sensíveis são armazenados por hash; segredos MFA são cifrados.

4\. ParticipantIdentity e outros campos críticos utilizam criptografia em repouso ou por campo.

5\. Segredos são fornecidos por mecanismo seguro e podem ser rotacionados sem alteração de código.

6\. Segredos e valores sensíveis não aparecem em logs.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF021 - Ciclo de vida seguro de sessões e tokens

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Segurança de sessão                        |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** Sessões autenticadas devem possuir duração limitada, revogação e proteção contra reutilização indevida.

Critérios de aceitação:

1\. Access tokens são de curta duração e refresh tokens, quando utilizados, possuem rotação.

2\. Logout, inativação, troca de senha ou alteração crítica de papel revogam as sessões afetadas.

3\. Timeout por inatividade e duração máxima são configuráveis.

4\. Tokens não são persistidos em texto claro no banco.

5\. Cookies, quando utilizados, aplicam Secure, HttpOnly e SameSite adequados.

6\. O usuário pode consultar e encerrar suas sessões ativas.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF022 - Minimização, retenção e destinação de dados

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Privacidade e retenção                     |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A plataforma deve aplicar minimização, consentimento, retenção, legal hold e destinação de maneira versionada e auditável.

Critérios de aceitação:

1\. Cada classe possui finalidade, sensibilidade, política, prazo e responsável.

2\. Revogação bloqueia uso prospectivo sem apagar histórico ou prometer eliminação impossível.

3\. Legal hold bloqueia destinação incompatível.

4\. DispositionAction exige aprovação, execução e evidência.

5\. Contas e eventos históricos usam inativação/pseudonimização em vez de exclusão destrutiva quando necessário.

6\. Etiquetas, testes, relatórios e exportações aplicam minimização.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF023 - Versionamento de schemas e migrações controladas

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Evolução do modelo                         |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Mudanças no modelo, configuração, APIs, eventos, mappings e schemas devem ser versionadas, migráveis e vinculadas à mesma CanonicalModelRelease.

Critérios de aceitação:

1\. Documentos e eventos registram schemaVersion e canonicalModelReleaseId.

2\. Alteração incompatível exige nova versão, migração, testes e rollback.

3\. Não reutilizar IDs antigos para significados novos.

4\. Rejeitar aliases legados em novos contratos.

5\. Atualizar dicionário, requisitos, modelo poliglota, pipeline, diagrams, código e testes no mesmo ciclo.

6\. Registrar ConfigurationChangeEvent para mudanças e rollback.

7\. Impedir alteração de invariante por override runtime.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF024 - FHIR R4 como fronteira sem efeitos colaterais

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Interoperabilidade                         |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** FHIR R4 deve permanecer fronteira de interoperabilidade por transformações puras, mappings versionados e relatórios explícitos de perda.

Critérios de aceitação:

1\. Validar versão, estrutura, perfil e identifier systems.

2\. Preservar IDs canônicos, mappingVersion, configuração e proveniência.

3\. Não escrever diretamente no MongoDB ou Neo4j por serialização/deserialização.

4\. Não persistir recursos FHIR como coleções operacionais.

5\. Usar staging/quarentena em importações.

6\. Registrar roundTripLossReport e preservar extensões nacionais no modelo canônico.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF025 - Consistência de timestamps e sincronização de relógios

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Temporalidade                              |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Entidades e eventos temporais devem distinguir tempos de fenômeno, recepção, persistência, transação e validade conforme aplicabilidade, usando UTC e sincronização verificável.

Critérios de aceitação:

1\. Sincronizar serviços/dispositivos por mecanismo institucional.

2\. Armazenar timestamps canônicos em UTC e preservar contexto de apresentação.

3\. Para telemetria, distinguir observedAt, receivedAt e persistedAt.

4\. Para the normalized SpecimenContainerAssignment, ContainerPositionAssignment and RackLocationAssignment chain e relações projetadas, usar intervalo semiaberto \[from,to).

5\. No grafo, distinguir validTime de transactionTime quando aplicável.

6\. Detectar desvio de relógio acima do limite configurado.

7\. Não ordenar exclusivamente pela hora do cliente; usar sequência, recebimento e versão agregada.

8\. Preservar correções tardias sem sobrescrever o histórico.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF026 - Latência e confiabilidade das notificações críticas

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Desempenho de alertas                      |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** Alertas críticos devem ser emitidos com baixa latência e possuir rastreabilidade de entrega.

Critérios de aceitação:

1\. Alertas de excursão ambiental e ataque de força bruta são encaminhados em até 2 minutos no percentil 95 após a detecção, no ambiente de referência.

2\. Falhas de envio utilizam retry e escalonamento configuráveis.

3\. Cada tentativa registra canal, horário, resultado e evento originador.

4\. A mensagem evita dados pessoais ou científicos desnecessários.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF027 - Acesso inclusivo e compatibilidade de interface

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Acessibilidade e compatibilidade           |
| Prioridade          | Média                                      |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Mantido com auditoria de coerência         |

**Requisito:** A interface deve seguir princípios de acessibilidade compatíveis com nível AA e operar nos navegadores suportados pela instituição.

Critérios de aceitação:

1\. Navegação essencial é possível por teclado.

2\. Campos possuem rótulos, foco visível, contraste adequado e mensagens associadas.

3\. Componentes críticos são testados com tecnologias assistivas representativas.

4\. A aplicação suporta as duas versões estáveis mais recentes dos navegadores definidos na matriz de suporte.

5\. O layout permanece utilizável em resoluções institucionais previstas.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF028 - Modularidade, qualidade interna e governança arquitetural

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Manutenibilidade                           |
| Prioridade          | Crítica                                    |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A arquitetura e o código devem manter limites de domínio, flexibilidade configuracional governada e invariantes verificáveis.

Critérios de aceitação:

1\. Separar escrita canônica, projeções, interoperabilidade, telemetria, objetos e apresentação.

2\. Proibir dual-write entre MongoDB e Neo4j.

3\. Catalogar pontos configuráveis e invariantes.

4\. Executar testes arquiteturais e ConfigurationValidationRun na CI.

5\. Impedir configuração que desabilite identidade, consentimento, finalidade, outbox, auditoria, proveniência, autoridade dos stores ou RCS.

6\. Manter inventário e plano para superfícies legadas.

7\. Impedir importadores/ingestores de criarem campos ou entidades fora da release aprovada.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF029 - Integridade e proteção do Object Storage

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Segurança de arquivos                      |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Arquivos científicos, evidências e artefatos binários devem permanecer no Object Storage com metadados canônicos, versões e integridade controlados no MongoDB.

Critérios de aceitação:

1\. Validar tamanho, MIME, extensão e formato.

2\. Registrar checksum SHA-256, tamanho, URI, versão do objeto e proveniência.

3\. Versionar substituições por DataFileVersion sem sobrescrever evidência.

4\. Aplicar verificação de malware quando disponível.

5\. Usar acesso temporário ou mecanismo equivalente, auditado.

6\. Aplicar criptografia, retenção e ciclo de vida.

7\. Não incorporar binários grandes em documentos MongoDB.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF030 - Proveniência computacional de workflows e dados ômicos

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Reprodutibilidade                          |
| Prioridade          | Alta                                       |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Execuções científicas e preparação analítica futura devem ser reproduzíveis e rastreáveis até snapshots, entradas, transformações, ambiente e saídas, sem caracterizar IA implementada.

Critérios de aceitação:

1\. WorkflowRun registra versão, container digest, parâmetros, dependências, hardware, seed e executor.

2\. DatasetSnapshot congela membros, filtros, consentimentos/políticas, referências e checksum.

3\. FeatureDefinition e LabelDefinition registram semântica, método, unidade, temporalidade, transformação e limitações.

4\. DatasetPartition registra estratégia, seed, groupingUnit e teste de leakage.

5\. Registrar DeidentificationProcess e representatividade quando aplicável.

6\. Manter entidades de modelos inativas até aprovação futura específica.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF031 - Foundation integral, versionada e governada

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Governança e ciclo de vida                 |
| Prioridade          | P0                                         |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** A Fase 1 deve preparar integralmente o modelo canônico v2.0.0, suas configurações, invariantes, contratos e mecanismos de controle por execução one-shot, idempotente, retomável e auditável.

Critérios de aceitação:

1\. Cobrir todos os elementos da release vigente; na release final v2.0.0, 1644 elementos e 146 entidades/artefatos, preservando 929 IDs históricos.

2\. Preparar schemas, enums, cardinalidades, índices, configurações, invariantes, mappings, importadores, quarentena, outbox, auditoria, testes e rollback.

3\. Preparar integralmente RCSInputSnapshot, RCSPreanalyticalAxisInput e RCSGovernanceEvidenceSnapshot e seus gates de matriz, cardinalidade, resolução e recálculo.

4\. Executar dry-run, apply, verify e rollback com checkpoints.

5\. Registrar CanonicalModelRelease, FoundationDataRun, ConfigurationValidationRun e ReadinessReport.

6\. Bloquear promoção quando qualquer P0, invariante, versão, checksum ou pós-condição falhar.

7\. Confirmar zero criação de dados operacionais fictícios.

8\. Confirmar MongoDB/outbox como autoridade, Neo4j derivado, FHIR como fronteira e ausência de PII em grafo/etiquetas.

9\. Preparar estruturas analíticas futuras sem ativar modelos.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

## RNF032 - Proveniência, cobertura, promoção e rollback de referências

| **Atributo**        | **Definição**                              |
|---------------------|--------------------------------------------|
| Categoria           | Governança e ciclo de vida                 |
| Prioridade          | P0                                         |
| Aplicação           | Transversal; gate de fase quando aplicável |
| Status da auditoria | Alterado                                   |

**Requisito:** Releases externas da Fase 2 devem preservar identidade, licença, origem, integridade, cobertura, qualidade e ciclo de vida, permitindo promoção e reversão controladas.

Critérios de aceitação:

1\. Usar fonte oficial ou aprovada, versão e licença registradas.

2\. Preservar asset/checksum no Object Storage quando aplicável.

3\. Versionar parser, normalizador e mapping.

4\. Usar staging, validação, quarentena e limiar aprovado.

5\. Registrar execução retomável em ReferenceImportRun e issues em ReferenceImportIssue.

6\. Vincular conceitos e relações à release.

7\. Exigir ReferenceCoverageManifest e DataQualityAssessment.

8\. Ativar release explicitamente e manter rollback.

9\. Gerar AuditEvent e outbox para projeções autorizadas.

10\. Não declarar vocabulário disponível apenas porque o schema aceita seus códigos.

*Fonte de alinhamento: Modelo canônico v2.0.0; checklist consolidado; requisitos v3.0.0*

# 8. Matriz de coerência das fases

| **Fluxo** | **RF principais** | **RNF principais** | **Evidência mínima** |
|----|----|----|----|
| Fase 1 - Foundation | RF022; RF014; RF019; RF023 | RNF014; RNF017-RNF019; RNF023; RNF028; RNF031 | CanonicalModelRelease; FoundationDataRun; ConfigurationValidationRun; ReadinessReport; cobertura integral. |
| Fase 2 - Referências | RF028; RF011; RF016; RF018 | RNF011; RNF015; RNF017; RNF023-RNF024; RNF032 | ReferenceDatasetRelease; import run/issues; coverage manifest; qualidade; promoção/rollback. |
| Fase 3 - Operacional | RF001-RF029 conforme domínio; centralmente RF029 | RNF001-RNF030 conforme domínio | Payload canônico; consentimento/finalidade; referência ativa; store correto; outbox; auditoria. |
| Transversal | RF010-RF015; RF020-RF024 | RNF006-RNF013; RNF016-RNF025; RNF028 | Configuração versionada; invariantes; segurança; rastreabilidade; documentação. |

# 9. Rastreabilidade modelo v2.0.0 -\> requisitos

| **Domínio v2** | **RF** | **RNF** |
|----|----|----|
| Telemetria governada | RF009; RF017; RF029 | RNF004; RNF007; RNF015-RNF016; RNF025 |
| Grafo temporal e outbox | RF023; RF029 | RNF007; RNF019; RNF023; RNF025; RNF028 |
| Configuração e invariantes | RF014; RF022 | RNF017; RNF023; RNF028; RNF031 |
| Biobanco/biorrepositório | RF004; RF020; RF021; RF024 | RNF007; RNF008; RNF011; RNF022 |
| Consentimento | RF010; RF015; RF024; RF029 | RNF007-RNF009; RNF022; RNF025 |
| Espécime/quantidade/destinação | RF006; RF019; RF026 | RNF011; RNF022; RNF023 |
| SPREC/RCS | RF018; RF019; RF029 | RNF011; RNF017; RNF023; RNF030 |
| Identificação física | RF016; RF017; RF029 | RNF002; RNF007-RNF008; RNF017-RNF018 |
| Interoperabilidade | RF011; RF020 | RNF023-RNF024 |
| Persistência/outbox | RF007; RF009; RF023; RF029 | RNF015-RNF016; RNF019; RNF029 |
| Referências | RF028 | RNF011; RNF017; RNF032 |
| Preparação analítica futura | RF027; RF029 | RNF017; RNF030; RNF031 |

# 10. Declaração de exclusão de escopo

Este documento não contém RF030 nem requisito funcional vigente de Assistente Inteligente, XAI ou apoio à decisão clínica. A presença de estruturas canônicas futuras serve somente para impedir improvisação caso um projeto posterior seja formalmente aprovado. Ela não constitui funcionalidade, implementação, validação, autorização ética ou evidência de desempenho de IA.

# 11. Atividades posteriores à aprovação documental

- A versão 4.0.0 e o modelo canônico v2.0.0 estão formalmente aprovados e finais nesta release documental.

- Definir responsáveis institucionais por ConfigurationRelease, mappings, retenção e promoção de referências.

- Homologar perfis FHIR/RNDS e identifier.system externos por InteroperabilityMappingRelease.

- Executar o protocolo ex ante v1.0.0, já aprovado documentalmente com status approved_for_execution, e registrar resultado e evidências sem confundir aprovação do método com resultado do ensaio.

- Confirmar instrumentalmente a simbologia do código linear do rack.

- Aprovar protocolo futuro de validação externa do RCS.

# 12. Fontes documentais

| **Fonte** | **Uso** |
|----|----|
| BioAvanceD Canonical Data Model v2.0.0 - aprovado/final | Baseline estrutural, entidades, elementos, enums, persistência e migração. |
| Checklist consolidado de atualizações do modelo canônico | Ações P0/P1/P2 e critérios de aceite. |
| Documento Unificado de Requisitos v3.0.0 | Baseline auditado; RF001-RF029 e RNF001-RNF032. |
| Modelo de Persistência Poliglota v2.0.0 | Autoridade dos stores, outbox, FHIR e invariantes. |
| Plano Integrado do Foundation Data Pipeline v2.0.0 | Fases, gates, evidências e rollback. |
| Artigo e suplementos RCS | Semântica determinística, SPREC 2.0, regras, severidade e reprodutibilidade. |
| Documentos de pesquisa e qualificação anexados | Escopo DSR, avaliação ex ante e limites das alegações. |
| ISO/IEC 21823; OGC SensorThings; W3C WoT TD; CloudEvents | Contratos de telemetria, interoperabilidade IoT e eventos. |
| ISO/IEC 39075:2024 | Representação e projeção temporal de grafos de propriedades. |
| Domínio bioadvanced.dev | Autoridade dos namespaces internos de identifier.system. |
| Fotografias dos tubos Data Matrix e rack de 96 posições | Base observacional do protocolo ex ante, sem amostras. |
| Artigos científicos 2021-2025 da revisão dirigida | Fundamentação de telemetria remota, cadeia de frio e proveniência. |

Fonte: elaborado pela autora; revisão técnica e reconciliação documental em 2026.
