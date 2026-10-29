Plano final derivado do modelo canônico v2.0.0 aprovado e de seus gates

Release documental aprovada e final \| 12 de setembro de 2026

| **Princípio central: flexibilidade configuracional com invariantes arquiteturais e de governança.** |
|----|

# 1. Status e autoridade

Este plano substitui, como autoridade de execução, os planos de pipeline anteriores. Os documentos históricos foram consultados somente para rastrear decisões compatíveis. A sequência, os artefatos, os gates e o rollback abaixo derivam do BioAvanceD Canonical Data Model v2.0.0 aprovado e final. A aprovação documental não significa que o pipeline tenha sido executado.

# 2. Objetivo

Preparar integralmente, na Fase 1, a estrutura necessária para validação, governança e população posterior; popular referências aprovadas na Fase 2; e receber dados operacionais e científicos autorizados na Fase 3. A Fase 1 nunca cria participantes, consentimentos, espécimes ou dados científicos operacionais para satisfazer cardinalidade.

# 3. Princípios de execução

- One-shot retomável: toda execução possui idempotency keys, checkpoints e relatório.

- Dry-run antes de apply; verify após apply; rollback testado e rastreável.

- Paridade de canonicalModelReleaseId e checksums entre schemas, enums, contratos, mappings e testes.

- Falha de invariante ou P0 bloqueia promoção.

- Autoridade de store fixa; TelemetryReading integral no InfluxDB; Neo4j reconstruível do outbox; FHIR não persiste o operacional.

- As atribuições specimen-container, container-position e rack-location usam intervalos semiabertos; resumos de exposição são derivados e reproduzíveis.

- MQTT, HTTPS e adaptadores aprovados convergem diretamente para o contrato canônico.

- Staging e quarentena isolam dados inválidos sem contaminar releases ativas.

- Toda evidência binária fica em Object Storage com metadados no MongoDB.

# 4. Fase 1 - Foundation Data Pipeline

| **Etapa** | **Ação** | **Artefatos** | **Gate** |
|:---|:---|:---|:---|
| F1.0 Preflight | Inventariar release, dependências, stores, permissões e capacidade de rollback. | CanonicalModelRelease; contract checksums | Bloquear se versão ou dependência divergir |
| F1.1 Dry-run | Validar schemas, enums, índices, relacionamentos, configurações e migrations sem mutação. | FoundationDataRun.executionMode=dry_run | Zero mutação operacional |
| F1.2 Registry | Registrar release canônica, catálogo de invariantes, perfis e releases de configuração. | CanonicalModelRelease; GovernanceInvariantCatalog; ConfigurationRelease | Uma release ativa por ambiente |
| F1.3 Schemas | Preparar entidades, campos, cardinalidades, validações condicionais e enums. | 1644 elementos e 146 entidades/artefatos | 929 IDs históricos presentes; V2E únicos |
| F1.4 Storage | Criar/validar collections, índices, policies de objeto, buckets lógicos, retention e Redis transitório. | Persistence routing | Nenhuma autoridade paralela |
| F1.5 Outbox/audit | Preparar outbox transacional, projector temporal idempotente, checkpoint, dead-letter, replay e hash append-only. | GraphProjectionOutboxEvent; GraphProjectionCheckpoint; AuditEvent | Sem dual-write, PII ou leitura bruta no grafo |
| F1.5a Telemetria | Preparar schemas, datastreams, tempos, identidade idempotente, validação, quarentena, intervalos de armazenamento e resumos. | TelemetryReading; TelemetryDatastream; SpecimenContainerAssignment; ContainerPositionAssignment; RackLocationAssignment; TelemetryExposureSummary | Toda leitura autoritativa no InfluxDB; referências mestres validadas no MongoDB |
| F1.5b Topologia física | Preparar Container, StorageRack, StoragePosition e atribuições temporais; registrar protocolo ex ante. | Container; StorageRack; StoragePosition; ContainerPositionAssignment; SpecimenContainerAssignment | Tubo vazio não cria Specimen; uma ocupação ativa por posição; execução física somente com protocolo approved_for_execution |
| F1.6 Domain gates | Preparar regimes de Collection, consentimento, estado/quantidade/destinação, RCS e identificação física. | Regras condicionais, incluindo matriz/eixos/gate/rota RCS | Casos positivos, negativos e Not scored passam |
| F1.7 Reference mechanisms | Preparar staging, parser registry, mapping registry, quarantine, coverage e promoção. | ReferenceImportRun; Issue; CoverageManifest | Nenhum dado de referência ainda precisa ser populado |
| F1.8 Interoperability | Preparar adaptadores puros, mapping releases, perfis, namespaces, testes, cobertura e relatório de round-trip. | InteroperabilityMappingRelease; FHIRProfileRegistry; IdentifierNamespaceRegistry | Nenhuma escrita direta por serializador |
| F1.9 Analytics readiness | Preparar snapshots, qualidade, missingness, labels/features/coortes e entidades futuras inativas. | AIReadinessAssessment | Não ativar ModelArtifact |
| F1.10 Verify | Executar suites, reconciliação, inspeção de PII e pós-condições. | ConfigurationValidationRun; validation evidence | Todos P0 tratados; zero dado operacional indevido |
| F1.11 Promote/rollback | Emitir ReadinessReport; promover ou reverter atomicamente. | ReadinessReport; FoundationDataRun report | Promoção somente status=ready |

# 5. Fase 2 - Reference Data Population

1.  Registrar ReferenceDatasetRelease com origem, licença, versão, checksum, formato, parser e mapping.

2.  Adquirir somente assets/endpoints aprovados e registrar o manifesto esperado.

3.  Carregar em staging isolado e verificar integridade antes do parsing.

4.  Normalizar conceitos e relações com versionamento e sourceRecordId.

5.  Registrar ReferenceImportIssue e quarentena por linha/campo sem promover registros inválidos.

6.  Gerar ReferenceCoverageManifest com contagens esperadas/obtidas, exclusões e justificativas.

7.  Executar DataQualityAssessment e testes de conceitos órfãos, mappings, UCUM e compatibilidade.

8.  Aprovar e promover a release; publicar outbox; projetar relações permitidas no Neo4j.

9.  Reconciliar MongoDB, objetos e Neo4j; testar rollback para a release anterior.

| **Gate F2** | **Critério** | **Falha** |
|:---|:---|:---|
| Integridade | Checksum e tamanho conferem | Rejeitar asset |
| Licença | Licença e origem documentadas | Bloquear ingestão |
| Parser/mapping | Versões compatíveis e testadas | Quarentena |
| Cobertura | Contagem completa ou exclusão justificada | Bloquear promoção |
| Qualidade | Limiares aprovados | Bloquear promoção |
| Projeção | Outbox reconciliado e idempotente | Reprocessar/rollback |

# 6. Fase 3 - Operational and Scientific Data Population

10. Receber payload canônico e registrar sourceSystem, sourceRecordId, release, configuração e correlação.

11. Validar schema, tipos, cardinalidades, referências ativas, unidades e missingness.

12. Aplicar segregação da identidade e pseudonimização antes de projeções ou exportações.

13. Avaliar Collection.governanceRegime, contexto, aprovação, custódia, consentimento, finalidade e AccessPolicy.

14. Persistir dados operacionais no MongoDB; TelemetryReading integral no InfluxDB; binários no Object Storage; Redis somente transiente.

15. Deduplicar telemetria por ID/chave, distinguir observedAt/receivedAt/persistedAt, validar Device/Location e preservar payloadHash.

16. Associar leituras a espécimes somente pela interseção temporal da cadeia física normalizada; gerar TelemetryExposureSummary reproduzível.

17. Persistir o outbox na mesma transação do agregado MongoDB e projetar no Neo4j por aggregateVersion, com checkpoint e idempotência; não projetar PII ou leituras brutas.

18. Registrar Container e LabelIdentifier independentemente de Specimen; criar SpecimenContainerAssignment e ContainerPositionAssignment somente quando houver evento válido e auditável.

19. Registrar auditoria append-only, cadeia de custódia, impressão/leitura e decisões de autorização.

20. Executar RCS somente com matriz explícita, cinco eixos aplicáveis, códigos SPREC 2.0, severidades resolvidas, seis evidências do gate, snapshot imutável/resolvível, pacote/checksums e ambiente.

21. Derivar P_bio, score, scoreBasedGrade, finalGrade e gradeRoute; impedir score compensável diante de falha do gate ou entrada não resolvida.

22. Produzir DataQualityAssessment e, quando autorizado, DatasetSnapshot e workflows científicos.

23. Manter estruturas de modelos inativas até projeto futuro e gates específicos.

# 7. Matriz de artefatos por fase

| **Artefato** | **Fase 1 prepara** | **Fase 2 popula** | **Fase 3 popula/ativa** |
|:---|:---|:---|:---|
| CanonicalModelRelease / invariants | Sim | Não | Referenciado |
| ConfigurationProfile/Release | Sim | Perfis institucionais aprovados | Referenciado em decisões |
| ReferenceDatasetRelease/import/coverage | Sim | Sim | Referenciado |
| Collection/contexts/approvals | Schema e regras | Catálogos aplicáveis | Sim |
| Consent e eventos | Schema e regras | Templates aprovados | Sim |
| Specimen/custody/disposition | Schema e regras | Catálogos | Sim |
| Label templates/device profiles/policy | Schema | Homologados | Etiquetas e scans reais |
| RCS package/SPREC mapping | Schema e baseline | Releases aprovadas | Referenciado pela avaliação |
| RCS input/axes/governance evidence | Schema, cardinalidades e gates | Mappings/severidades aprovados | Snapshots e assessments contextuais |
| Dataset/quality/snapshot | Schema e gate | Vocabulários | Quando autorizado |
| Model governance | Schema inativo | Não | Somente projeto futuro aprovado |

# 8. Contrato FoundationDataRun

| **Campo** | **Regra** |
|:---|:---|
| canonicalModelReleaseId | Obrigatório e igual em todos os contratos |
| contractChecksums | Schemas, enums, mappings, invariantes e policies |
| migrationPlanId | Plano v1.3.0→v2.0.0 imutável |
| executionMode | validate, dry_run, apply, repair ou rollback |
| steps/checkpoints | Ordenados, retomáveis e idempotentes |
| dryRunResult/applyResult/verifyResult/rollbackResult | Resultados explícitos conforme o modo |
| reportUri | Relatório completo em Object Storage |
| postCondition | Zero registros operacionais não autorizados criados na Fase 1 |

# 9. Gates de prontidão

| **Gate** | **Evidência mínima** | **Bloqueador** |
|:---|:---|:---|
| Versão | Paridade de release/checksums | Qualquer divergência |
| Configuração | ConfigurationValidationRun aprovado | Invariante ou dependência falha |
| Biobanco/biorrepositório | Regime e contexto exclusivo | Coleção ambígua |
| Consentimento | Decisão permit/deny/review_required reproduzível | Uso sem consentimento/finalidade |
| Espécime | Máquina de estados e ledger reconciliados | Estado misto ou quantidade manual |
| RCS | Matriz, cinco eixos, códigos/severidades, seis evidências, snapshot/hash/URI, P_bio e rota | Entrada ausente/não resolvida, hash divergente ou resultado não recalculável |
| Identificação | PII scan, resolução e backend authorization | PII ou resolver autorizando operação |
| Persistência | Outbox, replay e reconciliação | Dual-write ou PII no grafo |
| FHIR | Transformação pura e round-trip report | Persistência paralela |
| AI-ready | Contratos, qualidade, lineage e inatividade dos modelos | Alegação/ativação de IA |

# 10. Estratégia de rollback

- Nenhuma evidência ou registro histórico é sobrescrito.

- Releases possuem supersedesId e rollbackTargetId.

- Falha antes da promoção descarta staging/quarentena conforme política, preservando o relatório.

- Falha após promoção reativa a release estável anterior e registra ConfigurationChangeEvent/AuditEvent.

- Neo4j é reconstruído do outbox da fonte canônica.

- Arquivos usam DataFileVersion; objetos anteriores permanecem identificáveis por checksum.

- Avaliações RCS históricas continuam ligadas ao pacote e SPREC usados.

# 11. Testes mínimos

| **Grupo** | **Testes** |
|:---|:---|
| Contratos | Schema positivo/negativo; aliases legados 422; cardinalidades |
| Identidade | Deduplicação/idempotência; PII leak tests |
| Configuração | dry-run/apply/verify/rollback; tentativa de override |
| Coleção | contexto por regime; ativação/expiração; mudança auditada |
| Consentimento | consentir→alterar→revogar; matriz de permissões |
| Espécime | transições; ledger; fechamento; alíquota/derivação |
| Telemetria | ID/idempotência; tempos; clock drift; lacunas; autoridade Influx; referência de mestres; payload hash; PII |
| Exposição | intervalo semiaberto; associação por local/equipamento; cobertura; recálculo e hashes |
| RCS | golden vectors fluid/solid; cinco eixos; seis evidências; recálculo P_bio/RCS; classes A-E; governance_failure; unknown/Not scored |
| Identificação física | Data Matrix do tubo; código do rack; 96 posições; tubo vazio; ocupação temporal; PII; resolução sem autorização |
| Referências | falha/retomada; cobertura; rollback |
| Outbox/grafo | ordem aggregateVersion; interrupção; replay; checkpoint; idempotência; rebuild; ausência de PII/leitura bruta |
| FHIR | release, perfis, namespaces, conformidade, cobertura, round-trip e ausência de escrita operacional |
| Readiness | P0 bloqueia promoção; Fase 1 com zero dados operacionais |

# 12. Evidências de saída

- FoundationDataRun e relatório completo.

- ConfigurationValidationRun e catálogo de invariantes verificado.

- ReadinessReport com cobertura P0 e blockers.

- Manifests de schemas, enums, índices, mappings e checksums.

- Relatórios de PII, outbox/replay, reconciliação e round-trip.

- ReferenceImportRun, issues e coverage manifest na Fase 2.

- AuditEvent, snapshots e evidências de domínio na Fase 3.

# 13. Limitações e decisões futuras

O plano é arquitetural e não contém scripts de implantação nem dados reais. Parâmetros de infraestrutura, catálogos iniciais, endpoints, perfis nacionais, templates e dispositivos dependem de aprovação institucional. O protocolo de identificação física v1.0.0 está approved_for_execution, mas sua execução e seus resultados permanecem posteriores; validação externa do RCS e qualquer projeto de IA continuam condicionados.
