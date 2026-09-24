**Divergências, decisões, riscos e cobertura da revisão controlada**

Release documental aprovada e final \| 12 de setembro de 2026

| **Princípio central: flexibilidade configuracional com invariantes arquiteturais e de governança.** |
|----|

# 1. Resultado executivo

A revisão contabilizou os 929 elementos da v1.3.0 e consolidou a release final v2.0.0 com 1644 elementos em 146 entidades/artefatos. Foram adicionados 715 elementos na faixa exclusiva V2E-0001 a V2E-0715. As 97 ações do checklist foram tratadas: 73 P0, 19 P1 e 5 P2. A release está formalmente aprovada; isso não implica execução do pipeline nem aprovação de resultados experimentais.

**Status documental: modelo canônico v2.0.0 = approved/final; protocolo de identificação física v1.0.0 = approved_for_execution; execução ex ante = não realizada.**

| **Status de mudança** | **Quantidade** |
|-----------------------|----------------|
| maintained            | 747            |
| replaced              | 13             |
| deprecated            | 17             |
| altered               | 151            |
| renamed               | 3              |
| added                 | 713            |

# 2. Divergências e decisões aplicadas

| **Tema** | **Divergência** | **Decisão aplicada** | **Impacto** |
|----|----|----|----|
| Specimen.specimenStatus | v1.3.0 incluía partial, depleted e destroyed no estado operacional. | Campo histórico substituído semanticamente; novo V2E specimenStatus usa somente seis estados. QuantityStatus e DispositionAction são separados. | Alta; migração determinística e evidência de destinação. |
| Consentimento | v1.3.0 combinava booleans de permissões, status runtime e dados de revogação no Consent. | Normalização em ConsentPermission, ConsentDecisionEvent, ConsentRevocation e ConsentAuthorizationDecision; histórico preservado. | Alta; exige transformação e reconciliação. |
| Identificação física | barcodeValue era um atributo isolado do Specimen. | Campo depreciado para escrita; LabelIdentifier, template, device, policy, print e scan formalizam o ciclo. | Média; criar representação mantendo provenance. |
| Biobanco/biorrepositório | Collection não possuía regime computável obrigatório. | governanceRegime e contexto exclusivo por regime, aprovação e custódia. | Alta; coleções não conformes não podem ser ativadas. |
| RCS | O primeiro exemplo preservava resultado e hash, mas não as entradas suficientes para recalcular. | Adicionados RCSInputSnapshot, cinco eixos por matriz, códigos SPREC, severidades, pesos, penalidades, seis evidências do gate, P_bio, classes e rota. | Alta; avaliações antigas permanecem históricas e não equivalentes sem snapshot integral. |
| Persistência | Alguns destinos v1.3.0 apareciam como MongoDB/Neo4j. | Interpretação fixada: MongoDB é autoridade; Neo4j é projeção derivada por outbox. | Alta; proíbe dual-write. |
| FHIR | Mappings anteriores podiam sugerir proximidade estrutural ou que interoperabilidade dependeria de persistir uma cópia FHIR. | FHIR R4 permanece fronteira de interoperabilidade. Todos os perfis nacionais e internacionais aplicáveis ao escopo institucional devem ser homologados por FHIRProfileRegistry e InteroperabilityMappingRelease, incluindo perfis adotados por RNDS/DATASUS quando aplicáveis. Recursos recebidos são transformados para o modelo canônico; representações de intercâmbio podem ser preservadas como evidência versionada no Object Storage, sem banco operacional FHIR paralelo. Perdas e extensões são registradas. | Alta; amplia cobertura interoperável sem criar segunda fonte de verdade nem prometer equivalência automática com perfis desconhecidos. |
| SPREC | Versões futuras poderiam ser confundidas com baseline ativo. | SPREC 2.0 permanece baseline atual; SPREC 4.0 somente roadmap. | Alta para reprodutibilidade histórica. |
| Pipeline | Planos anteriores antecedem a release v2.0.0. | Plano recriado a partir do novo modelo; antigos são apenas referências históricas. | Alta; gates alinhados ao checklist. |
| IA futura | Estruturas futuras poderiam ser lidas como funcionalidade implementada. | ModelArtifact, ModelCard e correlatos ficam inativos e condicionados. | Alta para evitar extrapolação de escopo. |
| Telemetria | Campos de referência da leitura podiam aparentar autoridade MongoDB e faltavam identidade idempotente, local e resumo reproduzível. | Todo TelemetryReading é autoritativo no InfluxDB; mestres permanecem no MongoDB; foram adicionados ID, tempos, hashes, local e TelemetryExposureSummary. | Alta; elimina ambiguidade e permite auditoria da exposição. |
| Grafo temporal | Relações de armazenamento e temporalidade não estavam integralmente formalizadas. | A cadeia normalizada liga espécime, recipiente, posição, rack e local por intervalos semiabertos; projeção usa versões, checkpoint, idempotência e replay. | Alta; projeção reconstruível e temporalmente verificável. |
| Ingestão remota | Uma extensão adicional de gerenciamento remoto havia sido considerada. | A extensão foi retirada; MQTT, HTTPS e adaptadores aprovados alimentam o contrato canônico sem nova camada de serviço. | Baixa; reduz dependências e preserva a autoridade do backend. |

# 3. Duplicidades e reutilização

A revisão reutilizou entidades existentes sempre que a semântica podia ser ampliada sem ambiguidade: Collection, ConsentTemplate, Consent, Specimen, CustodyEvent, DispositionAction, RCSAssessment, FoundationDataRun, GraphProjectionOutboxEvent, DataFile, WorkflowRun, AccessPolicy, RetentionPolicy, ReferenceDatasetRelease e AuditEvent. Novas entidades foram reservadas para conceitos com identidade, ciclo de vida, cardinalidade ou autoridade próprios.

Alíquota não foi criada como entidade paralela: permanece Specimen com specimenRole=aliquot e parentSpecimenIds. Em identificação física, um alvo apresentado como aliquot resolve para a entidade canônica Specimen correspondente.

# 4. Enums incompatíveis

| **Campo** | **Valores v2** | **Valores proibidos nesse enum** | **Tratamento** |
|----|----|----|----|
| Specimen.specimenStatus | available; reserved; checked_out; quarantined; unavailable; closed | partial; depleted; destroyed; disposed | Quantidade e destinação em dimensões próprias |
| Specimen.quantityStatus | full; partial; depleted | estados operacionais | Derivado, somente leitura |
| DispositionAction.action | transfer; return; destroy; preserve | DISPOSED como estado | Ação com ciclo próprio |
| ConsentAuthorizationDecision.result | permit; deny; review_required | allowed/blocked como substituição silenciosa | Decisão contextual e justificada |

# 5. Validações obrigatórias

Correção da VAL-016: o FAIL observado na geração anterior era um falso negativo do verificador. A regra testava se preanalyticalPenalty, scoreBasedGrade, finalGrade e gradeRoute estavam exclusivamente no mapa temporário de novos IDs; alguns campos já haviam sido emitidos pelo fluxo principal do dicionário e, por isso, não permaneciam nesse mapa. O contrato RCS não estava incompleto. O teste foi corrigido para verificar a presença efetiva de cada entidade/campo no DICIONARIO_V2. Após a correção, VAL-016 retorna PASS e confirma os quatro componentes do resultado.

| **ID** | **Validação** | **Resultado** | **Observado** | **Esperado** |
|----|----|----|----|----|
| VAL-001 | All 929 historical elements accounted for | PASS | 929 | 929 |
| VAL-002 | No historical identifier reused for a new element | PASS | pass | pass |
| VAL-003 | All new identifiers unique | PASS | pass | pass |
| VAL-004 | Checklist actions covered | PASS | 97 | 97 |
| VAL-005 | P0 actions treated | PASS | 73 | 73 |
| VAL-006 | Physical identification actions treated | PASS | 10 | 10 |
| VAL-007 | All relationships have cardinality | PASS | pass | pass |
| VAL-008 | Operational specimen status excludes DISPOSED/DESTROYED/PARTIAL/DEPLETED | PASS | pass | pass |
| VAL-009 | SPREC 2.0 is current RCS baseline and 4.0 roadmap only | PASS | pass | pass |
| VAL-010 | FHIR is boundary, not parallel persistence | PASS | pass | pass |
| VAL-011 | Neo4j is controlled outbox projection | PASS | pass | pass |
| VAL-012 | No PII authorized for labels or Neo4j | PASS | pass | pass |
| VAL-013 | Future AI structures are inactive and conditional | PASS | pass | pass |
| VAL-014 | RCS input preserves explicit matrix, five axes, SPREC codes, severities, weights and immutable snapshot | PASS | pass | pass |
| VAL-015 | RCS governance gate preserves all six individual evidence results | PASS | pass | pass |
| VAL-016 | RCS result preserves P_bio, score-based grade, final grade and classification route | PASS | pass | pass |
| VAL-017 | Every TelemetryReading element is authoritative in InfluxDB | PASS | pass | pass |
| VAL-018 | TelemetryReading has unique idempotent identity and storage location correlation | PASS | pass | pass |
| VAL-019 | TelemetryExposureSummary is reproducible from normalized assignment path, coverage and hashes | PASS | pass | pass |
| VAL-020 | Legacy StorageAssignment is deprecated and the normalized physical chain is complete | PASS | pass | pass |
| VAL-021 | Temporal graph projection has version, checkpoint, idempotency and rebuild rules | PASS | pass | pass |
| VAL-022 | Raw telemetry and PII are prohibited in Neo4j | PASS | pass | pass |
| VAL-023 | Withdrawn experimental extension is absent and its former identifier range is not reused | PASS | pass | pass |
| VAL-024 | Empty container is distinct from specimen and can occupy a storage position | PASS | pass | pass |
| VAL-025 | FHIR mapping release preserves profiles, namespaces, conformance, coverage, losses and approval | PASS | pass | pass |
| VAL-026 | Internal identifier namespaces use the approved bioadvanced.dev authority | PASS | pass | pass |
| VAL-027 | Ex ante physical identification protocol prohibits real specimens | PASS | pass | pass |
| VAL-028 | No active physical or telemetry relationship depends on StorageAssignment | PASS | pass | pass |

# 6. Cobertura do checklist

| **Prioridade** | **Total** | **Cobertos** | **Pendentes no modelo** |
|----------------|-----------|--------------|-------------------------|
| P0             | 73        | 73           | 0                       |
| P1             | 19        | 19           | 0                       |
| P2             | 5         | 5            | 0                       |

Coberto significa que a release final contém entidade, campo, regra, decisão, teste ou evidência documental correspondente. Não significa que a funcionalidade esteja implementada nem que validação operacional ou externa já tenha ocorrido.

# 7. Riscos de migração

- Conversão incorreta de partial/depleted/destroyed pode produzir estado operacional inválido ou fechamento sem evidência.

- Booleans de consentimento podem perder condições e vigência se forem transformados sem snapshot e proveniência.

- Projeção Neo4j deve ser reconstruída pelo outbox; qualquer escrita direta invalida a rastreabilidade.

- Etiquetas legadas podem conter conteúdo indevido; devem passar por scanner de PII e política de reemissão.

- Avaliações RCS históricas sem contexto completo não devem ser promovidas como equivalentes às novas avaliações.

- Referências sem licença, checksum, parser, mapping e cobertura não podem ser ativadas.

- Configurações institucionais não versionadas devem ser recusadas até migração para ConfigurationRelease.

# 8. Decisões consolidadas nesta revisão

- FHIR permanece fronteira de interoperabilidade e não persistência operacional paralela. O objetivo é homologar todos os perfis aplicáveis ao intercâmbio nacional e internacional por releases versionadas, incluindo RNDS/DATASUS quando aplicável, com cobertura e perdas mensuráveis.

- A ativação de estruturas futuras de modelos será tratada na DSR como trabalho futuro de outra pesquisa; as estruturas permanecem inativas no escopo atual.

- Validação com dados e bioespécimes reais, incluindo retenção operacional, será tratada como trabalho futuro e dependerá das aprovações aplicáveis.

- Tubos com DataMatrix, sem amostras, serão usados nos testes ex ante de registro, impressão, leitura, resolução, unicidade e rastreabilidade.

- A validação operacional de QR Code com amostras reais fica para etapa futura; QR Code permanece opção configurável, não homologada operacionalmente nesta fase.

- O catálogo disponível de freezers será usado como entrada sintética/controlada nos testes ex ante de cadastro, topologia, perfis de equipamento e associação com telemetria.

## 8.1 Atividades posteriores à aprovação documental

- A release canônica v2.0.0 está formalmente aprovada e final nesta versão documental, com vigência documental a partir de 12 de setembro de 2026.

- Homologar continuamente perfis FHIR por release: entrada documentada, versões, cobertura mensurada, testes positivos e negativos, validação de terminologias, perdas de round-trip, responsável, aprovação, vigência e supersessão.

- Homologar identifier.system externos apenas quando a instituição correspondente for integrada; os namespaces internos iniciais passam a usar a autoridade https://bioadvanced.dev/.

- Executar o protocolo ex ante dos tubos Data Matrix e do catálogo de freezers, cujo desenho metodológico v1.0.0 está approved_for_execution; a execução, o resultado e a confirmação instrumental da simbologia e do conteúdo do código linear do rack permanecem pendentes.

- Manter, como roadmap da DSR e não como escopo implementado, estudos futuros com dados reais, retenção operacional, QR Code, validação externa do RCS e estruturas de modelos, sujeitos às aprovações próprias quando forem iniciados.

# 9. Itens fora do escopo e não implementados

- Código da aplicação, migrations executáveis e alteração de repositórios.

- População de participantes, consentimentos, espécimes ou dados reais.

- Certificação ou declaração de conformidade ISO.

- Banco FHIR operacional, persistência paralela ou dual-write.

- Apoio à decisão clínica.

- IA/modelos implementados, treinados, validados ou promovidos.

- Ativação de SPREC 4.0 ou substituição da SPREC pelo RCS.

- Dependência obrigatória de fabricante de etiquetas, leitores ou impressoras.

# 10. Comparação controlada com a dissertação DSR anexa

A dissertação Design_Research_BioAvanceD_Qualificacao_Mestrado(3).docx foi auditada em modo somente leitura. Por decisão da autora, nenhuma alteração foi aplicada à DSR nesta etapa; as proposições abaixo permanecem registradas para eventual incorporação posterior.

| **Localização na DSR** | **Constatação** | **Mudança proposta para aprovação** | **Motivo** |
|----|----|----|----|
| Resumo/abstract; §§ de resultados e anexos que apresentam 64 fontes, 929 elementos, 79 entidades, 26 domínios e 58 mappings | Os números descrevem a baseline v1.3.0, mas podem ser lidos como estado atual. | Manter os números explicitamente como baseline histórica e acrescentar, em frase separada, as contagens auditadas da v2.0.0: 1644 elementos e 146 entidades/artefatos. | Evitar contradição entre resultados históricos e artefato canônico vigente. |
| Seção 1.7 Telemetria, cadeia de frio e resposta operacional | A fundamentação conceitual está coerente, mas o contrato das observações e a associação temporal não aparecem com o mesmo detalhamento do modelo. | Acrescentar, usando somente as referências já levantadas, a distinção observedAt/receivedAt/persistedAt, idempotência, correlação pela cadeia SpecimenContainerAssignment, ContainerPositionAssignment e RackLocationAssignment e resumo de exposição reproduzível. | Alinhar texto científico às correções 1–4 e 6–7. |
| Seção 4. Representação matemática do grafo | A formulação de grafo temporal/outbox está alinhada em princípio. | Confirmar explicitamente o intervalo semiaberto \[placedAt, removedAt), a condição de associação leitura-espécime e o checkpoint por aggregateVersion, sem transformar Neo4j em autoridade. | Alinhar a demonstração às correções 5–7. |
| Descrição da arquitetura e figuras C4 | Sensores, telemetria e worker de projeção estão representados. | Manter somente MQTT, HTTPS e adaptadores de dispositivo como canais de ingestão; não acrescentar camada externa de gerenciamento remoto. | Refletir a simplificação arquitetural aprovada. |
| Seções de interoperabilidade FHIR | A fronteira FHIR está correta, mas a meta de cobertura nacional e internacional ainda não está formulada como processo contínuo de homologação. | Explicitar que todos os perfis aplicáveis às instituições integradas serão registrados, versionados, testados e homologados, incluindo RNDS/DATASUS quando aplicável; novos perfis entram por release e eventuais perdas permanecem documentadas. | Buscar cobertura interoperável máxima sem alegar compatibilidade automática ou universal com perfis ainda desconhecidos. |
| RF009, RF017, RF023, RF029; RNF004, RNF016, RNF019 e RNF025 reproduzidos na DSR | Os requisitos são coerentes, porém menos específicos que a versão 4.0.0 atualizada. | Na próxima revisão aprovada da DSR, sincronizar o texto desses requisitos ou referenciar normativamente o documento v4.0.0. | Evitar duas formulações vigentes para o mesmo requisito. |
| Trabalhos futuros e avaliação | O texto deve separar a avaliação ex ante atual das validações operacionais futuras. | Registrar como próximos passos de outra pesquisa: dados/bioespécimes reais, retenção operacional, QR Code em ambiente real, validação externa do RCS e eventual ativação de estruturas de modelos. Registrar como recursos ex ante atuais os tubos DataMatrix sem amostras e o catálogo versionado de freezers. | Preservar o escopo atual e evitar que preparação arquitetural seja interpretada como validação real concluída. |
| Plano de avaliação e métricas | Há avaliação de consistência poliglota, mas não estão explícitos todos os novos gates. | Acrescentar testes de deduplicação, lacunas/clock drift, associação temporal, recálculo do resumo, replay/checkpoint do grafo, ausência de PII/leitura bruta no Neo4j, topologia física e homologação FHIR por release. | Tornar as correções falsificáveis sem alegar implementação concluída. |

# 11. Limitações da revisão

A revisão preserva o contexto e as referências previamente estabelecidas, acrescidas apenas das fontes científicas e especificações já aprovadas na revisão dirigida de telemetria e grafos. A completude é estrutural e documental; ensaios operacionais, validação externa real, conformidade normativa integral e implementação pertencem a etapas posteriores.

# 12. Registro de fontes

| **ID** | **Fonte** | **Nível** | **Disponibilidade** |
|----|----|----|----|
| SRC-DESIGN | Texto de reestruturação e princípio arquitetural | Diretriz interna da pesquisa | Referenced by checklist; exact named file not separately attached |
| SRC-DICT | Dicionário de Dados Consolidado v1.3.0 | Fonte interna autoritativa | Available |
| SRC-REQ | Requisitos Funcionais e Não Funcionais v3.0.1 | Fonte interna autoritativa | Available |
| SRC-IDF | RF016 e elementos ELM-0115–0116 | Fonte interna autoritativa | Available |
| SRC-POLY | Polyglot Persistence Data Model | Fonte interna autoritativa | Available |
| SRC-PIPE | Integrated Foundation Data Pipeline Plan | Fonte interna autoritativa | Available |
| SRC-BACK | Plano Backend BioAvanceD v3 — Fase 1 | Fonte interna autoritativa | Referenced by checklist; exact named file not separately attached |
| SRC-DSR | Dissertação BioAvanceD | Fonte interna | Referenced by checklist; exact named file not separately attached |
| SRC-RCS | Artigo e suplementos RCS | Fonte interna/metodológica | Referenced by checklist; exact named file not separately attached |
| SRC-FHIR | HL7 FHIR R4 | Norma técnica aberta | Available |
| SRC-MIABIS | MIABIS | Referência aberta | Available |
| SRC-SPREC2 | SPREC 2.0 | Artigo aberto | Available |
| SRC-SPREC4 | SPREC 4.0 | Artigo | Available |
| SRC-ISO20387 | ISO 20387:2018 / ABNT NBR ISO 20387:2020 | Alinhamento; não certificação | Available |
| SRC-ISO21899 | ISO 21899:2020 / ABNT NBR ISO 21899:2025 | Alinhamento; consulta integral pendente | Available |
| SRC-ISO23494 | ISO 23494-1/-2:2026 | Roadmap; não baseline vigente do artefato | Available |
| SRC-BR | Portaria MS 2.201/2011 e Resolução CNS 441/2011 | Base normativa brasileira | Available |
| SRC-LGPD | Lei 13.709/2018 — LGPD | Base legal | Available |
| SRC-FAIRAI | Huerta et al. 2023 — FAIR for AI | Literatura científica | Available |
| SRC-DYN | Kaye et al. 2015; Budin-Ljøsne et al. 2017 | Literatura científica | Available |
| SRC-LOCAL-21 | Checklist_Atualizacoes_Modelo_Canonico_BioAvanceD(1)(1).xlsx | Internal authoritative | Available |
| SRC-DSR-V6 | PROJETO DE PESQUISA - L2 - DENISE RIBEIRO v6 | Internal research document | Available |
| SRC-QUALI | Design Research BioAvanceD - Qualificação de Mestrado | Internal research document | Available |
| SRC-PIPE-HIST | Historical Foundation Data Pipeline plan | Internal superseded reference | Available |
| SRC-RCS-CANON-S1 | Supplementary File 1. SPREC Reference and Severity Tables | Canonical RCS supplementary document supplied by the author | Available; SHA-256 65d79949adef09fec6f90971df4733576ab4f65eaf4fe35c2c52db8af77c07c4 |
| SRC-RCS-CANON-S2 | Supplementary File 2. Supplementary Methods | Canonical RCS supplementary document supplied by the author | Available; SHA-256 45cb972f75f040a928c8c3fd55113b792c8aa74b4304614c5328aca854ba98b5 |
| SRC-TEL-ISO21823-1 | ISO/IEC 21823-1:2019 Internet of Things — Interoperability for IoT systems — Part 1 | International standard | Official page |
| SRC-TEL-ISO21823-4 | ISO/IEC 21823-4:2022 Syntactic interoperability | International standard | Official page |
| SRC-TEL-OGCSTA | OGC SensorThings API Part 1: Sensing 1.1 | Open geospatial standard | Official specification |
| SRC-TEL-WOT | W3C Web of Things Thing Description 1.1 | W3C Recommendation | Official specification |
| SRC-TEL-CLOUDEVENTS | CloudEvents Specification 1.0 | CNCF specification | Official specification |
| SRC-GRAPH-GQL | ISO/IEC 39075:2024 Database languages — GQL | International standard | Official page |
| SRC-TEL-JIANG2024 | Jiang et al. (2024), IoT cold-chain monitoring framework | Peer-reviewed scientific article | Open access |
| SRC-TEL-AHMED2023 | Ahmed et al. (2023), sensor data provenance | Peer-reviewed scientific article | Open access |
| SRC-ID-ISO16022 | ISO/IEC 16022:2024, Automatic identification and data capture techniques — Data Matrix bar code symbology specification | International standard | Official ISO record |
| SRC-ID-FILIPOWICZ2022 | Filipowicz et al. (2022), Comprehensive cancer-oriented biobanking resource of human samples | Peer-reviewed scientific article | Open access |
| SRC-ID-BUKREEVA2024 | Bukreeva et al. (2024), Biobank Digitalization: From Data Acquisition to Efficient Use | Peer-reviewed scientific review | Open access |
