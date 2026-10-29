Especificação técnica final derivada do modelo canônico revisado

Release documental aprovada e final \| 12 de setembro de 2026

| **Princípio central: flexibilidade configuracional com invariantes arquiteturais e de governança.** |
|----|

# 1. Controle do documento

| **Item** | **Valor** |
|:---|:---|
| Versão | 2.0.0 - aprovada e final |
| Baseline | Dicionário v1.3.0, 929 elementos preservados |
| Elementos totais | 1644 |
| Novos elementos | 715 |
| Entidades/artefatos | 146 |
| Natureza | Modelo canônico e preparação arquitetural; não é implementação |
| Fontes | Anexos fornecidos, checklist, requisitos, RCS e revisão dirigida: ISO/IEC 16022 e artigos científicos com DOI |
| Status documental | Aprovada e final; não é implementação nem resultado de ensaio |

# 2. Visão geral

A versão 2.0.0 aprovada e final é uma evolução principal porque separa conceitos antes misturados, introduz regimes de governança computáveis, normaliza decisões de consentimento, torna a qualificação RCS contextual, formaliza identificação física e prepara as três fases do BioAvanceD. Os 929 elementos históricos permanecem contabilizados. Nenhum identificador anterior recebe significado novo. A aprovação desta release é documental e não constitui execução do pipeline, implantação, homologação operacional ou resultado de ensaio ex ante.

O modelo usa nomes canônicos em inglês e rótulos em português apenas para apresentação. A persistência operacional continua centrada no MongoDB; os demais mecanismos possuem autoridade limitada por classe de dado.

# 3. Flexibilidade configuracional com invariantes

O BioAvanceD admite variação institucional, operacional e tecnológica somente em perfis e releases aprovados, versionados, validados e auditáveis. Não existe override de invariante em tempo de execução. Alterar um invariante exige decisão arquitetural, documentação, testes e nova release do modelo.

## 3.1 Elementos configuráveis

- Instituição, hierarquia organizacional, coleção e estudo dentro dos contratos canônicos.

- Idioma, apresentação, workflows permitidos e notificações.

- Integrações, endpoints, perfis e mappings FHIR aprovados.

- Terminologias, releases de referência e mappings SPREC/RCS compatíveis.

- Templates de etiquetas, simbologias e perfis homologados de leitores e impressoras.

- Topologia de implantação e componentes opcionais sem modificar a autoridade dos stores.

## 3.2 Invariantes

- Identificadores canônicos imutáveis; identidade civil segregada e pseudonimização.

- Consentimento, finalidade, política de acesso, proveniência e cadeia de custódia.

- Auditoria append-only, integridade, versionamento e exceções rastreáveis.

- MongoDB como fonte operacional e outbox; Neo4j somente como projeção controlada.

- FHIR R4 como fronteira de interoperabilidade, sem persistência operacional paralela.

- Admissibilidade do RCS, contexto de uso e proibição de edição manual dos resultados.

- Proibição de PII em etiquetas e em projeções Neo4j.

# 4. Fronteiras de autoridade

| **Classe** | **Autoridade** | **Uso permitido** | **Proibição** |
|:---|:---|:---|:---|
| Operational canonical records and metadata | MongoDB | Canonical source of truth; transactions; outbox | Operational dual-write; FHIR parallel persistence |
| Graph lineage and relationships | MongoDB source events; Neo4j derived projection | Temporal property-graph traversal over topology, custody, lineage, assignment, excursion and summaries | Direct operational writes; raw telemetry; civil identity/PII |
| Telemetry and time series | InfluxDB | Complete environmental/equipment measurements with idempotency, observed/received/persisted times and location correlation | Raw readings in MongoDB/Neo4j/FHIR; PII |
| Files, documents, evidence and binary artifacts | Object Storage (binary); MongoDB (metadata) | Immutable/versioned objects with checksum | Binary payloads in MongoDB; silent overwrite |
| Cache, locks and transient coordination | None; Redis is transient | Cache, locks, rate/session support where approved | Canonical or evidentiary records |
| Interoperability payloads | No independent store; FHIR R4 is boundary only | Versioned transform and exchange | FHIR operational database; serializer side effects |

## 4.1 Telemetria, correlação temporal e ingestão

A unidade autoritativa de medição é TelemetryReading no InfluxDB. Todos os seus campos, inclusive sensorId, equipmentId, storageLocationId e thresholdProfileId, pertencem à série temporal; esses identificadores apenas referenciam cadastros mestres no MongoDB. telemetryReadingId e idempotencyKey impedem duplicação lógica. observedAt, receivedAt e persistedAt distinguem fenômeno, recepção e confirmação de persistência. Payloads com PII são rejeitados.

A associação de uma leitura ao espécime usa a interseção temporal da cadeia SpecimenContainerAssignment, ContainerPositionAssignment e RackLocationAssignment. O observedAt deve pertencer ao intervalo semiaberto resultante e o storageLocationId deve coincidir com o local monitorado. TelemetryExposureSummary preserva os três IDs de atribuição, exposurePathHash, janela, cobertura, contagens, estatísticas, excursões, hashes do conjunto e da consulta e versão do cálculo. StorageAssignment permanece apenas como legado depreciado para leitura e migração.

## 4.2 Projeção temporal de grafos

A projeção é um grafo temporal de propriedades G_T=(V,E,lambda_V,lambda_E,P_V,P_E,nu), em que nu(x)=\[t_i,t_f). Para um instante t, V_t={v em V \| t em nu(v)} e E_t={e=(u,v) em E \| t em nu(e) e u,v em V_t}. A evolução obedece G_k=Pi(G\_{k-1},o_k), com idempotência Pi(Pi(G,o_k),o_k)=Pi(G,o_k). Eventos são aplicados por aggregateVersion, checkpoints são persistidos e o Neo4j é reconstruível pelo replay do outbox. Leituras brutas e PII nunca são projetadas.

## 4.3 Ingestão remota governada

A ingestão remota utiliza diretamente perfis aprovados para MQTT, HTTPS ou adaptadores de dispositivos. O backend valida identidade do dispositivo, integridade, schema, unidade, tempos, idempotência e ausência de dados pessoais antes de gravar TelemetryReading no InfluxDB. Não existe camada adicional de gerenciamento remoto nem autoridade paralela.

# 5. Domínios e entidades

## Acesso e distribuição

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| AccessRequest | 8 | MongoDB | According to entity/data class | existing/revised |

## Administração e segurança

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| AccessGrant | 13 | MongoDB | According to entity/data class | existing/revised |
| AccessPolicy | 13 | MongoDB | According to entity/data class | existing/revised |
| Actor | 7 | MongoDB | According to entity/data class | existing/revised |
| AuditEvent | 32 | MongoDB | According to entity/data class | existing/revised |
| Permission | 8 | MongoDB | According to entity/data class | existing/revised |
| RecoveryCodeSet | 8 | MongoDB | According to entity/data class | existing/revised |
| Role | 8 | MongoDB | According to entity/data class | existing/revised |
| SecurityConfiguration | 49 | MongoDB | According to entity/data class | existing/revised |
| Session | 17 | Redis (transient only) | According to entity/data class | existing/revised |
| UserAccount | 27 | MongoDB | According to entity/data class | existing/revised |
| UserRoleAssignment | 13 | MongoDB | According to entity/data class | existing/revised |

## Amostra e material

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| ProcessingBatch | 6 | MongoDB | According to entity/data class | existing/revised |
| Specimen | 34 | MongoDB | According to entity/data class | existing/revised |

## Armazenamento físico

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|----|----|----|----|----|
| ContainerPositionAssignment | 7 | MongoDB | Phase 3 | added |
| RackLocationAssignment | 7 | MongoDB | Phase 3 | added |
| SpecimenContainerAssignment | 7 | MongoDB | Phase 3 | added |
| StoragePosition | 6 | MongoDB | Phase 3 | added |
| StorageRack | 9 | MongoDB | Phase 3 | added |

## Arquivos científicos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DataFile | 16 | MongoDB | According to entity/data class | existing/revised |

## Arquivos e evidências

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DataFileVersion | 8 | MongoDB metadata; Object Storage binary | Phase 3 | added |

## Cadeia de custódia

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| CustodyEvent | 16 | MongoDB | According to entity/data class | existing/revised |

## Configuração governada

<table style="width:98%;">
<colgroup>
<col style="width: 27%" />
<col style="width: 12%" />
<col style="width: 22%" />
<col style="width: 23%" />
<col style="width: 12%" />
</colgroup>
<thead>
<tr>
<th style="text-align: left;"><strong>Entidade</strong></th>
<th style="text-align: left;"><strong>Elementos</strong></th>
<th style="text-align: left;"><strong>Persistência</strong></th>
<th style="text-align: left;"><strong>Fase de população</strong></th>
<th style="text-align: left;"><strong>Status</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align: left;">ConfigurationChangeEvent</td>
<td style="text-align: left;">8</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Phase 3</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">ConfigurationProfile</td>
<td style="text-align: left;">9</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Phase 3</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">ConfigurationRelease</td>
<td style="text-align: left;">10</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Phase 3</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">ConfigurationValidationRun</td>
<td style="text-align: left;">10</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Phase 3</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">GovernanceInvariant</td>
<td style="text-align: left;">6</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Not applicable - structural artifact</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">GovernanceInvariantCatalog</td>
<td style="text-align: left;">6</td>
<td style="text-align: left;"><p>MongoDB metadata;</p>
<p>Object Storage artifact</p></td>
<td style="text-align: left;">Not applicable - structural artifact</td>
<td style="text-align: left;">added</td>
</tr>
<tr>
<td style="text-align: left;">InvariantViolation</td>
<td style="text-align: left;">7</td>
<td style="text-align: left;">MongoDB</td>
<td style="text-align: left;">Phase 3</td>
<td style="text-align: left;">added</td>
</tr>
</tbody>
</table>

## Consentimento

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| ConsentAuthorizationDecision | 11 | MongoDB | Phase 3 | added |
| ConsentCommunicationEvent | 8 | MongoDB | Phase 3 | added |
| ConsentDecisionEvent | 11 | MongoDB | Phase 3 | added |
| ConsentPermission | 8 | MongoDB | Phase 3 | added |
| ConsentRevocation | 8 | MongoDB | Phase 3 | added |

## Consentimento e uso

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Consent | 34 | MongoDB | According to entity/data class | existing/revised |
| ConsentTemplate | 19 | MongoDB | According to entity/data class | existing/revised |

## Custódia

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| CustodianshipAssignment | 8 | MongoDB | Phase 3 | added |

## Dados analíticos futuros

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| CohortDefinition | 8 | MongoDB | Phase 3 | added |
| DatasetPartition | 8 | MongoDB | Phase 3 | added |
| DatasetRepresentativenessAssessment | 8 | MongoDB | Phase 3 | added |
| DatasetSnapshot | 9 | MongoDB | Phase 3 | added |
| FeatureDefinition | 10 | MongoDB | Phase 3 | added |
| LabelDefinition | 8 | MongoDB | Phase 3 | added |

## Dados clínicos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| AllergyIntolerance | 3 | MongoDB | According to entity/data class | existing/revised |
| ClinicalObservation | 16 | MongoDB | According to entity/data class | existing/revised |
| ClinicalOutcome | 3 | MongoDB | According to entity/data class | existing/revised |
| Condition | 11 | MongoDB | According to entity/data class | existing/revised |
| DerivedScore | 5 | MongoDB | According to entity/data class | existing/revised |
| DiagnosticReport | 7 | MongoDB | According to entity/data class | existing/revised |
| Encounter | 6 | MongoDB | According to entity/data class | existing/revised |
| FamilyHistory | 3 | MongoDB | According to entity/data class | existing/revised |
| MedicationExposure | 9 | MongoDB | According to entity/data class | existing/revised |
| PhenotypeObservation | 11 | MongoDB | According to entity/data class | existing/revised |
| Procedure | 4 | MongoDB | According to entity/data class | existing/revised |

## Dados de referência

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| BiomarkerAssociation | 11 | MongoDB | According to entity/data class | existing/revised |
| DiseaseConcept | 9 | MongoDB | According to entity/data class | existing/revised |
| GeneConcept | 6 | MongoDB | According to entity/data class | existing/revised |
| ReferenceCoverageManifest | 9 | MongoDB | Phase 2 | added |
| TerminologyConcept | 18 | MongoDB | According to entity/data class | existing/revised |
| TerminologyRelation | 14 | MongoDB | According to entity/data class | existing/revised |

## Dados ômicos e imagens

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| GenomicsRun | 4 | MongoDB | According to entity/data class | existing/revised |
| ImagingDerivedData | 2 | Object Storage | According to entity/data class | existing/revised |
| ImagingStudy | 2 | MongoDB | According to entity/data class | existing/revised |
| MetabolomicsRun | 1 | Object Storage | According to entity/data class | existing/revised |
| MicrobiomeRun | 2 | MongoDB | According to entity/data class | existing/revised |
| ProteomicsRun | 2 | Object Storage | According to entity/data class | existing/revised |
| TranscriptomicsRun | 1 | Object Storage | According to entity/data class | existing/revised |

## Doador e participante

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Participant | 12 | MongoDB | According to entity/data class | existing/revised |
| ParticipantIdentity | 17 | MongoDB protected identity boundary | According to entity/data class | existing/revised |

## Ensaios e experimentos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Assay | 12 | MongoDB | According to entity/data class | existing/revised |
| ReagentLot | 7 | MongoDB | According to entity/data class | existing/revised |

## Equipamentos e métodos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Device | 11 | MongoDB | According to entity/data class | existing/revised |

## Espécime

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| OperationalStateDecision | 9 | MongoDB | Phase 3 | added |

## Estudo e protocolo

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Protocol | 8 | MongoDB | According to entity/data class | existing/revised |
| Study | 15 | MongoDB | According to entity/data class | existing/revised |

## FAIR e publicação

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Dataset | 8 | MongoDB | According to entity/data class | existing/revised |

## Gestão da qualidade

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Nonconformance | 11 | MongoDB | According to entity/data class | existing/revised |
| QuarantineAction | 7 | MongoDB | According to entity/data class | existing/revised |

## Governança de coleções

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| BiobankGovernanceContext | 9 | MongoDB | Phase 3 | added |
| BiorepositoryContext | 12 | MongoDB | Phase 3 | added |
| CollectionGovernanceApproval | 9 | MongoDB | Phase 3 | added |
| CollectionGovernanceEvent | 8 | MongoDB | Phase 3 | added |

## Governança do modelo

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| CanonicalModelRelease | 10 | MongoDB | Not applicable - structural artifact | added |

## Governança futura de modelos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| AlgorithmicDecisionReview | 8 | MongoDB | Phase 3 - conditional future project | added |
| ModelArtifact | 8 | MongoDB metadata; Object Storage artifact | Phase 3 - conditional future project | added |
| ModelCard | 9 | MongoDB metadata; Object Storage artifact | Phase 3 - conditional future project | added |
| ModelEvaluationRun | 8 | MongoDB | Phase 3 - conditional future project | added |
| ModelMonitoringEvent | 8 | MongoDB | Phase 3 - conditional future project | added |

## Governança transversal

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| BaseRecord | 23 | MongoDB | According to entity/data class | existing/revised |
| FoundationDataRun | 27 | MongoDB | According to entity/data class | existing/revised |
| GraphProjectionOutboxEvent | 23 | MongoDB | According to entity/data class | existing/revised |
| MerkleRoot | 6 | MongoDB | According to entity/data class | existing/revised |
| ReferenceDatasetRelease | 24 | MongoDB | According to entity/data class | existing/revised |
| ReferenceImportIssue | 17 | MongoDB | According to entity/data class | existing/revised |
| ReferenceImportRun | 23 | MongoDB | According to entity/data class | existing/revised |

## Identificação física

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Container | 9 | MongoDB | Phase 3 | added |
| DeviceProfile | 8 | MongoDB | Phase 2 | added |
| IdentificationPolicy | 8 | MongoDB | Phase 2 | added |
| LabelIdentifier | 16 | MongoDB | Phase 3 | added |
| LabelPrintEvent | 9 | MongoDB | Phase 3 | added |
| LabelTemplate | 12 | MongoDB | Phase 2 | added |
| PhysicalIdentificationValidationProtocol | 10 | MongoDB | Phase 2 | added |
| ScanEvent | 13 | MongoDB | Phase 3 | added |
| UnifiedIdentifierResolverContract | 6 | Object Storage artifact; MongoDB registry | Not applicable - structural artifact | added |

## Interoperabilidade

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| FHIRProfileRegistry | 8 | MongoDB | Phase 2 | added |
| IdentifierNamespaceRegistry | 9 | MongoDB | Phase 2 | added |
| InteroperabilityMappingRelease | 29 | MongoDB | Phase 2 | added |

## Inventário físico

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| StorageAssignment | 14 | MongoDB | According to entity/data class | existing/revised |
| StorageLocation | 7 | MongoDB | According to entity/data class | existing/revised |

## Metadados de biobanco

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Biobank | 15 | MongoDB | According to entity/data class | existing/revised |
| Collection | 32 | MongoDB | According to entity/data class | existing/revised |
| Network | 12 | MongoDB | According to entity/data class | existing/revised |
| NetworkMembership | 7 | MongoDB | According to entity/data class | existing/revised |
| ResearchResource | 23 | MongoDB | According to entity/data class | existing/revised |
| ResearchResourceBiobank | 5 | MongoDB | According to entity/data class | existing/revised |
| ResearchResourceCollection | 5 | MongoDB | According to entity/data class | existing/revised |

## Organização

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| ContactInformation | 11 | MongoDB | According to entity/data class | existing/revised |
| Organization | 8 | MongoDB | According to entity/data class | existing/revised |

## Pipeline Foundation

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| ReadinessReport | 9 | MongoDB | Phase 3 | added |

## Preparação futura

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| AIReadinessAssessment | 8 | MongoDB | Phase 3 | added |

## Privacidade

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DeidentificationProcess | 8 | MongoDB | Phase 3 | added |

## Projeção de grafos

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| GraphProjectionCheckpoint | 7 | MongoDB | Phase 3 | added |

## Proveniência computacional

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| WorkflowRun | 15 | MongoDB | According to entity/data class | existing/revised |

## Qualidade de dados

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DataQualityAssessment | 10 | MongoDB | Phase 3 | added |
| MissingDataReason | 7 | MongoDB | Phase 3 | added |

## Qualidade específica do ensaio

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| OmicsQualification | 6 | MongoDB | According to entity/data class | existing/revised |

## Qualidade pré-analítica

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| RCSAssessment | 38 | MongoDB | According to entity/data class | existing/revised |
| SpecimenPreanalytics | 17 | MongoDB | According to entity/data class | existing/revised |

## Qualificação RCS

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| RCSGovernanceEvidenceSnapshot | 14 | MongoDB | Phase 3 | added |
| RCSInputSnapshot | 16 | MongoDB | Phase 3 | added |
| RCSPreanalyticalAxisInput | 11 | MongoDB | Phase 3 | added |
| RCSRulePackage | 7 | MongoDB | Phase 3 | added |
| RCSValidationStudy | 8 | MongoDB | Phase 3 | added |
| SPRECMappingRelease | 8 | MongoDB | Phase 2 | added |

## Retenção e destino final

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DispositionAction | 12 | MongoDB | Phase 3 | existing/revised |
| RetentionPolicy | 10 | MongoDB | According to entity/data class | existing/revised |

## Telemetria

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| DeviceCommunicationProfile | 7 | MongoDB | Phase 2 | added |
| DeviceRegistration | 6 | MongoDB | Phase 3 | added |
| TelemetryDatastream | 10 | MongoDB | Phase 3 | added |
| TelemetryExposureSummary | 21 | MongoDB | Phase 3 | added |
| TelemetryIngestionEvent | 8 | MongoDB | Phase 3 | added |
| TelemetryReading | 26 | InfluxDB | Phase 3 | existing/revised |
| TelemetryValidationIssue | 7 | MongoDB | Phase 3 | added |
| ThresholdProfile | 8 | MongoDB | According to entity/data class | existing/revised |

## Telemetria e cadeia fria

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| EnvironmentalExcursion | 11 | MongoDB | According to entity/data class | existing/revised |

## Transporte e distribuição

| **Entidade** | **Elementos** | **Persistência** | **Fase de população** | **Status** |
|:---|:---|:---|:---|:---|
| Shipment | 12 | MongoDB | According to entity/data class | existing/revised |

# 6. Biobanco e biorrepositório

Collection.governanceRegime é obrigatório para material humano de pesquisa e admite apenas biobank ou biorepository. O nome livre da organização não define o regime. Cada coleção possui exatamente um contexto compatível; a ativação depende das aprovações aplicáveis. Alteração de regime gera CollectionGovernanceEvent append-only e nunca conversão silenciosa.

| **Regime** | **Contexto obrigatório** | **Vínculos mínimos** | **Regra de uso** |
|:---|:---|:---|:---|
| biorepository | BiorepositoryContext | studyId, protocolId/version, CAAE, instituição, pesquisador, aprovação e vigência | Uso limitado ao projeto/protocolo e prazo/condição aprovados |
| biobank | BiobankGovernanceContext | finalidade ampla, política, comitê, custódia, condições futuras e consentimento | Pertencer ao biobanco não autoriza automaticamente novo uso |

# 7. TCLE e autorização de uso

ConsentTemplate é versionado e imutável. Consent distingue specific, broad, tiered e dynamic; amplo e dinâmico não são sinônimos. ConsentPermission materializa decisões granulares. ConsentDecisionEvent, ConsentRevocation e ConsentCommunicationEvent preservam histórico append-only. ConsentAuthorizationDecision retorna permit, deny ou review_required e registra consentimento, finalidade, estudo/protocolo, política, configuração, instante, regras e justificativas.

A revogação bloqueia usos prospectivos e preserva histórico e obrigações legais de retenção. O modelo não promete eliminação incompatível com obrigações documentadas.

# 8. Ciclo de vida do espécime

| **Dimensão** | **Campo/entidade** | **Valores/regra** |
|:---|:---|:---|
| Estado operacional | Specimen.specimenStatus | available, reserved, checked_out, quarantined, unavailable, closed |
| Quantidade derivada | Specimen.quantityStatus | full se atual=inicial; partial se 0\<atual\<inicial; depleted se atual=0 |
| Destinação | DispositionAction | transfer, return, destroy, preserve; planned, approved, executed, cancelled, blocked |

DISPOSED, DESTROYED, PARTIAL e DEPLETED não são estados operacionais. CLOSED é terminal e só ocorre após validação de consumo total ou encerramento da custódia por destinação autorizada. Cada alíquota ou derivado é novo Specimen, com parentSpecimenIds, evento de derivação, redução atômica da quantidade parental, protocolo, lote, responsável, outbox e reconciliação.

# 9. SPREC e RCS

SPREC 2.0 permanece baseline atual do RCS. SPREC 4.0 aparece exclusivamente como roadmap de migração versionada. RCSAssessment é determinístico, contextual, auditável, reproduzível e somente leitura. Cada avaliação referencia exatamente um RCSInputSnapshot imutável e resolvível, que declara matrix=fluid ou solid, materialType e release do mapping, os cinco eixos aplicáveis com código SPREC observado, severidade normalizada, peso, penalidade e evidência, além das seis verificações individuais do gate: metadataComplete, terminologyValid, traceabilityOk, monitoringOk, documentationOk e semanticCompatible.

Para fluidos, os eixos são P_pre, P_cent1, P_cent2, P_post e P_store; para sólidos, P_warm, P_cold, P_fix, P_fixTime e P_store. Somente após gate aprovado são derivados P_bio, score=100-P_bio e scoreBasedGrade. O resultado preserva finalGrade, gradeRoute e routeReasons. Falha de governança conduz à rota governance_failure e classe E, sem converter ausência, código inválido, incompatibilidade ou Not scored em severidade zero. Um Specimen pode ter múltiplas avaliações por contexto; não existe qualidade absoluta no Specimen.

# 10. Etiquetas, recipientes e topologia física

Specimen, Container, StoragePosition, StorageRack e LabelIdentifier são objetos distintos. Data Matrix é a simbologia 2D selecionada para o tubo: a ISO/IEC 16022 define seu contrato técnico e o ECC 200; Filipowicz et al. (2022) documentam tubos codificados por Data Matrix integrados ao registro de um biobanco, enquanto Bukreeva et al. (2024) sustentam a digitalização, automação e identificação rastreável. Essas fontes justificam a escolha sem afirmar dimensões, percentual universal de recuperação, predominância mundial ou desempenho não ensaiado. O símbolo identifica o Container, nunca participante ou conteúdo clínico. SpecimenContainerAssignment registra o conteúdo temporal, ContainerPositionAssignment a posição, StoragePosition a coordenada e RackLocationAssignment o local temporal do rack. O código linear do rack é um identificador independente e sua simbologia será determinada instrumentalmente no ensaio ex ante.

UnifiedIdentifierResolverContract aceita leitor USB em modo teclado, leitor industrial, câmera móvel, adaptador de hardware e futura API. O resolvedor captura, decodifica, normaliza e resolve. A autorização da operação permanece no backend. Nome, CPF, prontuário, diagnóstico, dado genético e dados clínicos desnecessários são proibidos em código e texto da etiqueta.

# 11. Interoperabilidade

FHIR R4 4.0.1 permanece fronteira de transformação. InteroperabilityMappingRelease é persistida no MongoDB e registra release canônica, versão FHIR, guia de implementação, jurisdição, perfis homologados, recursos, namespaces, terminologias, URI e hash do mapping, relatório de conformidade, cobertura, perdas de round-trip, aprovação, vigência e supersessão. IdentifierNamespaceRegistry governa os identifier.system sob https://bioadvanced.dev/fhir/NamingSystem/. Nenhuma correspondência direta é forçada e não existe persistência operacional FHIR paralela.

| **Namespace interno inicial** | **Uso** |
|:---|:---|
| https://bioadvanced.dev/fhir/NamingSystem/participant-id | Participante pseudonimizado |
| https://bioadvanced.dev/fhir/NamingSystem/specimen-id | Espécime canônico |
| https://bioadvanced.dev/fhir/NamingSystem/accession-identifier | Acesso operacional |
| https://bioadvanced.dev/fhir/NamingSystem/container-id | Recipiente físico |
| https://bioadvanced.dev/fhir/NamingSystem/storage-rack-id | Rack |
| https://bioadvanced.dev/fhir/NamingSystem/label-identifier | Identificador físico |
| https://bioadvanced.dev/fhir/NamingSystem/collection-id | Coleção |
| https://bioadvanced.dev/fhir/NamingSystem/consent-id | Consentimento |
| https://bioadvanced.dev/fhir/NamingSystem/study-id | Estudo |
| https://bioadvanced.dev/fhir/NamingSystem/equipment-id | Equipamento |

| **Mapping** | **Canônico** | **Padrão/recurso** | **Relação** | **Limitação** |
|:---|:---|:---|:---|:---|
| MAP-V2-001 | Participant | FHIR R4 Patient | partial/controlled | Patient identity remains segregated; no civil identity projection |
| MAP-V2-002 | Specimen | FHIR R4 Specimen | partial | Internal operational status and quantity/disposition dimensions require governed mapping |
| MAP-V2-003 | Consent | FHIR R4 Consent | partial | Granular dynamic history remains canonical; no forced equivalence |
| MAP-V2-004 | ClinicalObservation | FHIR R4 Observation | structural | UCUM and profile version required |
| MAP-V2-005 | DiagnosticReport | FHIR R4 DiagnosticReport | structural | Round-trip loss report required |
| MAP-V2-006 | AuditEvent | FHIR R4 AuditEvent | partial | Hash chain and internal policy context remain canonical |
| MAP-V2-007 | DataFile | FHIR R4 DocumentReference | partial | Binary remains in Object Storage |
| MAP-V2-008 | WorkflowRun | FHIR R4 Provenance | partial | Full computational environment remains canonical |
| MAP-V2-009 | Study | FHIR R4 ResearchStudy | partial | Used when applicable; versioned profile required |
| MAP-V2-010 | Biobank | MIABIS 3.0 Biobank | partial | Brazilian governance extensions remain canonical |
| MAP-V2-011 | Collection | MIABIS 3.0 Collection | partial | governanceRegime, CAAE and approval are preserved internally |
| MAP-V2-012 | TelemetryReading | OGC SensorThings API 1.1 Observation | partial | Canonical idempotency, three times, hashes and institutional scope remain internal |
| MAP-V2-013 | TelemetryDatastream | OGC SensorThings API 1.1 Datastream/Sensor/Thing/Location | partial | Canonical device and validity policies remain internal |
| MAP-V2-014 | DeviceCommunicationProfile | W3C WoT Thing Description 1.1 Thing Description | partial | Credentials remain outside the canonical payload |
| MAP-V2-015 | TelemetryIngestionEvent | CloudEvents 1.0 Event envelope | partial | Canonical validation issues and persistence confirmation remain internal |
| MAP-V2-016 | Neo4jProjection | ISO/IEC 39075:2024 Property graph / GQL concepts | conceptual | Projection remains reconstructible and is not canonical authority |
| MAP-V2-017 | Container | FHIR R4 4.0.1 Specimen.container | partial | Empty container, rack topology and temporal occupancy remain canonical |
| MAP-V2-018 | IdentifierNamespaceRegistry | FHIR R4 4.0.1 Identifier.system / NamingSystem | structural | Version is governed separately from the stable URI |

# 12. Preparação das três fases

| **Fase** | **Preparação/população** | **Gate** |
|:---|:---|:---|
| Fase 1 - Foundation | Schemas, entidades, índices, enums, contratos, configurações, importadores, quarentena, outbox, auditoria, testes e rollback; nenhum dado operacional real | Todos os P0, invariantes, paridade de versões e pós-condição de zero dados operacionais indevidos |
| Fase 2 - Referências | Terminologias, ontologias, catálogos, mappings, perfis e templates homologados | Licença, origem, checksum, parser, mapping, cobertura, issues, rollback e promoção |
| Fase 3 - Operacional/científica | Participantes, consentimentos, espécimes, custódia, clínicos, telemetria, arquivos, estudos, ensaios, etiquetas e ciência autorizada | Consentimento/finalidade, proveniência, referências ativas, qualidade, segurança e auditoria |

# 13. Decisões arquiteturais

| **ADR** | **Decisão** | **Consequência** |
|:---|:---|:---|
| ADR-V2-001 | Flexibilidade somente sob catálogo e invariantes | Configuração inválida não é ativada |
| ADR-V2-002 | MongoDB operacional e outbox; Neo4j derivado | Sem dual-write; replay e reconciliação |
| ADR-V2-003 | FHIR R4 como fronteira pura | Serializadores sem efeitos colaterais |
| ADR-V2-004 | Estado, quantidade e destinação separados | Migração explícita do specimenStatus legado |
| ADR-V2-005 | Consentimento por eventos e decisão contextual | Histórico preservado e autorização ternária |
| ADR-V2-006 | RCS contextual com snapshot integral SPREC 2.0 | Recalcular matriz, cinco eixos, gate, P_bio e rota |
| ADR-V2-007 | Recipiente, posição, rack, identificador e espécime distintos | O código do tubo resolve Container; atribuições temporais registram conteúdo e posição |
| ADR-V2-008 | IA futura apenas estruturalmente preparada | Entidades permanecem inativas e condicionadas |
| ADR-V2-009 | Leitura integral no InfluxDB e exposição derivada | Correlação reproduzível sem duplicar série temporal |
| ADR-V2-010 | Grafo temporal idempotente via outbox | Intervalos, versões, checkpoint e rebuild |
| ADR-V2-011 | Mappings FHIR homologados por release no MongoDB | Perfis, namespaces, cobertura, testes e perdas ficam auditáveis |

# 14. Migração v1.3.0 para v2.0.0

1.  Congelar e verificar checksums da v1.3.0 e da release final v2.0.0.

2.  Executar dry-run com inventário dos 929 IDs históricos.

3.  Preservar campos mantidos; completar companions obrigatórios para entidades alteradas.

4.  Transformar specimenStatus legado: partial/depleted em quantityStatus; destroyed exige DispositionAction e fechamento validado.

5.  Normalizar permissões booleanas do Consent em ConsentPermission sem apagar os valores de origem.

6.  Converter barcodeValue em LabelIdentifier e bloquear novas escritas no campo legado.

7.  Adicionar contextos de governança de Collection e impedir ativação sem compatibilidade.

8.  Gerar eventos de outbox apenas a partir da fonte canônica; reconstruir Neo4j e reconciliar.

9.  Executar verificações e ReadinessReport; promover somente sem bloqueadores P0.

10. Manter rollback para a release anterior sem reutilizar IDs ou sobrescrever evidências.

# 15. Limitações e pendências

- A release final não afirma conformidade ou certificação ISO.

- Perfis nacionais FHIR/RNDS e endpoints institucionais dependem de seleção e validação posteriores.

- A preferência por Data Matrix está definida documentalmente; a leitura física e os perfis de dispositivos permanecem dependentes da execução ex ante prevista e aprovada metodologicamente.

- SPREC 4.0 não está ativa; a migração depende de validação futura.

- O protocolo de validação externa do RCS deve definir especialistas, desfechos e métricas antes da execução.

- Entidades futuras de modelos não podem ser ativadas sem projeto, ética, validação e documentação específicos.

- A release canônica v2.0.0 está formalmente aprovada e final nesta versão documental. Aprovações institucionais específicas de implantação, perfis, referências e execuções experimentais permanecem próprias de cada etapa e não são inferidas por esta aprovação.

# Apêndice A - Exemplo sintético: um participante e uma amostra em biobanco

Todos os valores são sintéticos. A identidade civil não aparece no registro operacional.

> {\
> "canonicalModelReleaseId": "release-2.0.0",\
> "participant": {\
> "participantId": "participant-synthetic-001",\
> "identityReference": "identity-boundary:participant-synthetic-001"\
> },\
> "collection": {\
> "collectionId": "collection-biobank-synthetic-001",\
> "governanceRegime": "biobank",\
> "governanceContext": {\
> "biobankGovernanceContextId": "biobank-context-001",\
> "broadPurpose": {\
> "code": "health-research"\
> },\
> "governancePolicyId": "policy-synthetic-001",\
> "accessCommitteeId": "committee-synthetic-001",\
> "institutionalCustodianId": "org-synthetic-001",\
> "futureUseConditions": \[\
> "compatible_consent",\
> "ethics_review_when_required"\
> \]\
> }\
> },\
> "consent": {\
> "consentId": "consent-synthetic-001",\
> "consentModel": "broad",\
> "templateVersionId": "consent-template-001",\
> "currentStateDerived": "active",\
> "effectivePeriod": {\
> "start": "2026-09-07"\
> },\
> "permissions": \[\
> {\
> "permissionCode": "commercial_use",\
> "purpose": {\
> "code": "commercial-research"\
> },\
> "decision": "deny",\
> "policyVersion": "1.0.0"\
> }\
> \]\
> },\
> "specimen": {\
> "specimenId": "specimen-synthetic-001",\
> "accessionIdentifier": {\
> "system": "https://bioadvanced.dev/fhir/NamingSystem/accession-identifier",\
> "value": "SYN-000001"\
> },\
> "participantId": "participant-synthetic-001",\
> "collectionId": "collection-biobank-synthetic-001",\
> "specimenRole": "primary",\
> "materialType": {\
> "code": "synthetic-plasma"\
> },\
> "specimenStatus": "available",\
> "initialQuantity": {\
> "value": 2.0,\
> "unit": "mL",\
> "system": "http://unitsofmeasure.org",\
> "code": "mL"\
> },\
> "currentQuantity": {\
> "value": 1.5,\
> "unit": "mL",\
> "system": "http://unitsofmeasure.org",\
> "code": "mL"\
> },\
> "quantityStatus": "partial",\
> "parentSpecimenIds": \[\]\
> },\
> "custodianship": {\
> "custodianshipAssignmentId": "custody-assignment-001",\
> "custodianOrganizationId": "org-synthetic-001",\
> "effectivePeriod": {\
> "start": "2026-09-07"\
> },\
> "assignmentStatus": "active"\
> },\
> "container": {\
> "containerId": "container-cryovial-synthetic-001",\
> "containerType": "cryogenic_vial",\
> "status": "occupied"\
> },\
> "storageRack": {\
> "storageRackId": "rack-synthetic-001",\
> "rackType": "cryovial_rack",\
> "rowCount": 8,\
> "columnCount": 12,\
> "capacity": 96\
> },\
> "storagePosition": {\
> "storagePositionId": "position-synthetic-A01",\
> "storageRackId": "rack-synthetic-001",\
> "positionCode": "A01",\
> "rowIndex": 1,\
> "columnIndex": 1\
> },\
> "containerPositionAssignment": {\
> "containerPositionAssignmentId": "container-position-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "storagePositionId": "position-synthetic-A01",\
> "placedAt": "2026-09-07T00:00:00Z",\
> "removedAt": null\
> },\
> "specimenContainerAssignment": {\
> "specimenContainerAssignmentId": "specimen-container-001",\
> "specimenId": "specimen-synthetic-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "assignedAt": "2026-09-07T00:00:00Z",\
> "releasedAt": null\
> },\
> "physicalIdentification": {\
> "labelIdentifierId": "label-id-001",\
> "encodedValue": "BVA2:SYN:8K3M",\
> "symbology": "data_matrix",\
> "targetType": "container",\
> "targetId": "container-cryovial-synthetic-001",\
> "identifierOrigin": "manufacturer_applied",\
> "carrierPlacement": "container_base",\
> "status": "active",\
> "immutableAtSource": true\
> },\
> "rcsAssessments": \[\
> {\
> "rcsAssessmentId": "rcs-assessment-synthetic-001",\
> "specimenId": "specimen-synthetic-001",\
> "qualificationContext": {\
> "intendedUseCode": "research-sequencing",\
> "targetAnalyte": "cfDNA",\
> "assayFamily": "sequencing",\
> "workflowProtocolId": "protocol-synthetic-001",\
> "workflowProtocolVersion": "1.0"\
> },\
> "sprecVersion": "2.0",\
> "rulePackageVersion": "1.0.0",\
> "rulePackageChecksum": "sha256:synthetic-rcs",\
> "inputSnapshotId": "rcs-input-snapshot-001",\
> "inputSnapshotUri": "object://synthetic/rcs-input-snapshot-001.json",\
> "inputSnapshotHash": "sha256:synthetic-rcs-input",\
> "inputSnapshot": {\
> "rcsInputSnapshotId": "rcs-input-snapshot-001",\
> "schemaVersion": "2.0.0",\
> "immutable": true,\
> "matrix": "fluid",\
> "materialTypeCode": {\
> "code": "synthetic-plasma"\
> },\
> "matrixMappingReleaseId": "sprec-map-001",\
> "sprecVersion": "2.0",\
> "sprecMappingReleaseId": "sprec-map-001",\
> "capturedAt": "2026-09-07T00:00:00Z",\
> "sourceEventIds": \[\
> "processing-event-001",\
> "storage-event-001"\
> \],\
> "preanalyticalAxes": {\
> "P_pre": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 30,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "collection-event-001"\
> \]\
> },\
> "P_cent1": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 15,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "centrifugation-event-001"\
> \]\
> },\
> "P_cent2": {\
> "sprecCode": "N",\
> "severity": 1.0,\
> "maximumWeight": 10,\
> "weightedPenalty": 10.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "applicabilityContext": {\
> "workflow": "cell-free DNA",\
> "secondCentrifugationRequired": true\
> },\
> "evidenceIds": \[\
> "centrifugation-event-002"\
> \]\
> },\
> "P_post": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 20,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "processing-event-001"\
> \]\
> },\
> "P_store": {\
> "sprecCode": "C",\
> "severity": 0.0,\
> "maximumWeight": 25,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "storage-event-001",\
> "telemetry-summary-001"\
> \]\
> }\
> },\
> "governanceEvidence": {\
> "metadataComplete": true,\
> "terminologyValid": true,\
> "traceabilityOk": true,\
> "monitoringOk": true,\
> "documentationOk": true,\
> "semanticCompatible": true,\
> "evidenceRefs": \[\
> "custody-event-001",\
> "sop-version-001",\
> "telemetry-summary-001"\
> \],\
> "validationRuleSetVersion": "1.0.0",\
> "validationRuleSetChecksum": "sha256:synthetic-governance-gate",\
> "evaluatedAt": "2026-09-07T00:00:00Z",\
> "gateResult": "pass",\
> "failureReasons": \[\]\
> }\
> },\
> "governanceGateResult": "pass",\
> "result": {\
> "preanalyticalPenalty": 10.0,\
> "score": 90.0,\
> "scoreBasedGrade": "A",\
> "finalGrade": "A",\
> "gradeRoute": "score_based_certification",\
> "routeReasons": \[\
> "governance gate passed",\
> "RCS \>= 90"\
> \]\
> },\
> "justifications": \[\
> "All six governance evidences passed",\
> "P_bio = 10 from the five fluid axes",\
> "RCS = 100 - P_bio = 90"\
> \],\
> "calculatedAt": "2026-09-07T00:00:00Z",\
> "executionEnvironment": {\
> "runtime": "validated-package",\
> "packageVersion": "1.0.0"\
> }\
> }\
> \],\
> "provenance": {\
> "sourceSystem": "synthetic-demo",\
> "sourceRecordId": "demo-001",\
> "configurationReleaseId": "cfg-release-001",\
> "correlationId": "corr-synthetic-001"\
> }\
> }

# Apêndice B - Exemplo sintético alternativo: biorrepositório

> {\
> "canonicalModelReleaseId": "release-2.0.0",\
> "participant": {\
> "participantId": "participant-synthetic-001",\
> "identityReference": "identity-boundary:participant-synthetic-001"\
> },\
> "collection": {\
> "collectionId": "collection-biorepository-synthetic-001",\
> "governanceRegime": "biorepository",\
> "governanceContext": {\
> "biorepositoryContextId": "biorep-context-001",\
> "studyId": "study-synthetic-001",\
> "protocolId": "protocol-synthetic-001",\
> "protocolVersion": "1.0",\
> "caae": "00000000.0.0000.0000",\
> "responsibleOrganizationId": "org-synthetic-001",\
> "responsibleInvestigatorId": "actor-synthetic-001",\
> "ethicsApprovalId": "approval-synthetic-001",\
> "validityPeriod": {\
> "start": "2026-01-01",\
> "end": "2028-12-31"\
> },\
> "plannedEndDate": "2028-12-31"\
> }\
> },\
> "consent": {\
> "consentId": "consent-synthetic-001",\
> "consentModel": "specific",\
> "templateVersionId": "consent-template-001",\
> "currentStateDerived": "active",\
> "effectivePeriod": {\
> "start": "2026-09-07"\
> },\
> "permissions": \[\
> {\
> "permissionCode": "commercial_use",\
> "purpose": {\
> "code": "commercial-research"\
> },\
> "decision": "deny",\
> "policyVersion": "1.0.0"\
> }\
> \]\
> },\
> "specimen": {\
> "specimenId": "specimen-synthetic-001",\
> "accessionIdentifier": {\
> "system": "https://bioadvanced.dev/fhir/NamingSystem/accession-identifier",\
> "value": "SYN-000001"\
> },\
> "participantId": "participant-synthetic-001",\
> "collectionId": "collection-biorepository-synthetic-001",\
> "specimenRole": "primary",\
> "materialType": {\
> "code": "synthetic-plasma"\
> },\
> "specimenStatus": "available",\
> "initialQuantity": {\
> "value": 2.0,\
> "unit": "mL",\
> "system": "http://unitsofmeasure.org",\
> "code": "mL"\
> },\
> "currentQuantity": {\
> "value": 1.5,\
> "unit": "mL",\
> "system": "http://unitsofmeasure.org",\
> "code": "mL"\
> },\
> "quantityStatus": "partial",\
> "parentSpecimenIds": \[\]\
> },\
> "custodianship": {\
> "custodianshipAssignmentId": "custody-assignment-001",\
> "custodianOrganizationId": "org-synthetic-001",\
> "effectivePeriod": {\
> "start": "2026-09-07"\
> },\
> "assignmentStatus": "active"\
> },\
> "container": {\
> "containerId": "container-cryovial-synthetic-001",\
> "containerType": "cryogenic_vial",\
> "status": "occupied"\
> },\
> "storageRack": {\
> "storageRackId": "rack-synthetic-001",\
> "rackType": "cryovial_rack",\
> "rowCount": 8,\
> "columnCount": 12,\
> "capacity": 96\
> },\
> "storagePosition": {\
> "storagePositionId": "position-synthetic-A01",\
> "storageRackId": "rack-synthetic-001",\
> "positionCode": "A01",\
> "rowIndex": 1,\
> "columnIndex": 1\
> },\
> "containerPositionAssignment": {\
> "containerPositionAssignmentId": "container-position-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "storagePositionId": "position-synthetic-A01",\
> "placedAt": "2026-09-07T00:00:00Z",\
> "removedAt": null\
> },\
> "specimenContainerAssignment": {\
> "specimenContainerAssignmentId": "specimen-container-001",\
> "specimenId": "specimen-synthetic-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "assignedAt": "2026-09-07T00:00:00Z",\
> "releasedAt": null\
> },\
> "physicalIdentification": {\
> "labelIdentifierId": "label-id-001",\
> "encodedValue": "BVA2:SYN:8K3M",\
> "symbology": "data_matrix",\
> "targetType": "container",\
> "targetId": "container-cryovial-synthetic-001",\
> "identifierOrigin": "manufacturer_applied",\
> "carrierPlacement": "container_base",\
> "status": "active",\
> "immutableAtSource": true\
> },\
> "rcsAssessments": \[\
> {\
> "rcsAssessmentId": "rcs-assessment-synthetic-001",\
> "specimenId": "specimen-synthetic-001",\
> "qualificationContext": {\
> "intendedUseCode": "research-sequencing",\
> "targetAnalyte": "cfDNA",\
> "assayFamily": "sequencing",\
> "workflowProtocolId": "protocol-synthetic-001",\
> "workflowProtocolVersion": "1.0"\
> },\
> "sprecVersion": "2.0",\
> "rulePackageVersion": "1.0.0",\
> "rulePackageChecksum": "sha256:synthetic-rcs",\
> "inputSnapshotId": "rcs-input-snapshot-001",\
> "inputSnapshotUri": "object://synthetic/rcs-input-snapshot-001.json",\
> "inputSnapshotHash": "sha256:synthetic-rcs-input",\
> "inputSnapshot": {\
> "rcsInputSnapshotId": "rcs-input-snapshot-001",\
> "schemaVersion": "2.0.0",\
> "immutable": true,\
> "matrix": "fluid",\
> "materialTypeCode": {\
> "code": "synthetic-plasma"\
> },\
> "matrixMappingReleaseId": "sprec-map-001",\
> "sprecVersion": "2.0",\
> "sprecMappingReleaseId": "sprec-map-001",\
> "capturedAt": "2026-09-07T00:00:00Z",\
> "sourceEventIds": \[\
> "processing-event-001",\
> "storage-event-001"\
> \],\
> "preanalyticalAxes": {\
> "P_pre": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 30,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "collection-event-001"\
> \]\
> },\
> "P_cent1": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 15,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "centrifugation-event-001"\
> \]\
> },\
> "P_cent2": {\
> "sprecCode": "N",\
> "severity": 1.0,\
> "maximumWeight": 10,\
> "weightedPenalty": 10.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "applicabilityContext": {\
> "workflow": "cell-free DNA",\
> "secondCentrifugationRequired": true\
> },\
> "evidenceIds": \[\
> "centrifugation-event-002"\
> \]\
> },\
> "P_post": {\
> "sprecCode": "A",\
> "severity": 0.0,\
> "maximumWeight": 20,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "processing-event-001"\
> \]\
> },\
> "P_store": {\
> "sprecCode": "C",\
> "severity": 0.0,\
> "maximumWeight": 25,\
> "weightedPenalty": 0.0,\
> "resolutionStatus": "resolved",\
> "severityMappingReleaseId": "sprec-map-001",\
> "evidenceIds": \[\
> "storage-event-001",\
> "telemetry-summary-001"\
> \]\
> }\
> },\
> "governanceEvidence": {\
> "metadataComplete": true,\
> "terminologyValid": true,\
> "traceabilityOk": true,\
> "monitoringOk": true,\
> "documentationOk": true,\
> "semanticCompatible": true,\
> "evidenceRefs": \[\
> "custody-event-001",\
> "sop-version-001",\
> "telemetry-summary-001"\
> \],\
> "validationRuleSetVersion": "1.0.0",\
> "validationRuleSetChecksum": "sha256:synthetic-governance-gate",\
> "evaluatedAt": "2026-09-07T00:00:00Z",\
> "gateResult": "pass",\
> "failureReasons": \[\]\
> }\
> },\
> "governanceGateResult": "pass",\
> "result": {\
> "preanalyticalPenalty": 10.0,\
> "score": 90.0,\
> "scoreBasedGrade": "A",\
> "finalGrade": "A",\
> "gradeRoute": "score_based_certification",\
> "routeReasons": \[\
> "governance gate passed",\
> "RCS \>= 90"\
> \]\
> },\
> "justifications": \[\
> "All six governance evidences passed",\
> "P_bio = 10 from the five fluid axes",\
> "RCS = 100 - P_bio = 90"\
> \],\
> "calculatedAt": "2026-09-07T00:00:00Z",\
> "executionEnvironment": {\
> "runtime": "validated-package",\
> "packageVersion": "1.0.0"\
> }\
> }\
> \],\
> "provenance": {\
> "sourceSystem": "synthetic-demo",\
> "sourceRecordId": "demo-001",\
> "configurationReleaseId": "cfg-release-001",\
> "correlationId": "corr-synthetic-001"\
> }\
> }

# Apêndice C - Telemetria, exposição e projeção de grafo

> {\
> "physicalAssignmentPath": {\
> "specimenContainerAssignment": {\
> "specimenContainerAssignmentId": "specimen-container-001",\
> "specimenId": "specimen-synthetic-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "loadedAt": "2026-09-07T00:00:00Z",\
> "unloadedAt": null\
> },\
> "containerPositionAssignment": {\
> "containerPositionAssignmentId": "container-position-001",\
> "containerId": "container-cryovial-synthetic-001",\
> "storagePositionId": "position-synthetic-A01",\
> "placedAt": "2026-09-07T00:00:00Z",\
> "removedAt": null\
> },\
> "rackLocationAssignment": {\
> "rackLocationAssignmentId": "rack-location-001",\
> "storageRackId": "rack-synthetic-001",\
> "storageLocationId": "storage-location-freezer-001",\
> "placedAt": "2026-09-01T00:00:00Z",\
> "removedAt": null\
> }\
> },\
> "telemetryReading": {\
> "telemetryReadingId": "telemetry-reading-001",\
> "datastreamId": "datastream-temperature-001",\
> "sensorId": "sensor-001",\
> "equipmentId": "freezer-001",\
> "storageLocationId": "storage-location-freezer-001",\
> "observedAt": "2026-09-09T12:00:00Z",\
> "receivedAt": "2026-09-09T12:00:02Z",\
> "persistedAt": "2026-09-09T12:00:03Z",\
> "observedProperty": "temperature",\
> "value": -79.8,\
> "unit": {\
> "system": "http://unitsofmeasure.org",\
> "code": "Cel"\
> },\
> "sourceEventId": "evt-device-000123",\
> "idempotencyKey": "sensor-001:evt-device-000123",\
> "payloadHash": "sha256:synthetic-telemetry",\
> "clockStatus": "synchronized",\
> "schemaVersion": "2.0.0",\
> "canonicalModelReleaseId": "release-2.0.0",\
> "traceId": "trace-telemetry-001"\
> },\
> "telemetryExposureSummary": {\
> "telemetryExposureSummaryId": "telemetry-summary-001",\
> "specimenId": "specimen-synthetic-001",\
> "specimenContainerAssignmentId": "specimen-container-001",\
> "containerPositionAssignmentId": "container-position-001",\
> "rackLocationAssignmentId": "rack-location-001",\
> "exposurePathHash": "sha256:synthetic-exposure-path",\
> "datastreamIds": \[\
> "datastream-temperature-001"\
> \],\
> "windowStart": "2026-09-01T00:00:00Z",\
> "windowEnd": "2026-09-09T00:00:00Z",\
> "observationCount": 11520,\
> "minimumValue": -81.2,\
> "maximumValue": -77.5,\
> "meanValue": -79.8,\
> "timeOutsideThresholdSeconds": 120,\
> "excursionCount": 1,\
> "coverageRatio": 0.998,\
> "sourceQueryHash": "sha256:synthetic-query",\
> "sourceReadingSetHash": "sha256:synthetic-readings",\
> "calculationVersion": "1.0.0",\
> "calculatedAt": "2026-09-09T00:01:00Z"\
> },\
> "graphProjection": {\
> "eventId": "outbox-001",\
> "aggregateType": "PhysicalAssignmentPath",\
> "aggregateId": "specimen-container-001",\
> "aggregateVersion": 4,\
> "projectionSchemaVersion": "2.0.0",\
> "operation": "upsert_temporal_relationships",\
> "relationships": \[\
> {\
> "type": "CONTAINED_IN",\
> "from": {\
> "label": "Specimen",\
> "id": "specimen-synthetic-001"\
> },\
> "to": {\
> "label": "Container",\
> "id": "container-cryovial-synthetic-001"\
> },\
> "validTime": {\
> "from": "2026-09-07T00:00:00Z",\
> "to": null\
> },\
> "transactionTime": {\
> "from": "2026-09-09T12:00:04Z",\
> "to": null\
> }\
> },\
> {\
> "type": "POSITIONED_AT",\
> "from": {\
> "label": "Container",\
> "id": "container-cryovial-synthetic-001"\
> },\
> "to": {\
> "label": "StoragePosition",\
> "id": "position-synthetic-A01"\
> },\
> "validTime": {\
> "from": "2026-09-07T00:00:00Z",\
> "to": null\
> },\
> "transactionTime": {\
> "from": "2026-09-09T12:00:04Z",\
> "to": null\
> }\
> },\
> {\
> "type": "PART_OF",\
> "from": {\
> "label": "StoragePosition",\
> "id": "position-synthetic-A01"\
> },\
> "to": {\
> "label": "StorageRack",\
> "id": "rack-synthetic-001"\
> },\
> "validTime": {\
> "from": "2026-01-01T00:00:00Z",\
> "to": null\
> },\
> "transactionTime": {\
> "from": "2026-09-09T12:00:04Z",\
> "to": null\
> }\
> },\
> {\
> "type": "STORED_AT",\
> "from": {\
> "label": "StorageRack",\
> "id": "rack-synthetic-001"\
> },\
> "to": {\
> "label": "StorageLocation",\
> "id": "storage-location-freezer-001"\
> },\
> "validTime": {\
> "from": "2026-09-01T00:00:00Z",\
> "to": null\
> },\
> "transactionTime": {\
> "from": "2026-09-09T12:00:04Z",\
> "to": null\
> }\
> },\
> {\
> "type": "MONITORED_BY",\
> "from": {\
> "label": "StorageLocation",\
> "id": "storage-location-freezer-001"\
> },\
> "to": {\
> "label": "Device",\
> "id": "sensor-001"\
> },\
> "validTime": {\
> "from": "2026-01-01T00:00:00Z",\
> "to": null\
> },\
> "transactionTime": {\
> "from": "2026-09-09T12:00:04Z",\
> "to": null\
> }\
> }\
> \],\
> "payloadHash": "sha256:synthetic-graph-event",\
> "idempotencyKey": "PhysicalAssignmentPath:specimen-container-001:4"\
> },\
> "identifierNamespaceRegistry": {\
> "registryId": "namespace-registry-001",\
> "authorityDomain": "bioadvanced.dev",\
> "systemUri": "https://bioadvanced.dev/fhir/NamingSystem/specimen-id",\
> "status": "approved",\
> "version": "1.0.0",\
> "effectivePeriod": {\
> "start": "2026-09-12"\
> }\
> },\
> "interoperabilityMappingRelease": {\
> "interoperabilityMappingReleaseId": "interop-map-001",\
> "canonicalModelReleaseId": "release-2.0.0",\
> "standard": "HL7 FHIR",\
> "fhirVersion": "4.0.1",\
> "implementationGuideCanonical": "https://bioadvanced.dev/fhir/ImplementationGuide/bioadvanced",\
> "implementationGuideVersion": "1.0.0-candidate",\
> "jurisdiction": "BR",\
> "profileRegistryIds": \[\
> "profile-registry-specimen-001"\
> \],\
> "resourceTypes": \[\
> "Patient",\
> "Specimen",\
> "Consent",\
> "Observation",\
> "DiagnosticReport",\
> "Provenance",\
> "AuditEvent",\
> "DocumentReference",\
> "ResearchStudy"\
> \],\
> "identifierNamespaceRegistryIds": \[\
> "namespace-registry-001"\
> \],\
> "terminologyReleaseIds": \[\
> "terminology-release-001"\
> \],\
> "mappingDefinitionUri": "object://synthetic/interoperability/mapping.json",\
> "mappingDefinitionHash": "sha256:synthetic-mapping",\
> "conformanceTestReportUri": "object://synthetic/interoperability/conformance-report.json",\
> "coverageNumerator": 9,\
> "coverageDenominator": 9,\
> "coverageRatio": 1.0,\
> "roundTripLossesPresent": true,\
> "roundTripLossReportUri": "object://synthetic/interoperability/round-trip-losses.json",\
> "status": "approved",\
> "approvedBy": \[\
> "governance-actor-synthetic-001"\
> \],\
> "approvedAt": "2026-09-12T00:00:00Z",\
> "effectivePeriod": {\
> "start": "2026-09-12"\
> }\
> }\
> }

# Apêndice D - Fontes utilizadas

| **ID** | **Fonte** | **Uso** | **Disponibilidade** |
|:---|:---|:---|:---|
| SRC-DESIGN | Texto de reestruturação e princípio arquitetural | Flexibilidade configuracional, acessibilidade e limites das alegações | Referenced by checklist; exact named file not separately attached |
| SRC-DICT | Dicionário de Dados Consolidado v1.3.0 | Baseline de 929 elementos | Available |
| SRC-REQ | Requisitos Funcionais e Não Funcionais v3.0.1 | RF001–RF029 e RNF | Available |
| SRC-IDF | RF016 e elementos ELM-0115–0116 | Etiquetas, Code 128, DataMatrix, QR Code e identificadores operacionais | Available |
| SRC-POLY | Polyglot Persistence Data Model | Entidades, stores e fronteiras | Available |
| SRC-PIPE | Integrated Foundation Data Pipeline Plan | Semântica das fases e gates | Available |
| SRC-BACK | Plano Backend BioAvanceD v3 — Fase 1 | Implementação e Definition of Done | Referenced by checklist; exact named file not separately attached |
| SRC-DSR | Dissertação BioAvanceD | Escopo DSR e definição AI-ready | Referenced by checklist; exact named file not separately attached |
| SRC-RCS | Artigo e suplementos RCS | Qualificação contextual SPREC 2.0 | Referenced by checklist; exact named file not separately attached |
| SRC-FHIR | HL7 FHIR R4 | Interoperabilidade | Available |
| SRC-MIABIS | MIABIS | Metadados de biobancos e coleções | Available |
| SRC-SPREC2 | SPREC 2.0 | Baseline pré-analítica do RCS | Available |
| SRC-SPREC4 | SPREC 4.0 | Roadmap posterior à validação real | Available |
| SRC-ISO20387 | ISO 20387:2018 / ABNT NBR ISO 20387:2020 | Alinhamento operacional de biobancos | Available |
| SRC-ISO21899 | ISO 21899:2020 / ABNT NBR ISO 21899:2025 | Validação/verificação de processamento | Available |
| SRC-ISO23494 | ISO 23494-1/-2:2026 | Roadmap de proveniência | Available |
| SRC-BR | Portaria MS 2.201/2011 e Resolução CNS 441/2011 | Biobanco, biorrepositório e TCLE | Available |
| SRC-LGPD | Lei 13.709/2018 — LGPD | Privacidade e dados sensíveis | Available |
| SRC-FAIRAI | Huerta et al. 2023 — FAIR for AI | Definição AI-ready | Available |
| SRC-DYN | Kaye et al. 2015; Budin-Ljøsne et al. 2017 | Consentimento dinâmico | Available |
| SRC-LOCAL-21 | Checklist_Atualizacoes_Modelo_Canonico_BioAvanceD(1)(1).xlsx | Baseline/specification | Available |
| SRC-DSR-V6 | PROJETO DE PESQUISA - L2 - DENISE RIBEIRO v6 | Research scope, objectives and DSR framing | Available |
| SRC-QUALI | Design Research BioAvanceD - Qualificação de Mestrado | DSR methodology, ex ante evaluation and dissertation consistency | Available |
| SRC-PIPE-HIST | Historical Foundation Data Pipeline plan | Historical comparison only; superseded by pipeline derived from canonical v2.0.0 | Available |
| SRC-RCS-CANON-S1 | Supplementary File 1. SPREC Reference and Severity Tables | Canonical SPREC 2.0 codes and intra-axis severity mapping for RCS | Available; SHA-256 65d79949adef09fec6f90971df4733576ab4f65eaf4fe35c2c52db8af77c07c4 |
| SRC-RCS-CANON-S2 | Supplementary File 2. Supplementary Methods | Canonical governance gate, matrix-specific axes, weights, equations, thresholds and routes | Available; SHA-256 45cb972f75f040a928c8c3fd55113b792c8aa74b4304614c5328aca854ba98b5 |
| SRC-TEL-ISO21823-1 | ISO/IEC 21823-1:2019 Internet of Things — Interoperability for IoT systems — Part 1 | IoT interoperability framework and boundaries | Official page |
| SRC-TEL-ISO21823-4 | ISO/IEC 21823-4:2022 Syntactic interoperability | Interoperable telemetry contracts | Official page |
| SRC-TEL-OGCSTA | OGC SensorThings API Part 1: Sensing 1.1 | Observation, Datastream, Sensor, Thing and Location mappings | Official specification |
| SRC-TEL-WOT | W3C Web of Things Thing Description 1.1 | Device communication metadata | Official specification |
| SRC-TEL-CLOUDEVENTS | CloudEvents Specification 1.0 | Event envelope, identity and idempotent ingestion | Official specification |
| SRC-GRAPH-GQL | ISO/IEC 39075:2024 Database languages — GQL | Property-graph terminology and formal projection preparation | Official page |
| SRC-TEL-JIANG2024 | Jiang et al. (2024), IoT cold-chain monitoring framework | Theoretical support for traceable remote cold-chain telemetry | Open access |
| SRC-TEL-AHMED2023 | Ahmed et al. (2023), sensor data provenance | Theoretical support for provenance and verifiable observation lineage | Open access |
| SRC-ID-ISO16022 | ISO/IEC 16022:2024, Automatic identification and data capture techniques — Data Matrix bar code symbology specification | Normative definition of Data Matrix and ECC 200; basis for governed symbology profile | Official ISO record |
| SRC-ID-FILIPOWICZ2022 | Filipowicz et al. (2022), Comprehensive cancer-oriented biobanking resource of human samples | Peer-reviewed evidence of Data-Matrix-coded tubes integrated with biobank software and sample registration | Open access |
| SRC-ID-BUKREEVA2024 | Bukreeva et al. (2024), Biobank Digitalization: From Data Acquisition to Efficient Use | Peer-reviewed review supporting digital sample identification, automation and traceable biobank workflows | Open access |
