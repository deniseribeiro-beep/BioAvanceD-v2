**BioAvanceD**

**Plano Integrado do Foundation Data Pipeline**

Preparação integral da Fase 1 e pipelines de população de dados das
Fases 2 e 3

  --------------------------------------------
  **FASE 1: 929 variáveis preparadas\
  Fases 2 e 3: população controlada por
  datasets, APIs, arquivos e fluxos
  operacionais**
  --------------------------------------------

  --------------------------------------------

**Versão 2.1.1 \| 31 de julho de 2026**

# 1. Controle documental

  --------------------------------------------------------------------------------
  **Campo**     **Definição**
  ------------- ------------------------------------------------------------------
  Título        BioAvanceD - Plano Integrado do Foundation Data Pipeline

  Versão        2.1.1 - 31 de julho de 2026

  Finalidade    Definir a preparação integral do modelo na Fase 1 e os pipelines
                de população de dados nas Fases 2 e 3.

  Fonte dos     BioAvanceD_Dicionario_Dados_Consolidado_v1.3.0_padronizado.xlsx.
  campos        

  Mudança       Todas as 929 variáveis pertencem à Fase 1 para fins de preparação
  canônica      estrutural e contratual.

  Nome oficial  Foundation Data Pipeline.

  Fases 2 e 3   Não introduzem novos campos; populam estruturas preparadas na Fase
                1 por datasets, APIs, arquivos e eventos.

  Status        Referência consolidada para XLSX v1.3.0, Lucidchart, contratos,
                containers, requisitos, Codex e testes.

  Documento     BioAvanceD - Plano Integrado do Foundation Data Pipeline v2.0.0.
  substituído   
  --------------------------------------------------------------------------------

# 2. Resumo executivo

Este documento consolida a implantação da modelagem de dados do
BioAvanceD após a publicação do dicionário v1.3.0. A Fase 1 é o
Foundation Data Pipeline: um bootstrap integral, versionado e
idempotente que prepara todos os contratos, estruturas de persistência,
validadores, índices, políticas, mapeamentos e mecanismos de ingestão
necessários para as 929 variáveis e 79 entidades canônicas do dicionário
consolidado.

As Fases 2 e 3 permanecem como fases de população. A Fase 2 carrega
dados de referência externos, como MONDO, HPO, ATC, DCB, CID, OMIM,
ORPHA, HGNC, LOINC, UCUM, DUO, Uberon, NCBI Taxonomy, Cell Ontology e
EDAM. A Fase 3 recebe dados operacionais, clínicos, laboratoriais, de
amostras, telemetria, arquivos científicos, datasets, workflows e dados
ômicos, sempre nas estruturas preparadas na Fase 1.

  ------------------------------------------------------------
  **Fase**   **Pipeline**   **Escopo**       **Resultado**
  ---------- -------------- ---------------- -----------------
  Fase 1     Foundation     929 variáveis;   Preparação
             Data Pipeline  79 entidades     estrutural
                            únicas; 26       integral e dados
                            domínios; 58     determinísticos
                            mapeamentos      de fundação.

  Fase 2     Reference Data Datasets         Terminologias,
             Population     externos         ontologias,
             Pipeline       versionados      catálogos,
                                             relações e
                                             mapeamentos.

  Fase 3     Operational    Dados            Participantes,
             and Scientific institucionais e consentimentos,
             Data           científicos      amostras,
             Population                      clínica,
             Pipeline                        telemetria,
                                             arquivos, ensaios
                                             e ômicas.
  ------------------------------------------------------------

  --------------------------------------------
  **Decisão central\
  A Fase 1 prepara 929 de 929 variáveis.
  Nenhum padrão ou vocabulário é representado
  por perfil reduzido criado pelo projeto. O
  que varia entre as fases é o momento da
  população dos dados, nunca a existência dos
  campos no modelo.**
  --------------------------------------------

  --------------------------------------------

# 3. Alterações canônicas em relação à versão 1.0.0

  ---------------------------------------------------------
  **Tema**        **Entendimento    **Entendimento
                  anterior**        vigente**
  --------------- ----------------- -----------------------
  Nome do         Nomenclatura      Foundation Data
  pipeline        anterior          Pipeline
                  descontinuada     

  Semântica da    Núcleo com 643    Bootstrap integral com
  Fase 1          variáveis         929 variáveis e 79
                                    entidades.

  Semântica das   Expansão do       População de dados em
  Fases 2 e 3     modelo            estruturas já
                                    preparadas.

  MIABIS e SPREC  Referências a     Cobertura integral das
                  subconjuntos do   variáveis selecionadas
                  projeto           no dicionário; perfis
                                    reduzidos são
                                    proibidos.

  Execução        Seed manual       Serviço one-shot
                  separado do       orquestrado com os
                  startup           containers, após
                                    healthchecks e antes da
                                    liberação da aplicação.

  Grandes         Fora do seed, sem Fase 2 com ciclo de
  terminologias   pipeline completo release, staging,
                                    validação, promoção,
                                    outbox, verificação e
                                    rollback.

  Dados           Distribuídos por  Fase 3 de população
  operacionais    fases de          controlada, mantendo
                  modelagem         consentimento,
                                    proveniência, segurança
                                    e uso de releases
                                    aprovadas.

  Cobertura       Variáveis apenas  Dicionário v1.3.0 e
  documental      referenciadas na  Apêndice A listam as
                  planilha          929 variáveis,
                                    incluindo as seis
                                    entidades técnicas
                                    incorporadas.
  ---------------------------------------------------------

# 4. Autoridade documental e transição do XLSX

A autoridade documental passa a ser aplicada na seguinte ordem:

**1. Dicionário consolidado v1.3.0: fonte normativa dos 929 campos,
entidades, tipos, cardinalidades, obrigatoriedade, sensibilidade,
fontes, interoperabilidade e destinos.**

**2. Este plano: fonte de organização da preparação estrutural na Fase 1
e dos fluxos de população nas Fases 2 e 3.**

**3. Documento unificado de requisitos v3.0.1: fonte dos requisitos
funcionais e não funcionais, incluindo RF022, RF023, RF028, RF029,
RNF031 e RNF032. A série funcional encerra-se em RF029; RF030 não
existe.**

**4. Lucidchart: artefato derivado para representação conceitual e
lógica de todas as 79 entidades canônicas.**

**5. JSON Schemas, contratos, código, containers e testes: artefatos
derivados e obrigatoriamente convergentes com as fontes anteriores.**

  --------------------------------------------
  **Regra vigente\
  O XLSX v1.3.0 já incorpora 929 variáveis na
  Fase 1, inclusive FoundationDataRun,
  ReferenceDatasetRelease, ReferenceImportRun,
  ReferenceImportIssue, TerminologyConcept e
  TerminologyRelation. As Fases 2 e 3 não
  podem criar novos campos fora do dicionário
  aprovado.**
  --------------------------------------------

  --------------------------------------------

# 5. Princípios canônicos não negociáveis

- Uma representação canônica por conceito; aliases legados somente em
  migradores ou boundaries temporários.

- MongoDB é a fonte operacional de verdade para documentos e eventos do
  outbox.

- Neo4j é projeção derivada e recebe dados exclusivamente pelo
  GraphProjectionOutboxEvent; não existe dual write.

- InfluxDB armazena telemetria de alta frequência; incidentes,
  avaliações e decisões permanecem em documentos canônicos.

- Redis é transitório: cache, filas, locks e aceleração de sessão; nunca
  é fonte permanente.

- Object Storage armazena arquivos e evidências por URI, checksum,
  tamanho, criptografia, política e proveniência.

- FHIR R4 é fronteira de interoperabilidade e não uma coleção
  operacional.

- Participant e ParticipantIdentity permanecem segregados; identidade
  direta não é projetada no grafo.

- ConsentTemplate e Consent são entidades distintas; toda decisão
  executável possui consentId.

- RCS é qualificação operacional local, não certificação e não substitui
  SPREC, MIABIS, ISO 20387 ou QC específico do ensaio.

- Todas as variáveis MIABIS e SPREC selecionadas no dicionário são
  preparadas; não são permitidos perfis reduzidos definidos pelo
  projeto.

- IA, Assistente Inteligente, apoio à decisão clínica e XAI permanecem
  fora do escopo atual.

  --------------------------------------------
  **Fase 1 - Foundation Data Pipeline\
  929 variáveis \| 79 entidades únicas \| 26
  domínios \| preparação integral na
  inicialização dos containers**
  --------------------------------------------

  --------------------------------------------

# 6. Objetivo da Fase 1

A Fase 1 prepara o sistema completo para receber dados nas fases
seguintes. Ela não depende da existência prévia de participantes,
consentimentos, amostras ou arquivos reais. Seu resultado é uma
plataforma estruturalmente pronta, com contratos, coleções, objetos
embutidos, índices, validadores, políticas, configurações, filas,
buckets, mapeamentos e mecanismos de rastreabilidade compatíveis com
todas as 929 variáveis.

Preparar uma variável significa definir onde ela existe, como é
validada, qual é sua cardinalidade, como é indexada, quem pode
escrevê-la, de onde virá o valor, como a proveniência é registrada e
como ela será transformada ou projetada. Preparar não significa criar
dados operacionais fictícios.

  --------------------------------------------
  **Cobertura obrigatória\
  O gate principal da Fase 1 é 929/929.
  Nenhuma variável pode ficar sem contrato,
  destino, validação e estratégia de
  população. Todas as entidades técnicas do
  control plane já integram o modelo
  canônico.**
  --------------------------------------------

  --------------------------------------------

## 6.1 Escopo integral por domínio

  ------------------------------------------------------------
  **Domínio**                     **Variáveis**   **Fase
                                                  vigente**
  ------------------------------- --------------- ------------
  Administração e segurança       185             Fase 1 -
                                                  Foundation

  Governança transversal          128             Fase 1 -
                                                  Foundation

  Metadados de biobanco           97              Fase 1 -
                                                  Foundation

  Dados clínicos                  78              Fase 1 -
                                                  Foundation

  Dados de referência             58              Fase 1 -
                                                  Foundation

  Consentimento e uso             45              Fase 1 -
                                                  Foundation

  Amostra e material              37              Fase 1 -
                                                  Foundation

  Qualidade pré-analítica         37              Fase 1 -
                                                  Foundation

  Doador e participante           29              Fase 1 -
                                                  Foundation

  Estudo e protocolo              23              Fase 1 -
                                                  Foundation

  Inventário físico               21              Fase 1 -
                                                  Foundation

  Ensaios e experimentos          19              Fase 1 -
                                                  Foundation

  Organização                     19              Fase 1 -
                                                  Foundation

  Gestão da qualidade             18              Fase 1 -
                                                  Foundation

  Telemetria                      17              Fase 1 -
                                                  Foundation

  Cadeia de custódia              15              Fase 1 -
                                                  Foundation

  Dados ômicos e imagens          14              Fase 1 -
                                                  Foundation

  Retenção e destino final        12              Fase 1 -
                                                  Foundation

  Transporte e distribuição       12              Fase 1 -
                                                  Foundation

  Equipamentos e métodos          11              Fase 1 -
                                                  Foundation

  Proveniência computacional      11              Fase 1 -
                                                  Foundation

  Telemetria e cadeia fria        11              Fase 1 -
                                                  Foundation

  Arquivos científicos            10              Fase 1 -
                                                  Foundation

  Acesso e distribuição           8               Fase 1 -
                                                  Foundation

  FAIR e publicação               8               Fase 1 -
                                                  Foundation

  Qualidade específica do ensaio  6               Fase 1 -
                                                  Foundation
  ------------------------------------------------------------

## 6.2 Componentes preparados pelo Foundation Data Pipeline

  ------------------------------------------------------
  **Componente**   **Preparação obrigatória**
  ---------------- -------------------------------------
  Contratos        JSON Schema, validators, DTOs, tipos,
  canônicos        enums, cardinalidades, required
                   fields e regras de versionamento para
                   as 929 variáveis.

  MongoDB          Coleções, objetos embutidos, índices,
                   unique constraints, validações, TTLs
                   quando aplicáveis, criptografia de
                   campos e repositórios.

  Neo4j            Constraints, índices e contratos de
                   projeção. Nenhuma entidade de domínio
                   é gravada diretamente; a origem é o
                   outbox.

  InfluxDB         Buckets, retenção, measurement
                   schemas, tags, fields e validação de
                   timestamp para telemetria.

  Redis            Namespaces, filas, locks, idempotency
                   keys, rate limits e caches
                   transitórios.

  Object Storage   Buckets/prefixos, criptografia,
                   versionamento, lifecycle, checksum,
                   metadados de acesso e convenções de
                   URI.

  FHIR Boundary    Mappers puros, perfis de
                   transformação, validação e testes sem
                   persistência operacional FHIR.

  Segurança        Actor, UserAccount, Role, Permission,
                   assignments, MFA, sessão, policies,
                   audit, retention e segregação de
                   identidade.

  eConsent         Study, Protocol, ConsentTemplate,
                   Consent, AccessPolicy, evidências,
                   revogação, bloqueio e liberação.

  Amostras e       Specimen, SpecimenPreanalytics,
  qualidade        SPREC, RCSAssessment, processing,
                   storage, custody, Merkle e
                   quarentena.

  Importação       Infraestrutura canônica de
                   FoundationDataRun, releases, import
                   runs, issues, conceitos, relações,
                   staging, quarentena, checkpoint,
                   promoção, rollback e reconciliação
                   para as Fases 2 e 3.
  ------------------------------------------------------

## 6.3 Dados de fundação que são efetivamente criados

O pipeline pode inserir somente dados determinísticos ou de configuração
necessários para a inicialização:

- Actor do sistema e identidades técnicas de serviços.

- Roles, Permissions e UserRoleAssignment do administrador de bootstrap.

- SecurityConfiguration, AccessPolicy e RetentionPolicy de implantação.

- Organization, Biobank, Collection, Study, Protocol e ConsentTemplate
  definidos no arquivo de configuração institucional.

- StorageLocation, ThresholdProfile e Devices declarados na implantação.

- Vocabulários internos, estados, enums e catálogos controlados
  definidos no dicionário.

- Cadastro de fontes externas autorizadas e manifestos de importação,
  sem ativar releases ainda não adquiridas e validadas.

- Metadados de FoundationDataRun, checksum do dicionário e relatório de
  cobertura 929/929.

Não são criados por bootstrap: Participant, ParticipantIdentity, Consent
individual, Specimen, dados clínicos, leituras de telemetria, eventos de
custódia, arquivos científicos ou execuções ômicas. Esses registros
serão recebidos na Fase 3.

## 6.4 MIABIS, SPREC e RCS no novo entendimento

- **MIABIS:** todas as variáveis selecionadas no dicionário para
  Biobank, Collection, Network, ResearchResource, Participant e demais
  objetos relacionados são preparadas integralmente.

- **SPREC:** todos os campos e componentes SPREC selecionados no
  dicionário são modelados e validados; catálogos extensos ou
  atualizações de versões entram pela Fase 2.

- **RCS:** estrutura, regras, versões, evidências e trilhas de decisão
  são preparadas na Fase 1; avaliações individuais são produzidas na
  Fase 3.

- **Proibição:** não usar nos documentos, no código ou nos diagramas
  denominações ou implementações que reduzam artificialmente os campos
  MIABIS ou SPREC selecionados no dicionário.

## 6.5 Execução junto aos containers

O Foundation Data Pipeline integra o processo de implantação e é
executado automaticamente pela orquestração durante a inicialização do
ambiente. Ele não é executado durante a construção da imagem nem pelo
startup da API. A imagem Docker contém o manifesto e os executores, mas
a escrita ocorre em um serviço one-shot após os healthchecks das
persistências. A API, os workers e o frontend somente são considerados
prontos após a conclusão bem-sucedida do pipeline.

  --------------------------------------------------------------
  **Ordem**   **Componente**   **Ação**
  ----------- ---------------- ---------------------------------
  1           Infraestrutura   MongoDB, Redis, Neo4j, InfluxDB e
                               Object Storage sobem com
                               healthchecks.

  2           Lock de          O pipeline adquire lock
              implantação      distribuído e verifica
                               versão/checksum do dicionário.

  3           Schema bootstrap Cria ou atualiza coleções,
                               validators, índices, buckets,
                               constraints e prefixes.

  4           Foundation       Aplica upserts determinísticos de
              records          segurança, governança,
                               configuração institucional e
                               catálogos internos.

  5           Import control   Prepara staging, releases, runs,
              plane            issues, checkpoints e ponteiros
                               de versão ativa.

  6           Verificação      Executa cobertura 929/929, testes
                               de invariantes, índices e
                               conectividade.

  7           Gate de          Somente após sucesso a API, os
              liberação        workers e o frontend são
                               considerados prontos.
  --------------------------------------------------------------

<table style="width:63%;">
<colgroup>
<col style="width: 63%" />
</colgroup>
<thead>
<tr>
<th><p><strong>Falha segura</strong></p>
<p>Se qualquer variável, schema, índice, configuração ou dependência
obrigatória falhar, o serviço one-shot encerra com erro e impede a
liberação da aplicação. Não são aplicadas exclusões destrutivas
automáticas.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 6.6 Idempotência, versionamento e rollback

- Manifesto versionado do Foundation Data Pipeline.

- Checksum canônico do XLSX e dos artefatos derivados.

- Identificadores determinísticos para dados de fundação.

- Upserts com chave natural e proteção contra conflito de checksum.

- Migrações forward-only com scripts de compensação explicitamente
  versionados.

- Registro de cada execução, contagens, duração, warnings e falhas.

- Nenhuma alteração silenciosa de cardinalidade, tipo ou sensibilidade.

- Rollback por versão do schema e reativação da configuração anterior,
  sem apagar dados operacionais.

## 6.7 Entidades técnicas incorporadas ao XLSX v1.3.0

O dicionário consolidado v1.3.0 incorporou formalmente as seis entidades
necessárias ao controle do bootstrap e das importações. Elas deixam de
ser gaps e passam a integrar a cobertura obrigatória da Fase 1,
totalizando 112 variáveis canônicas adicionais:

  -------------------------------------------------------------
  **Entidade incorporada**  **Finalidade**
  ------------------------- -----------------------------------
  FoundationDataRun         19 campos. Registra bootstrap,
                            manifesto, checksum do XLSX,
                            ambiente, etapas, estado, duração e
                            cobertura.

  ReferenceDatasetRelease   21 campos. Registra fonte, versão,
                            release, licença, URI, checksum,
                            parser, mapping e estado de
                            ativação.

  ReferenceImportRun        23 campos. Registra execução de
                            importação, modo, idempotência,
                            checkpoint, contagens, validação e
                            resultado.

  ReferenceImportIssue      17 campos. Registra quarentena,
                            origem do erro, severidade,
                            payload, resolução e
                            reprocessamento.

  TerminologyConcept        18 campos. Representa conceitos
                            versionados de HPO, MONDO, CID,
                            ATC, DCB, LOINC, UCUM, DUO, Uberon,
                            EDAM e outros.

  TerminologyRelation       14 campos. Representa relações
                            is_a, part_of, maps_to,
                            equivalent_to e demais vínculos
                            versionados.
  -------------------------------------------------------------

  --------------------------------------------
  **Regra de modelagem\
  As seis entidades e seus 112 campos já
  pertencem à Fase 1. Qualquer alteração
  futura deve atualizar primeiro o XLSX,
  depois este plano, o Lucidchart, os
  contratos, o código e os testes.**
  --------------------------------------------

  --------------------------------------------

## 6.8 Ordem de implementação da Fase 1

**1. Congelar o XLSX v1.3.0 e registrar seu checksum canônico no
manifesto do pipeline.**

**2. Implementar as seis entidades técnicas já incorporadas e seus 112
campos canônicos.**

**3. Congelar os 929 campos, identificadores, tipos, cardinalidades,
sensibilidade e destinos.**

**4. Atualizar o Lucidchart com as 79 entidades e objetos embutidos.**

**5.** Gerar JSON Schemas, DTOs, tipos e validators para todos os
domínios.

**6.** Criar persistência MongoDB, InfluxDB, Object Storage, Redis e
constraints de projeção Neo4j.

**7.** Implementar dados determinísticos e configuração institucional.

**8.** Implementar o serviço one-shot foundation-data e sua orquestração
por healthchecks.

**9. Implementar relatório de cobertura 929/929 e testes de
arquitetura.**

**10.** Bloquear a liberação dos containers de aplicação até a conclusão
do gate.

## 6.9 Critérios de conclusão da Fase 1

  ----------------------------------------------------
  **Gate**   **Critério de aceite**
  ---------- -----------------------------------------
  F1-G01     929 de 929 variáveis possuem contrato,
             destino, validação, sensibilidade,
             proveniência e estratégia de população.

  F1-G02     As 79 entidades únicas e objetos
             embutidos estão modelados sem duplicação
             canônica.

  F1-G03     Todas as estruturas operacionais,
             científicas e técnicas do control plane
             estão preparadas na Fase 1.

  F1-G04     Não existem referências ou implementações
             de perfis reduzidos para MIABIS ou SPREC.

  F1-G05     ParticipantIdentity está segregado,
             cifrado e ausente das projeções Neo4j.

  F1-G06     ConsentTemplate e Consent estão separados
             e toda decisão executável utiliza
             consentId.

  F1-G07     MongoDB, Neo4j, InfluxDB, Redis, Object
             Storage e FHIR respeitam as fronteiras
             canônicas.

  F1-G08     O serviço foundation-data é one-shot,
             idempotente, versionado, auditável e
             fail-fast.

  F1-G09     Dados de fundação são criados; dados
             operacionais fictícios não são inseridos.

  F1-G10     O relatório final comprova cobertura,
             índices, validators, políticas,
             dependências, control plane, paridade de
             configuração, execução da CI e prontidão
             para as Fases 2 e 3.
  ----------------------------------------------------

<table style="width:63%;">
<colgroup>
<col style="width: 63%" />
</colgroup>
<thead>
<tr>
<th style="text-align: center;"><p><strong>Fase 2 - Reference Data
Population Pipeline</strong></p>
<p>População versionada de terminologias, ontologias, catálogos e
relações externas</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 7. Objetivo da Fase 2

A Fase 2 popula as estruturas preparadas pelo Foundation Data Pipeline
com dados de referência externos. Nenhum importador pode criar campos,
coleções ou relações que não estejam previamente modelados na Fase 1.
Cada fonte é tratada como uma release versionada, com licença, checksum,
parser, mapeamento, staging, validação, aprovação, promoção,
reconciliação e rollback.

## 7.1 Pacotes de datasets

  -----------------------------------------------------------------------
  **Pacote**       **Fontes principais**           **Estruturas
                                                   populadas**
  ---------------- ------------------------------- ----------------------
  Doenças e        MONDO, ORPHA, CID-11, CID-10,   DiseaseConcept,
  classificações   OMIM                            TerminologyConcept e
                                                   TerminologyRelation.

  Fenótipos        HPO e associações               TerminologyConcept e
                   doença-fenótipo/gene-fenótipo   TerminologyRelation;
                                                   códigos ficam
                                                   disponíveis para
                                                   PhenotypeObservation
                                                   na Fase 3.

  Genes e          HGNC, ClinGen                   GeneConcept,
  evidências                                       TerminologyConcept,
                                                   TerminologyRelation e
                                                   evidências de
                                                   referência aprovadas.

  Observações e    LOINC, UCUM; SNOMED CT quando   TerminologyConcept e
  unidades         licenciado e aprovado           TerminologyRelation;
                                                   códigos e unidades são
                                                   referenciados por
                                                   observações e ensaios
                                                   na Fase 3.

  Medicamentos     ATC/DDD, DCB/ANVISA; fontes     TerminologyConcept e
                   farmacogenômicas aprovadas      TerminologyRelation;
                                                   MedicationExposure
                                                   permanece dado
                                                   operacional da Fase 3.

  Consentimento e  DUO e mapeamentos de uso/acesso TerminologyConcept e
  uso                                              TerminologyRelation;
                                                   AccessPolicy,
                                                   ConsentTemplate e
                                                   Consent apenas
                                                   referenciam códigos
                                                   aprovados.

  Anatomia e       Uberon, Cell Ontology, NCBI     TerminologyConcept e
  material         Taxonomy                        TerminologyRelation;
  biológico                                        Specimen e Assay
                                                   utilizam esses
                                                   conceitos na Fase 3.

  Dados, métodos e EDAM, ISA, BioSamples,          TerminologyConcept,
  FAIR             DataCite, RO-Crate              TerminologyRelation e
                                                   metadados de fontes;
                                                   DataFile, Dataset e
                                                   WorkflowRun são
                                                   populados na Fase 3.
  -----------------------------------------------------------------------

## 7.2 Pipeline universal de importação

  ---------------------------------------------------
  **Etapa**   **Resultado obrigatório**
  ----------- ---------------------------------------
  1\.         Identificar release, versão, data,
  Discover    todos os endpoints, assets ou partições
              oficiais aplicáveis, licença e mudanças
              em relação à versão ativa.

  2\. Acquire Baixar por API/arquivo, registrar
              endpoint, asset ou partição de origem,
              validar a origem e armazenar o artefato
              bruto no Object Storage.

  3\.         Calcular SHA-256 e comparar com
  Integrity   checksum oficial quando disponível.

  4\. Plan    Estimar registros, relações, batches,
              memória, armazenamento e impacto.

  5\. Parse   Processar em streaming, sem carregar
              arquivos extensos integralmente em
              memória.

  6\.         Converter para os contratos canônicos
  Normalize   preparados na Fase 1.

  7\. Stage   Gravar em coleções temporárias isoladas
              por release e importRunId.

  8\.         Executar schema, unicidade, integridade
  Validate    referencial, status, contagens, taxa de
              rejeição e cobertura por endpoint,
              asset ou partição.

  9\. Approve Exigir aprovação explícita para
              promoção da release.

  10\.        Ativar a nova release por ponteiro,
  Promote     preservar a anterior e emitir eventos
              de outbox.

  11\. Verify Reconciliar contagens esperadas e
              obtidas por endpoint, asset ou
              partição, checksums, índices, amostras
              e projeções.

  12\.        Reativar a release anterior sem
  Rollback    exclusão física do histórico.
  ---------------------------------------------------

## 7.3 Regras específicas de integridade

- Chave lógica versionada para conceitos: systemUri + code + version.

- Chave lógica versionada para relações: sourceConceptId +
  relationType + targetConceptId + version.

- Termos obsoletos permanecem preservados com status, replacement e
  proveniência.

- Mapeamentos não são equivalências automáticas; o tipo da relação e a
  fonte devem ser explícitos.

- DCB e ATC não são vinculados por semelhança textual sem fonte ou
  curadoria.

- HPO, MONDO, ORPHA, CID e OMIM mantêm códigos originais e relações de
  mapeamento versionadas.

- Nenhum importador grava diretamente no Neo4j; a projeção ocorre pelo
  outbox.

- Erros são enviados à quarentena e não são descartados silenciosamente.

## 7.4 Ordem recomendada da Fase 2

**1.** Registrar fontes, licenças, versões e estratégias de acesso.

**2.** Importar HPO e sua hierarquia.

**3.** Importar MONDO e suas relações de doença.

**4.** Importar ORPHA, CID-11, CID-10 e OMIM conforme licenças e
mappings aprovados.

**5.** Importar HGNC e relações gene-fenótipo/doença.

**6.** Importar LOINC e UCUM.

**7.** Importar DCB e ATC/DDD, mantendo curadoria de mappings.

**8.** Importar DUO, Uberon, NCBI Taxonomy, Cell Ontology e EDAM.

**9.** Importar fontes complementares aprovadas, uma release por vez.

**10.** Reconciliar MongoDB, outbox, Neo4j e índices de busca.

## 7.5 Critérios de conclusão da Fase 2

  ----------------------------------------------------
  **Gate**   **Critério de aceite**
  ---------- -----------------------------------------
  F2-G01     Toda fonte possui release, licença, URI,
             checksum, parserVersion e mappingVersion.

  F2-G02     Staging, validação, promoção e rollback
             foram testados para cada importador.

  F2-G03     Conceitos e relações são versionados,
             idempotentes e reconciliáveis.

  F2-G04     Não existem relações órfãs, códigos
             duplicados ou perdas silenciosas.

  F2-G05     Erros e rejeições estão registrados em
             ReferenceImportIssue.

  F2-G06     A release ativa pode ser trocada sem
             apagar o histórico.

  F2-G07     Outbox e projeções Neo4j estão
             reconciliados sem dual write.

  F2-G08     APIs de domínio consultam somente
             releases aprovadas e ativas.

  F2-G09     Fontes com múltiplos endpoints, assets ou
             partições possuem manifesto de cobertura,
             contagens esperadas e obtidas e
             justificativas de exclusão; cobertura
             parcial não justificada bloqueia a
             promoção.
  ----------------------------------------------------

<table style="width:63%;">
<colgroup>
<col style="width: 63%" />
</colgroup>
<thead>
<tr>
<th style="text-align: center;"><p><strong>Fase 3 - Operational and
Scientific Data Population Pipeline</strong></p>
<p>População de dados institucionais, operacionais, clínicos,
laboratoriais, arquivos e workflows</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 8. Objetivo da Fase 3

A Fase 3 recebe dados reais ou sintéticos controlados nas estruturas já
preparadas. Ela abrange configuração institucional remanescente,
participantes, identidade protegida, consentimentos, amostras,
qualidade, inventário, custódia, telemetria, dados clínicos, ensaios,
remessas, arquivos, datasets, workflows e dados ômicos. A população deve
respeitar finalidade, consentimento, minimização, proveniência,
sensibilidade e políticas de acesso.

## 8.1 Pacotes de população

  ------------------------------------------------------------------
  **Pacote**      **Entrada**              **Estruturas populadas**
  --------------- ------------------------ -------------------------
  Institucional   Arquivos JSON/YAML/CSV   Organization, Biobank,
                  aprovados                Collection, Network,
                                           ResearchResource, Study,
                                           Protocol.

  Participante e  API, migração controlada Participant e
  identidade      ou FHIR boundary         ParticipantIdentity
                                           segregados.

  eConsent        Fluxo eletrônico,        ConsentTemplate, Consent,
                  migração de termos e     AccessPolicy e
                  evidências               QuarantineAction.

  Amostras e      CSV/JSON/API/LIMS        Specimen,
  qualidade                                SpecimenPreanalytics,
                                           RCSAssessment,
                                           ProcessingBatch.

  Inventário e    Arquivos de migração e   StorageLocation,
  custódia        eventos operacionais     StorageAssignment,
                                           CustodyEvent, MerkleRoot.

  Telemetria      MQTT/HTTP/stream         Device, TelemetryReading,
                                           ThresholdProfile,
                                           EnvironmentalExcursion.

  Clínica e       FHIR/CSV/JSON/ELN/LIMS   Encounter, Condition,
  ensaios                                  observations, reports,
                                           Assay, ReagentLot,
                                           outcomes.

  Acesso e        APIs e workflows         AccessRequest,
  distribuição    aprovados                AccessGrant, Shipment,
                                           Nonconformance,
                                           DispositionAction.

  Arquivos e FAIR Object Storage,          DataFile, Dataset,
                  manifestos, ISA,         ImagingStudy e metadados
                  RO-Crate                 de publicação.

  Workflows e     Manifestos de execução e WorkflowRun, GenomicsRun,
  ômicas          artefatos controlados    TranscriptomicsRun,
                                           demais domínios
                                           preparados e
                                           OmicsQualification.
  ------------------------------------------------------------------

## 8.2 Sequência segura de população

**1.** Executar primeiro com dados sintéticos e validar o ambiente
completo.

**2.** Carregar catálogo institucional, estudos, protocolos e templates
de consentimento.

**3.** Importar participantes e identidade protegida por processos
separados.

**4.** Registrar consentimentos e validar permissões de uso antes de
importar dados vinculados.

**5.** Importar amostras, pré-analítica, qualidade, inventário e
custódia.

**6.** Ativar telemetria e consolidar excursões antes de decisões de
quarentena automáticas.

**7.** Importar dados clínicos, ensaios e remessas conforme finalidade
autorizada.

**8.** Ingerir arquivos, datasets e manifestos com checksum e políticas
de acesso.

**9.** Registrar workflows, proveniência computacional e qualificação
específica do ensaio.

**10.** Executar reconciliação final, relatórios de divergência e aceite
de negócio.

## 8.3 Regras de segurança e proveniência

- Nenhum registro operacional é criado sem sourceRecordId, origem, data
  de ingestão e importRunId ou evento equivalente.

- ParticipantIdentity utiliza criptografia, minimização, segregação de
  acesso e trilha específica.

- Consentimento é avaliado antes da associação ou liberação de dados e
  amostras.

- Arquivos permanecem no Object Storage; MongoDB armazena URI, checksum,
  tamanho, formato, criptografia e política.

- Dados derivados registram método, versão, entradas, parâmetros e
  evidências.

- Ausente, desconhecido, não aplicável e não avaliado são estados
  distintos.

- Dados sintéticos são claramente marcados e nunca misturados a dados
  reais sem segregação.

- Toda mudança relevante gera AuditEvent e, quando aplicável,
  GraphProjectionOutboxEvent.

## 8.4 Critérios de conclusão da Fase 3

  ----------------------------------------------------
  **Gate**   **Critério de aceite**
  ---------- -----------------------------------------
  F3-G01     Todos os pacotes operacionais utilizam
             exclusivamente contratos preparados na
             Fase 1.

  F3-G02     Consentimento, finalidade, política e
             sensibilidade são validados antes da
             ingestão ou liberação.

  F3-G03     Participante e identidade direta
             permanecem segregados em toda a cadeia.

  F3-G04     Amostras, qualidade, inventário, custódia
             e telemetria são reconciliados.

  F3-G05     Arquivos, datasets e workflows possuem
             checksum, proveniência, política de
             acesso, vínculo canônico com specimenId,
             assayId, studyId ou datasetId quando
             aplicável e auditoria de upload, acesso,
             substituição e remoção lógica.

  F3-G06     Importações suportam checkpoint, retry,
             quarentena, reprocessamento e rollback.

  F3-G07     Neo4j reflete somente projeções derivadas
             do outbox.

  F3-G08     Testes sintéticos e homologação
             controlada precedem o uso de dados reais.

  F3-G09     Relatórios detalhados e agregados derivam
             o escopo organizacional das atribuições
             vigentes e impedem exposição ou
             inferência entre organizações, biobancos,
             coleções ou estudos não autorizados.

  F3-G10     Alocação, movimentação e liberação de
             espécimes que alterem múltiplos
             documentos executam em transação MongoDB
             real sobre replica set, com atomicidade e
             rollback comprovados.
  ----------------------------------------------------

# 9. Dependências entre as fases

  ---------------------------------------------------------
  **Dependência**   **Pré-condição**    **Regra**
  ----------------- ------------------- -------------------
  Fase 1 -\> Fase 2 Schemas, índices,   Nenhum dataset é
                    entidades de        promovido se a
                    referência, import  cobertura
                    control plane e     Foundation não for
                    Object Storage      929/929.
                    prontos.            

  Fase 1 -\> Fase 3 Contratos           Nenhum dado
                    operacionais,       operacional cria
                    segurança,          campo ou coleção
                    consentimento,      fora do modelo.
                    outbox, telemetria  
                    e arquivos          
                    preparados.         

  Fase 2 -\> Fase 3 Terminologias e     Dados clínicos e
                    releases de         científicos
                    referência ativas.  utilizam códigos de
                                        releases aprovadas.

  Transversal       AuditEvent,         Aplicam-se a todas
                    AccessPolicy,       as cargas e
                    provenance,         reprocessamentos.
                    retention e outbox. 
  ---------------------------------------------------------

# 10. Plano revisado de modelagem no Lucidchart

  -----------------------------------------------------------------
  **Página**                       **Conteúdo**
  -------------------------------- --------------------------------
  00_Visao_Geral_Poliglota         Fronteiras MongoDB, Neo4j,
                                   InfluxDB, Redis, Object Storage,
                                   FHIR e outbox.

  01_Foundation_Control_Plane      FoundationDataRun, releases,
                                   import runs, issues, staging,
                                   checkpoints e locks.

  02_Institucional_Catalogo        Organization, Network, Biobank,
                                   Collection, ResearchResource e
                                   associações.

  03_Participant_Identity          Participant, ParticipantIdentity
                                   e fronteiras FHIR.

  04_Study_Protocol_eConsent       Study, Protocol,
                                   ConsentTemplate, Consent,
                                   AccessPolicy e quarentena.

  05_Specimen_SPREC_RCS            Specimen, pré-analítica
                                   integral, SPREC, RCSAssessment e
                                   processing.

  06_Inventory_Custody_Retention   Storage, CustodyEvent, Merkle,
                                   retention e disposição.

  07_Telemetry_ColdChain           Device, readings, thresholds,
                                   excursions e impacto.

  08_Clinical_Semantics            Encounter, conditions,
                                   phenotypes, observations,
                                   disease, gene e reports.

  09_Security_Audit_Outbox         Actor, account, RBAC, MFA,
                                   sessions, audit e graph outbox.

  10_F2_Reference_Datasets         Concepts, relations, releases,
                                   import workflow e version
                                   activation.

  11_F2_Disease_Phenotype_Gene     MONDO, HPO, ORPHA, CID, OMIM,
                                   HGNC e associações.

  12_F2_Medication_Observation     ATC, DCB, LOINC, UCUM, DUO e
                                   mappings.

  13_F3_Operational_Ingestion      Participante, consentimento,
                                   amostra, clínica, inventário e
                                   remessa.

  14_F3_Files_Datasets_FAIR        DataFile, Dataset, DICOM, ISA,
                                   RO-Crate e publicação.

  15_F3_Workflow_Omics             WorkflowRun, genômica,
                                   transcriptômica, demais
                                   estruturas preparadas e
                                   qualification.

  16_Validation_Reconciliation     Gates, contagens, checksums,
                                   outbox, projeção, rollback e
                                   evidências.
  -----------------------------------------------------------------

- Toda caixa lógica deve conter todos os campos correspondentes do
  Apêndice A.

- A fase vigente de preparação é sempre Fase 1; as páginas de Fase 2 e
  Fase 3 representam fluxos de população.

- Linhas sólidas são referências operacionais; tracejadas são projeções;
  pontilhadas são transformações/interoperabilidade.

- Nenhuma entidade ou campo é criado diretamente no Lucidchart sem
  atualização prévia do XLSX.

# 11. Plano de execução para o Codex

  -----------------------------------------------------------
  **Ordem**   **Entrega**    **Resultado esperado**
  ----------- -------------- --------------------------------
  1           Atualização    Congelar XLSX v1.3.0, changelog
              canônica       e lista de 929 variáveis na Fase
                             1.

  2           Contratos      Gerar validators, DTOs e tipos
              integrais      para 79 entidades e 929 campos.

  3           Persistência   Criar coleções, índices,
                             objects, buckets, prefixes e
                             constraints.

  4           Foundation     Implementar configuração
              records        institucional, segurança e
                             catálogos determinísticos.

  5           Control plane  Implementar FoundationDataRun e
                             infraestrutura de importação.

  6           Container      Integrar serviço foundation-data
              one-shot       ao Compose/Kubernetes com
                             healthchecks e gate.

  7           F2 framework   Implementar pipeline universal
                             de releases, staging, promoção e
                             rollback.

  8           F2 importers   Implementar importadores por
                             dataset e testes de contrato.

  9           F3 ingestion   Implementar cargas operacionais,
                             arquivos, telemetria e
                             workflows.

  10          Validação      Executar CI em ambiente limpo,
                             descoberta integral de testes,
                             não regressão de cobertura,
                             paridade de configuração,
                             reconciliação, observabilidade e
                             documentação.
  -----------------------------------------------------------

## 11.1 Regras obrigatórias para prompts e pull requests

- Ler este documento e o XLSX atualizado antes de alterar código.

- Não utilizar documentos de fases anteriores como fonte normativa.

- Não reintroduzir nomenclatura de subconjuntos reduzidos de MIABIS ou
  SPREC.

- Implementar por domínio e por pull request pequena, com migração e
  testes.

- Rejeitar aliases em novos contratos; confinar compatibilidade legada
  aos migradores.

- Não realizar dual write e não persistir recursos FHIR como fonte
  operacional.

- Não criar dados operacionais fictícios no Foundation Data Pipeline.

- Executar em CI, a partir de checkout limpo e da composição real, lint,
  typecheck, testes unitários, de contrato, integração, arquitetura,
  segurança e E2E antes de concluir.

- Falhar o gate quando houver arquivo de teste não descoberto, regressão
  não aprovada de cobertura ou Playwright não executado na CI contra os
  containers reais.

- Manter o mesmo conjunto de chaves entre .env.example, Compose, CI e
  runners; segredos ou políticas de segurança não podem divergir nem ser
  relaxados por indicador genérico de ambiente.

# 12. Validação e implantação controlada

  ---------------------------------------------------------------
  **Categoria**             **Cenários obrigatórios**
  ------------------------- -------------------------------------
  Foundation                Cobertura 929/929, 79 entidades,
                            validators, índices, políticas,
                            configs, buckets, constraints e
                            control plane.

  Referências               Releases, checksum, licença, staging,
                            promoção, rollback, relações e
                            índices.

  Participante/identidade   Pseudonimização, segregação,
                            criptografia, exportação FHIR e
                            ausência no grafo.

  eConsent                  Criação, assinatura, granularidade,
                            vigência, revogação, bloqueio,
                            liberação e histórico.

  Amostra/qualidade         Cadastro, derivação, SPREC, RCS,
                            quantidade, estado, inventário e
                            quarentena.

  Telemetria                Leitura, limite, excursão, impacto,
                            retry, autocura e reconciliação.

  Segurança                 MFA, sessão, RBAC, escopo,
                            sanitização, retenção, auditoria
                            canônica com objetos
                            aninhados/arrays/nulos/datas,
                            rejeição de ciclos e controles sem
                            relaxamento implícito por NODE_ENV.

  Arquivos/workflows        Checksum, proveniência,
                            versionamento, reexecução, acesso,
                            publicação, vínculos canônicos e
                            auditoria de upload, acesso,
                            substituição e remoção lógica.

  Outbox/Neo4j              Idempotência, ordenação, lease,
                            retry, dead letter, replay e
                            consistência eventual.

  Custódia transacional     Replica set, transações reais para
                            alocação/movimentação/liberação,
                            concorrência, atomicidade e rollback.

  Relatórios/escopo         Escopo organizacional derivado no
                            backend e aplicado igualmente a
                            detalhes, indicadores, agregações e
                            exportações.

  CI/configuração           Checkout limpo, lockfile e base Linux
                            dos containers, dependências
                            nativas/opcionais, descoberta de
                            todos os testes, Playwright na
                            composição real, não regressão de
                            cobertura e mesmas chaves em
                            .env.example, Compose, CI e runners.
  ---------------------------------------------------------------

# 13. Governança de mudanças

**1.** Registrar a necessidade e a justificativa.

**2.** Atualizar 01_FONTES quando houver nova norma, vocabulário, API ou
dataset.

**3.** Atualizar 02_DICIONARIO e, quando aplicável, interoperabilidade e
priorização.

**4.** Registrar a mudança em 09_CHANGELOG.

**5. Atualizar o Apêndice A e validar as 929 linhas e os 929 IDs
únicos.**

**6.** Atualizar Lucidchart, schemas, persistência, APIs, frontend,
migrações e testes.

**7.** Atualizar evidências de alinhamento do código.

**8.** Executar gates da fase afetada e publicar versão.

<table style="width:63%;">
<colgroup>
<col style="width: 63%" />
</colgroup>
<thead>
<tr>
<th><p><strong>Proibição de enfraquecimento</strong></p>
<p>O estado atual da branch main não autoriza reduzir o modelo, omitir
variáveis, manter nomes legados ou recuperar conjuntos reduzidos.
Divergências são gaps de migração e devem ser resolvidas pelo
código.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 14. Referências documentais

  -----------------------------------------------------------------------------------------------------------------
  **ID**         **Documento**                                                              **Uso**
  -------------- -------------------------------------------------------------------------- -----------------------
  DOC-01         BioAvanceD_Dicionario_Dados_Consolidado_v1.3.0_padronizado.xlsx            Fonte canônica dos 929
                                                                                            campos, 79 entidades,
                                                                                            tipos, cardinalidades,
                                                                                            fontes, sensibilidade,
                                                                                            destinos e mapeamentos.

  DOC-02         BioAvanceD_Plano_Integrado_Implantacao_Modelagem_Dados_v1.0.0              Documento substituído;
                                                                                            utilizado somente para
                                                                                            rastrear a mudança de
                                                                                            entendimento anterior à
                                                                                            versão 2.0.0.

  DOC-03         PROJETO DE PESQUISA - L2 - MESTRADO DENISE_v5.2.docx                       Objetivos, requisitos,
                                                                                            atores, arquitetura,
                                                                                            segurança, validação e
                                                                                            implantação.

  DOC-04         Arquitetura e diagramas do BioAvanceD                                      Fluxos históricos;
                                                                                            nomes e regras atuais
                                                                                            prevalecem.

  DOC-05         Snapshot da branch main e matrizes de gaps                                 Evidência do estado
                                                                                            atual do código, sem
                                                                                            autoridade para reduzir
                                                                                            o modelo-alvo.

  DOC-06         BioAvanceD_Requisitos_Funcionais_e_Nao_Funcionais_Unificados_v3.0.1.docx   Requisitos funcionais e
                                                                                            não funcionais
                                                                                            alinhados ao Foundation
                                                                                            Data Pipeline e às
                                                                                            fases de população.
  -----------------------------------------------------------------------------------------------------------------

# Apêndice A - Matriz integral de 929 variáveis da Fase 1

Este apêndice é normativo para a cobertura do Foundation Data Pipeline e
foi regenerado diretamente do XLSX v1.3.0. As 929 linhas, incluindo os
112 campos das seis entidades técnicas, pertencem à Fase 1 sem exceções.

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **ID**     **Domínio**     **Entidade**                 **Campo canônico**                         **Tipo**                     **Card.**   **Obrig.**    **Destino**        **Fase
                                                                                                                                                                               vigente**
  ---------- --------------- ---------------------------- ------------------------------------------ ---------------------------- ----------- ------------- ------------------ -----------
  ELM-0001   Governança      BaseRecord                   recordId                                   uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0002   Governança      BaseRecord                   entityType                                 code                         1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0003   Governança      BaseRecord                   recordStatus                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0004   Governança      BaseRecord                   schemaVersion                              string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0005   Governança      BaseRecord                   recordVersion                              integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0006   Governança      BaseRecord                   createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0007   Governança      BaseRecord                   createdBy                                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0008   Governança      BaseRecord                   updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0009   Governança      BaseRecord                   updatedBy                                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0010   Governança      BaseRecord                   sourceSystem                               uri                          0..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0011   Governança      BaseRecord                   sourceRecordId                             string                       0..\*       Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0012   Governança      BaseRecord                   sourceVersion                              string                       0..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0013   Governança      BaseRecord                   retrievedAt                                dateTime                     0..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0014   Governança      BaseRecord                   contentChecksum                            string                       0..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  ELM-0015   Governança      BaseRecord                   language                                   code                         0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0016   Governança      BaseRecord                   validityPeriod                             Period                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0017   Governança      BaseRecord                   supersedesId                               Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0018   Governança      BaseRecord                   dataClassification                         code                         1..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0019   Governança      BaseRecord                   qualityStatus                              code                         0..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  ELM-0020   Governança      BaseRecord                   reviewStatus                               code                         0..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0021   Governança      BaseRecord                   retentionPolicyId                          Reference                    0..1        Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0022   Governança      BaseRecord                   accessPolicyId                             Reference                    0..\*       Core          MongoDB/Neo4j      Fase 1
             transversal                                                                                                                                                       

  ELM-0023   Governança      BaseRecord                   auditEventIds                              Reference\[\]                0..\*       Core          Neo4j/MongoDB      Fase 1
             transversal                                                                                                                                                       

  ELM-0024   Organização     Organization                 organizationId                             uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0025   Organização     Organization                 officialName                               string                       1..1        Core          MongoDB            Fase 1

  ELM-0026   Organização     Organization                 acronym                                    string                       0..1        Opcional      MongoDB            Fase 1

  ELM-0027   Organização     Organization                 organizationType                           code                         0..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0028   Organização     Organization                 countryCode                                code                         1..1        Core          MongoDB            Fase 1

  ELM-0029   Organização     Organization                 website                                    uri                          0..1        Opcional      MongoDB            Fase 1

  ELM-0030   Organização     Organization                 contact                                    BackboneElement              0..\*       Core          MongoDB            Fase 1

  ELM-0031   Organização     Organization                 qualityStandards                           CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1

  ELM-0032   Metadados de    Biobank                      biobankId                                  uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0033   Metadados de    Biobank                      biobankName                                string                       1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0034   Metadados de    Biobank                      biobankDescription                         markdown                     1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0035   Metadados de    Biobank                      legalEntityId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0036   Metadados de    Biobank                      biobankStatus                              code                         1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0037   Metadados de    Biobank                      infrastructureCapabilities                 CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0038   Metadados de    Biobank                      bioprocessingCapabilities                  CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0039   Metadados de    Collection                   collectionId                               uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0040   Metadados de    Collection                   collectionName                             string                       1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0041   Metadados de    Collection                   collectionDescription                      markdown                     1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0042   Metadados de    Collection                   collectionStatus                           code                         1..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0043   Metadados de    Collection                   sampleTypes                                CodeableConcept\[\]          0..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0044   Metadados de    Collection                   datasetTypes                               CodeableConcept\[\]          0..\*       Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0045   Metadados de    Collection                   diseaseScope                               CodeableConcept\[\]          0..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0046   Metadados de    Collection                   inclusionCriteriaCategories                CodeableConcept\[\]          0..1        Core          MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0047   Metadados de    Collection                   exclusionCriteria                          markdown                     0..1        Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0048   Metadados de    Collection                   miabisUseAccessConditions                  CodeableConcept\[\]          0..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0049   Metadados de    Collection                   storageTemperatureCategories               CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0050   Metadados de    Collection                   participantCount                           integer                      0..1        Opcional      MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0051   Metadados de    Collection                   sampleCount                                integer                      0..1        Opcional      MongoDB            Fase 1
             biobanco                                                                                                                                                          

  ELM-0052   Metadados de    Collection                   relatedPublications                        Identifier\[\]               0..\*       Opcional      MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  ELM-0053   Estudo e        Study                        studyId                                    uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0054   Estudo e        Study                        studyTitle                                 string                       1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0055   Estudo e        Study                        studyAcronym                               string                       0..1        Opcional      MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0056   Estudo e        Study                        studyObjective                             markdown                     1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0057   Estudo e        Study                        studyDesign                                CodeableConcept              1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0058   Estudo e        Study                        studyStatus                                code                         1..1        Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0059   Estudo e        Study                        principalInvestigator                      Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0060   Estudo e        Study                        ethicsApprovalId                           Identifier                   1..\*       Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0061   Estudo e        Study                        protocolId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0062   Estudo e        Study                        protocolVersion                            string                       1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0063   Estudo e        Study                        recruitmentPeriod                          Period                       0..1        Condicional   MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0064   Estudo e        Study                        studyArms                                  BackboneElement\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0065   Estudo e        Study                        studyFactors                               BackboneElement\[\]          0..\*       Condicional   MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0066   Estudo e        Study                        participatingCenters                       Reference\[\]                0..\*       Condicional   MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0067   Estudo e        Study                        datasetIds                                 Reference\[\]                0..\*       Opcional      MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0068   Estudo e        Protocol                     protocolId                                 uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             protocolo                                                                                                                                                         

  ELM-0069   Estudo e        Protocol                     protocolName                               string                       1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0070   Estudo e        Protocol                     protocolType                               code                         1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0071   Estudo e        Protocol                     protocolVersion                            string                       1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0072   Estudo e        Protocol                     effectivePeriod                            Period                       1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0073   Estudo e        Protocol                     documentUri                                uri                          1..1        Core          Object             Fase 1
             protocolo                                                                                                                                      Storage/MongoDB    

  ELM-0074   Estudo e        Protocol                     approvalStatus                             code                         1..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0075   Estudo e        Protocol                     intendedUse                                markdown                     0..1        Core          MongoDB            Fase 1
             protocolo                                                                                                                                                         

  ELM-0076   Doador e        Participant                  participantId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             participante                                                                                                                                                      

  ELM-0077   Doador e        Participant                  pseudonymId                                Identifier                   1..\*       Core          MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0078   Doador e        Participant                  masterPatientIndexRef                      Reference                    0..1        Condicional   MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0079   Doador e        Participant                  sexAtBirth                                 code                         0..1        Core          MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0080   Doador e        Participant                  genderIdentity                             CodeableConcept              0..1        Opcional      MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0081   Doador e        Participant                  birthDatePrecision                         code                         0..1        Core          MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0082   Doador e        Participant                  birthYear                                  integer                      0..1        Core          MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0083   Doador e        Participant                  ageAtEvent                                 Quantity                     0..1        Core          MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0084   Doador e        Participant                  vitalStatus                                code                         0..1        Condicional   MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0085   Doador e        Participant                  countryOfResidence                         code                         0..1        Opcional      MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0086   Doador e        Participant                  populationDescriptor                       CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1
             participante                                                                                                                                                      

  ELM-0087   Doador e        Participant                  familyId                                   uuid                         0..1        Condicional   Neo4j/MongoDB      Fase 1
             participante                                                                                                                                                      

  ELM-0088   Consentimento e Consent                      consentId                                  uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0089   Consentimento e Consent                      participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0090   Consentimento e Consent                      consentTemplateId                          Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0091   Consentimento e Consent                      consentVersion                             string                       1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  ELM-0092   Consentimento e Consent                      consentStatus                              code                         1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0093   Consentimento e Consent                      decisionDateTime                           dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0094   Consentimento e Consent                      effectivePeriod                            Period                       0..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0095   Consentimento e Consent                      consentModel                               code                         1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  ELM-0096   Consentimento e Consent                      authorizedPurposes                         CodeableConcept\[\]          1..\*       Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0097   Consentimento e Consent                      diseaseRestrictions                        CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0098   Consentimento e Consent                      geneticResearchPermission                  boolean                      0..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0099   Consentimento e Consent                      internationalSharingPermission             boolean                      0..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0100   Consentimento e Consent                      commercialUsePermission                    boolean                      0..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0101   Consentimento e Consent                      futureContactPermission                    boolean                      0..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0102   Consentimento e Consent                      returnOfResultsPreference                  CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             uso                                                                                                                                                               

  ELM-0103   Consentimento e Consent                      dataUseCodes                               Coding\[\]                   0..\*       Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0104   Consentimento e Consent                      restrictionsText                           markdown                     0..1        Condicional   MongoDB            Fase 1
             uso                                                                                                                                                               

  ELM-0105   Consentimento e Consent                      evidenceDocumentUri                        uri                          1..1        Core          Object             Fase 1
             uso                                                                                                                                            Storage/MongoDB    

  ELM-0106   Consentimento e Consent                      evidenceHash                               string                       1..1        Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0107   Consentimento e Consent                      signerRole                                 code                         1..\*       Core          MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0108   Consentimento e Consent                      withdrawalDateTime                         dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0109   Consentimento e Consent                      withdrawalScope                            CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0110   Consentimento e Consent                      withdrawalReason                           string                       0..1        Opcional      MongoDB            Fase 1
             uso                                                                                                                                                               

  ELM-0111   Consentimento e Consent                      supersededByConsentId                      Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  ELM-0112   Consentimento e Consent                      runtimeAccessState                         code                         1..1        Core          Neo4j/MongoDB      Fase 1
             uso                                                                                                                                                               

  ELM-0113   Consentimento e Consent                      blockReasonCodes                           CodeableConcept\[\]          0..\*       Condicional   Neo4j/MongoDB      Fase 1
             uso                                                                                                                                                               

  ELM-0114   Amostra e       Specimen                     specimenId                                 uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0115   Amostra e       Specimen                     accessionIdentifier                        Identifier                   1..\*       Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0116   Amostra e       Specimen                     barcodeValue                               string                       0..1        Core          MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0117   Amostra e       Specimen                     participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0118   Amostra e       Specimen                     collectionId                               Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0119   Amostra e       Specimen                     studyIds                                   Reference\[\]                0..\*       Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0120   Amostra e       Specimen                     parentSpecimenIds                          Reference\[\]                0..\*       Condicional   Neo4j/MongoDB      Fase 1
             material                                                                                                                                                          

  ELM-0121   Amostra e       Specimen                     specimenRole                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0122   Amostra e       Specimen                     materialType                               CodeableConcept              1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0123   Amostra e       Specimen                     specimenStatus                             code                         1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0124   Amostra e       Specimen                     availabilityReason                         CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0125   Amostra e       Specimen                     collectionDateTime                         dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0126   Amostra e       Specimen                     receivedDateTime                           dateTime                     0..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0127   Amostra e       Specimen                     collector                                  Reference                    0..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0128   Amostra e       Specimen                     collectionSite                             Reference                    0..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0129   Amostra e       Specimen                     collectionMethod                           CodeableConcept              0..1        Core          MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0130   Amostra e       Specimen                     anatomicalSite                             CodeableConcept              0..1        Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0131   Amostra e       Specimen                     laterality                                 CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0132   Amostra e       Specimen                     organismTaxon                              Coding                       1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0133   Amostra e       Specimen                     cellType                                   Coding\[\]                   0..\*       Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0134   Amostra e       Specimen                     diseaseContext                             CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0135   Amostra e       Specimen                     pathologyClassification                    CodeableConcept              0..1        Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0136   Amostra e       Specimen                     primaryContainer                           CodeableConcept              0..1        Core          MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0137   Amostra e       Specimen                     containerLot                               string                       0..1        Condicional   MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0138   Amostra e       Specimen                     initialQuantity                            Quantity                     0..1        Core          MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0139   Amostra e       Specimen                     currentQuantity                            Quantity                     0..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0140   Amostra e       Specimen                     concentration                              Quantity                     0..1        Condicional   MongoDB            Fase 1
             material                                                                                                                                                          

  ELM-0141   Amostra e       Specimen                     freezeThawCount                            integer                      0..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0142   Amostra e       Specimen                     processingBatchId                          Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  ELM-0143   Amostra e       Specimen                     poolId                                     Reference                    0..1        Condicional   Neo4j/MongoDB      Fase 1
             material                                                                                                                                                          

  ELM-0144   Amostra e       Specimen                     poolMemberIds                              BackboneElement\[\]          0..\*       Condicional   Neo4j/MongoDB      Fase 1
             material                                                                                                                                                          

  ELM-0145   Qualidade       SpecimenPreanalytics         sprecCode                                  string                       0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0146   Qualidade       SpecimenPreanalytics         sprecVersion                               string                       0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0147   Qualidade       SpecimenPreanalytics         sprecSpecimenType                          code                         0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0148   Qualidade       SpecimenPreanalytics         sprecPrimaryContainer                      code                         0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0149   Qualidade       SpecimenPreanalytics         sprecCollectionType                        code                         0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0150   Qualidade       SpecimenPreanalytics         preCentrifugationDelay                     CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0151   Qualidade       SpecimenPreanalytics         firstCentrifugation                        BackboneElement              0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0152   Qualidade       SpecimenPreanalytics         secondCentrifugation                       BackboneElement              0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0153   Qualidade       SpecimenPreanalytics         postCentrifugationDelay                    CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0154   Qualidade       SpecimenPreanalytics         warmIschemiaTime                           Duration                     0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0155   Qualidade       SpecimenPreanalytics         coldIschemiaTime                           Duration                     0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0156   Qualidade       SpecimenPreanalytics         fixationStabilizationType                  CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0157   Qualidade       SpecimenPreanalytics         fixationTime                               Duration                     0..1        Condicional   MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0158   Qualidade       SpecimenPreanalytics         longTermStorage                            CodeableConcept              0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0159   Qualidade       RCSAssessment                rcsScore                                   decimal                      0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0160   Qualidade       RCSAssessment                rcsGrade                                   code                         0..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0161   Qualidade       RCSAssessment                rcsModelVersion                            string                       1..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0162   Qualidade       RCSAssessment                sprecRcsMappingVersion                     string                       1..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0163   Qualidade       RCSAssessment                rcsAxisResults                             BackboneElement\[\]          0..\*       Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0164   Qualidade       RCSAssessment                governanceGateResult                       code                         1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0165   Qualidade       RCSAssessment                unmappedCodes                              Coding\[\]                   0..\*       Condicional   MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0166   Qualidade       RCSAssessment                rcsCalculatedAt                            dateTime                     0..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  ELM-0167   Inventário      StorageAssignment            storageLocationId                          Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0168   Inventário      StorageAssignment            facilityId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0169   Inventário      StorageAssignment            roomId                                     Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0170   Inventário      StorageAssignment            equipmentId                                Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0171   Inventário      StorageAssignment            shelfId                                    Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0172   Inventário      StorageAssignment            rackId                                     Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0173   Inventário      StorageAssignment            boxId                                      Reference                    0..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0174   Inventário      StorageAssignment            positionCode                               string                       1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0175   Inventário      StorageAssignment            nominalTemperature                         Quantity                     0..1        Core          MongoDB            Fase 1
             físico                                                                                                                                                            

  ELM-0176   Inventário      StorageAssignment            placedAt                                   dateTime                     1..1        Core          Neo4j/MongoDB      Fase 1
             físico                                                                                                                                                            

  ELM-0177   Inventário      StorageAssignment            removedAt                                  dateTime                     0..1        Condicional   Neo4j/MongoDB      Fase 1
             físico                                                                                                                                                            

  ELM-0178   Inventário      StorageAssignment            occupancyStatus                            code                         1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  ELM-0179   Cadeia de       CustodyEvent                 custodyEventId                             uuid                         1..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0180   Cadeia de       CustodyEvent                 eventType                                  code                         1..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0181   Cadeia de       CustodyEvent                 specimenIds                                Reference\[\]                1..\*       Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0182   Cadeia de       CustodyEvent                 occurredAt                                 dateTime                     1..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0183   Cadeia de       CustodyEvent                 recordedAt                                 dateTime                     1..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0184   Cadeia de       CustodyEvent                 actorId                                    Reference                    1..\*       Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0185   Cadeia de       CustodyEvent                 fromLocationId                             Reference                    0..1        Condicional   Neo4j              Fase 1
             custódia                                                                                                                                                          

  ELM-0186   Cadeia de       CustodyEvent                 toLocationId                               Reference                    0..1        Condicional   Neo4j              Fase 1
             custódia                                                                                                                                                          

  ELM-0187   Cadeia de       CustodyEvent                 eventReason                                CodeableConcept              0..1        Core          MongoDB/Neo4j      Fase 1
             custódia                                                                                                                                                          

  ELM-0188   Cadeia de       CustodyEvent                 conditionAtEvent                           CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             custódia                                                                                                                                                          

  ELM-0189   Cadeia de       CustodyEvent                 quantityDelta                              Quantity                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             custódia                                                                                                                                                          

  ELM-0190   Cadeia de       CustodyEvent                 correlationId                              string                       0..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0191   Cadeia de       CustodyEvent                 previousEventHash                          string                       0..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0192   Cadeia de       CustodyEvent                 eventHash                                  string                       1..1        Core          Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0193   Cadeia de       CustodyEvent                 merkleRootRef                              Reference                    0..1        Condicional   Neo4j/MongoDB      Fase 1
             custódia                                                                                                                                                          

  ELM-0194   Dados clínicos  Encounter                    encounterId                                uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0195   Dados clínicos  Encounter                    participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0196   Dados clínicos  Encounter                    encounterType                              CodeableConcept              1..1        Core          MongoDB            Fase 1

  ELM-0197   Dados clínicos  Encounter                    encounterPeriod                            Period                       1..1        Core          MongoDB            Fase 1

  ELM-0198   Dados clínicos  Encounter                    serviceProvider                            Reference                    0..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0199   Dados clínicos  Encounter                    encounterLocation                          Reference                    0..\*       Condicional   MongoDB/Neo4j      Fase 1

  ELM-0200   Dados clínicos  Condition                    conditionId                                uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0201   Dados clínicos  Condition                    participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0202   Dados clínicos  Condition                    conditionCoding                            Coding\[\]                   1..\*       Core          MongoDB/Neo4j      Fase 1

  ELM-0203   Dados clínicos  Condition                    clinicalStatus                             code                         0..1        Core          MongoDB            Fase 1

  ELM-0204   Dados clínicos  Condition                    verificationStatus                         code                         0..1        Core          MongoDB            Fase 1

  ELM-0205   Dados clínicos  Condition                    onset                                      choice                       0..1        Core          MongoDB            Fase 1

  ELM-0206   Dados clínicos  Condition                    abatement                                  choice                       0..1        Condicional   MongoDB            Fase 1

  ELM-0207   Dados clínicos  Condition                    severity                                   CodeableConcept              0..1        Condicional   MongoDB            Fase 1

  ELM-0208   Dados clínicos  Condition                    stage                                      BackboneElement              0..1        Condicional   MongoDB            Fase 1

  ELM-0209   Dados clínicos  Condition                    diagnosisEvidence                          Reference\[\]                0..\*       Core          MongoDB/Neo4j      Fase 1

  ELM-0210   Dados clínicos  Condition                    recordedDate                               dateTime                     0..1        Core          MongoDB            Fase 1

  ELM-0211   Dados clínicos  PhenotypeObservation         phenotypeObservationId                     uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0212   Dados clínicos  PhenotypeObservation         hpoCoding                                  Coding                       1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0213   Dados clínicos  PhenotypeObservation         presenceStatus                             code                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0214   Dados clínicos  PhenotypeObservation         phenotypeOnset                             choice                       0..1        Condicional   MongoDB            Fase 1

  ELM-0215   Dados clínicos  PhenotypeObservation         phenotypeSeverity                          CodeableConcept              0..1        Condicional   MongoDB            Fase 1

  ELM-0216   Dados clínicos  PhenotypeObservation         phenotypeFrequency                         CodeableConcept              0..1        Opcional      MongoDB            Fase 1

  ELM-0217   Dados clínicos  PhenotypeObservation         observationMethod                          CodeableConcept              0..1        Core          MongoDB            Fase 1

  ELM-0218   Dados clínicos  PhenotypeObservation         phenotypeEvidence                          Reference\[\]                0..\*       Core          MongoDB/Neo4j      Fase 1

  ELM-0219   Dados clínicos  ClinicalObservation          observationId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0220   Dados clínicos  ClinicalObservation          observationCoding                          Coding                       1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0221   Dados clínicos  ClinicalObservation          value                                      choice                       0..1        Core          MongoDB            Fase 1

  ELM-0222   Dados clínicos  ClinicalObservation          unit                                       Coding                       0..1        Condicional   MongoDB            Fase 1

  ELM-0223   Dados clínicos  ClinicalObservation          normalizedValue                            Quantity                     0..1        Condicional   MongoDB            Fase 1

  ELM-0224   Dados clínicos  ClinicalObservation          referenceRange                             BackboneElement\[\]          0..\*       Condicional   MongoDB            Fase 1

  ELM-0225   Dados clínicos  ClinicalObservation          interpretation                             CodeableConcept\[\]          0..\*       Condicional   MongoDB            Fase 1

  ELM-0226   Dados clínicos  ClinicalObservation          effectiveDateTime                          dateTime                     1..1        Core          MongoDB            Fase 1

  ELM-0227   Dados clínicos  ClinicalObservation          issuedDateTime                             dateTime                     0..1        Core          MongoDB            Fase 1

  ELM-0228   Dados clínicos  ClinicalObservation          observationStatus                          code                         1..1        Core          MongoDB            Fase 1

  ELM-0229   Dados clínicos  ClinicalObservation          method                                     CodeableConcept              0..1        Core          MongoDB            Fase 1

  ELM-0230   Dados clínicos  ClinicalObservation          deviceId                                   Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0231   Dados clínicos  ClinicalObservation          specimenId                                 Reference                    0..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0232   Dados clínicos  ClinicalObservation          diagnosticReportId                         Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0233   Dados clínicos  MedicationExposure           medicationRecordId                         uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0234   Dados clínicos  MedicationExposure           medicationCoding                           Coding\[\]                   1..\*       Core          MongoDB/Neo4j      Fase 1

  ELM-0235   Dados clínicos  MedicationExposure           recordType                                 code                         1..1        Core          MongoDB            Fase 1

  ELM-0236   Dados clínicos  MedicationExposure           medicationStatus                           code                         1..1        Core          MongoDB            Fase 1

  ELM-0237   Dados clínicos  MedicationExposure           dose                                       Quantity                     0..1        Condicional   MongoDB            Fase 1

  ELM-0238   Dados clínicos  MedicationExposure           route                                      CodeableConcept              0..1        Condicional   MongoDB            Fase 1

  ELM-0239   Dados clínicos  MedicationExposure           frequency                                  Timing                       0..1        Condicional   MongoDB            Fase 1

  ELM-0240   Dados clínicos  MedicationExposure           medicationPeriod                           Period                       0..1        Core          MongoDB            Fase 1

  ELM-0241   Dados clínicos  MedicationExposure           indication                                 Reference\[\]                0..\*       Condicional   MongoDB/Neo4j      Fase 1

  ELM-0242   Dados clínicos  Procedure                    procedureId                                uuid                         1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0243   Dados clínicos  Procedure                    procedureCoding                            Coding\[\]                   1..\*       Core          MongoDB/Neo4j      Fase 1

  ELM-0244   Dados clínicos  Procedure                    performed                                  choice                       1..1        Core          MongoDB            Fase 1

  ELM-0245   Dados clínicos  Procedure                    bodySite                                   CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1

  ELM-0246   Dados clínicos  AllergyIntolerance           allergyId                                  uuid                         1..1        Condicional   MongoDB            Fase 1

  ELM-0247   Dados clínicos  AllergyIntolerance           allergenCoding                             Coding                       1..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0248   Dados clínicos  AllergyIntolerance           reaction                                   BackboneElement\[\]          0..\*       Condicional   MongoDB            Fase 1

  ELM-0249   Dados clínicos  FamilyHistory                familyHistoryId                            uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0250   Dados clínicos  FamilyHistory                relationship                               CodeableConcept              1..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0251   Dados clínicos  FamilyHistory                familyCondition                            BackboneElement\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1

  ELM-0252   Dados clínicos  ClinicalOutcome              outcomeId                                  uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0253   Dados clínicos  ClinicalOutcome              outcomeType                                CodeableConcept              1..1        Condicional   MongoDB/Neo4j      Fase 1

  ELM-0254   Dados clínicos  ClinicalOutcome              outcomeDate                                dateTime                     1..1        Condicional   MongoDB            Fase 1

  ELM-0255   Dados clínicos  DerivedScore                 scoreType                                  CodeableConcept              1..1        Condicional   MongoDB            Fase 1

  ELM-0256   Dados clínicos  DerivedScore                 scoreValue                                 decimal                      1..1        Condicional   MongoDB            Fase 1

  ELM-0257   Dados clínicos  DerivedScore                 algorithmVersion                           string                       1..1        Condicional   MongoDB            Fase 1

  ELM-0258   Dados clínicos  DerivedScore                 lookbackPeriod                             Duration/Period              0..1        Condicional   MongoDB            Fase 1

  ELM-0259   Dados clínicos  DerivedScore                 scoreComponents                            BackboneElement\[\]          1..\*       Condicional   MongoDB/Neo4j      Fase 1

  ELM-0260   Dados de        DiseaseConcept               diseaseConceptId                           uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0261   Dados de        DiseaseConcept               preferredLabel                             string                       1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0262   Dados de        DiseaseConcept               codings                                    Coding\[\]                   1..\*       Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0263   Dados de        DiseaseConcept               conceptStatus                              code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0264   Dados de        DiseaseConcept               synonyms                                   BackboneElement\[\]          0..\*       Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0265   Dados de        DiseaseConcept               definition                                 markdown                     0..\*       Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0266   Dados de        DiseaseConcept               mappings                                   BackboneElement\[\]          0..\*       Core          Neo4j/MongoDB      Fase 1
             referência                                                                                                                                                        

  ELM-0267   Dados de        DiseaseConcept               aggregationCode                            Coding                       0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0268   Dados de        DiseaseConcept               replacementConceptId                       Reference                    0..1        Condicional   Neo4j/MongoDB      Fase 1
             referência                                                                                                                                                        

  ELM-0269   Dados de        GeneConcept                  geneConceptId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0270   Dados de        GeneConcept                  hgncId                                     Coding                       1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0271   Dados de        GeneConcept                  approvedSymbol                             string                       1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0272   Dados de        GeneConcept                  approvedName                               string                       1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0273   Dados de        GeneConcept                  aliases                                    string\[\]                   0..\*       Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0274   Dados de        GeneConcept                  geneDiseaseEvidence                        BackboneElement\[\]          0..\*       Condicional   Neo4j/MongoDB      Fase 1
             referência                                                                                                                                                        

  ELM-0275   Dados de        BiomarkerAssociation         biomarkerId                                uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0276   Dados de        BiomarkerAssociation         analyte                                    CodeableConcept              1..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0277   Dados de        BiomarkerAssociation         associatedCondition                        CodeableConcept\[\]          1..\*       Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0278   Dados de        BiomarkerAssociation         biospecimenMatrix                          CodeableConcept              0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0279   Dados de        BiomarkerAssociation         biomarkerRole                              code                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0280   Dados de        BiomarkerAssociation         contextOfUse                               markdown                     1..1        Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0281   Dados de        BiomarkerAssociation         assayMethod                                Reference/CodeableConcept    0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0282   Dados de        BiomarkerAssociation         cutoff                                     BackboneElement              0..1        Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  ELM-0283   Dados de        BiomarkerAssociation         evidenceLevel                              CodeableConcept              0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0284   Dados de        BiomarkerAssociation         regulatoryStatus                           CodeableConcept              0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0285   Dados de        BiomarkerAssociation         evidenceReferences                         Identifier\[\]               1..\*       Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  ELM-0286   Ensaios e       Assay                        assayId                                    uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0287   Ensaios e       Assay                        studyId                                    Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0288   Ensaios e       Assay                        specimenIds                                Reference\[\]                1..\*       Core          Neo4j/MongoDB      Fase 1
             experimentos                                                                                                                                                      

  ELM-0289   Ensaios e       Assay                        assayType                                  CodeableConcept              1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0290   Ensaios e       Assay                        omicsDomain                                code                         0..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0291   Ensaios e       Assay                        protocolId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0292   Ensaios e       Assay                        operatorId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0293   Ensaios e       Assay                        laboratoryId                               Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0294   Ensaios e       Assay                        assayDateTime                              dateTime                     1..1        Core          MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0295   Ensaios e       Assay                        assayBatchId                               string                       0..1        Core          MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0296   Ensaios e       Assay                        controls                                   BackboneElement\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0297   Ensaios e       Assay                        intendedUse                                CodeableConcept/markdown     1..1        Core          MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0298   Ensaios e       ReagentLot                   reagentId                                  uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0299   Ensaios e       ReagentLot                   reagentName                                string                       1..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0300   Ensaios e       ReagentLot                   manufacturer                               Reference/string             0..1        Condicional   MongoDB/Neo4j      Fase 1
             experimentos                                                                                                                                                      

  ELM-0301   Ensaios e       ReagentLot                   catalogNumber                              string                       0..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0302   Ensaios e       ReagentLot                   lotNumber                                  string                       1..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0303   Ensaios e       ReagentLot                   expirationDate                             date                         0..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0304   Ensaios e       ReagentLot                   storageCondition                           CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             experimentos                                                                                                                                                      

  ELM-0305   Equipamentos e  Device                       deviceId                                   uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             métodos                                                                                                                                                           

  ELM-0306   Equipamentos e  Device                       deviceType                                 CodeableConcept              1..1        Core          MongoDB/Neo4j      Fase 1
             métodos                                                                                                                                                           

  ELM-0307   Equipamentos e  Device                       manufacturer                               string                       0..1        Core          MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0308   Equipamentos e  Device                       modelNumber                                string                       0..1        Core          MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0309   Equipamentos e  Device                       serialNumber                               string                       0..1        Core          MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0310   Equipamentos e  Device                       firmwareVersion                            string                       0..1        Condicional   MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0311   Equipamentos e  Device                       softwareVersion                            string                       0..1        Condicional   MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0312   Equipamentos e  Device                       qualificationStatus                        code                         0..1        Core          MongoDB/Neo4j      Fase 1
             métodos                                                                                                                                                           

  ELM-0313   Equipamentos e  Device                       calibrationDate                            date                         0..1        Core          MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0314   Equipamentos e  Device                       calibrationDueDate                         date                         0..1        Core          MongoDB            Fase 1
             métodos                                                                                                                                                           

  ELM-0315   Equipamentos e  Device                       maintenanceRecords                         Reference\[\]                0..\*       Core          MongoDB/Neo4j      Fase 1
             métodos                                                                                                                                                           

  ELM-0316   Arquivos        DataFile                     fileId                                     uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             científicos                                                                                                                                                       

  ELM-0317   Arquivos        DataFile                     fileRole                                   code                         1..1        Core          MongoDB/Neo4j      Fase 1
             científicos                                                                                                                                                       

  ELM-0318   Arquivos        DataFile                     fileUri                                    uri                          1..1        Core          MongoDB/Object     Fase 1
             científicos                                                                                                                                    Storage            

  ELM-0319   Arquivos        DataFile                     fileFormat                                 Coding                       1..1        Core          MongoDB            Fase 1
             científicos                                                                                                                                                       

  ELM-0320   Arquivos        DataFile                     fileSizeBytes                              integer64                    1..1        Core          MongoDB            Fase 1
             científicos                                                                                                                                                       

  ELM-0321   Arquivos        DataFile                     checksum                                   string                       1..1        Core          MongoDB/Object     Fase 1
             científicos                                                                                                                                    Storage            

  ELM-0322   Arquivos        DataFile                     compression                                code                         0..1        Condicional   MongoDB            Fase 1
             científicos                                                                                                                                                       

  ELM-0323   Arquivos        DataFile                     encryptionStatus                           code                         1..1        Core          MongoDB            Fase 1
             científicos                                                                                                                                                       

  ELM-0324   Arquivos        DataFile                     accessRestrictions                         Reference\[\]                1..\*       Core          MongoDB/Neo4j      Fase 1
             científicos                                                                                                                                                       

  ELM-0325   Arquivos        DataFile                     depositionAccession                        Identifier\[\]               0..\*       Opcional      MongoDB/Neo4j      Fase 1
             científicos                                                                                                                                                       

  ELM-0326   Proveniência    WorkflowRun                  workflowRunId                              uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             computacional                                                                                                                                                     

  ELM-0327   Proveniência    WorkflowRun                  workflowId                                 Identifier                   1..1        Condicional   MongoDB/Neo4j      Fase 1
             computacional                                                                                                                                                     

  ELM-0328   Proveniência    WorkflowRun                  workflowVersion                            string                       1..1        Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0329   Proveniência    WorkflowRun                  containerImageDigest                       string                       0..1        Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0330   Proveniência    WorkflowRun                  softwareDependencies                       BackboneElement\[\]          0..\*       Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0331   Proveniência    WorkflowRun                  parameters                                 object                       0..1        Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0332   Proveniência    WorkflowRun                  inputFileIds                               Reference\[\]                1..\*       Condicional   Neo4j/MongoDB      Fase 1
             computacional                                                                                                                                                     

  ELM-0333   Proveniência    WorkflowRun                  outputFileIds                              Reference\[\]                1..\*       Condicional   Neo4j/MongoDB      Fase 1
             computacional                                                                                                                                                     

  ELM-0334   Proveniência    WorkflowRun                  startedAt                                  dateTime                     1..1        Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0335   Proveniência    WorkflowRun                  completedAt                                dateTime                     0..1        Condicional   MongoDB            Fase 1
             computacional                                                                                                                                                     

  ELM-0336   Proveniência    WorkflowRun                  runStatus                                  code                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             computacional                                                                                                                                                     

  ELM-0337   Qualidade       OmicsQualification           omicsQualificationId                       uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0338   Qualidade       OmicsQualification           targetAssay                                CodeableConcept              1..1        Condicional   MongoDB/Neo4j      Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0339   Qualidade       OmicsQualification           qcRuleSetVersion                           string                       1..1        Condicional   MongoDB            Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0340   Qualidade       OmicsQualification           qcMetrics                                  BackboneElement\[\]          1..\*       Condicional   MongoDB            Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0341   Qualidade       OmicsQualification           qualificationDecision                      code                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0342   Qualidade       OmicsQualification           limitations                                markdown                     0..1        Condicional   MongoDB            Fase 1
             específica do                                                                                                                                                     
             ensaio                                                                                                                                                            

  ELM-0343   Dados ômicos e  GenomicsRun                  referenceAssembly                          Coding                       1..1        Condicional   MongoDB/Neo4j      Fase 1
             imagens                                                                                                                                                           

  ELM-0344   Dados ômicos e  GenomicsRun                  readFiles                                  Reference\[\]                1..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0345   Dados ômicos e  GenomicsRun                  alignmentFiles                             Reference\[\]                0..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0346   Dados ômicos e  GenomicsRun                  variantFiles                               Reference\[\]                0..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0347   Dados ômicos e  TranscriptomicsRun           expressionMatrix                           Reference                    0..1        Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0348   Dados ômicos e  ProteomicsRun                spectraFiles                               Reference\[\]                1..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0349   Dados ômicos e  ProteomicsRun                identificationFiles                        Reference\[\]                0..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0350   Dados ômicos e  MetabolomicsRun              metabolomicsFiles                          Reference\[\]                1..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0351   Dados ômicos e  MicrobiomeRun                mixsChecklist                              Coding                       1..1        Condicional   MongoDB            Fase 1
             imagens                                                                                                                                                           

  ELM-0352   Dados ômicos e  MicrobiomeRun                sequenceFiles                              Reference\[\]                1..\*       Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0353   Dados ômicos e  ImagingStudy                 dicomStudyUid                              string                       1..1        Condicional   DICOM              Fase 1
             imagens                                                                                                                                        server/MongoDB     

  ELM-0354   Dados ômicos e  ImagingStudy                 series                                     BackboneElement\[\]          1..\*       Condicional   DICOM              Fase 1
             imagens                                                                                                                                        server/MongoDB     

  ELM-0355   Dados ômicos e  ImagingDerivedData           segmentationFile                           Reference                    0..1        Condicional   Object             Fase 1
             imagens                                                                                                                                        Storage/Neo4j      

  ELM-0356   Dados ômicos e  ImagingDerivedData           featureSet                                 BackboneElement\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             imagens                                                                                                                                                           

  ELM-0357   Telemetria      TelemetryReading             sensorId                                   Reference(Device)            1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0358   Telemetria      TelemetryReading             equipmentId                                Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0359   Telemetria      TelemetryReading             metricType                                 code                         1..1        Core          InfluxDB/MongoDB   Fase 1

  ELM-0360   Telemetria      TelemetryReading             timestamp                                  dateTime                     1..1        Core          InfluxDB           Fase 1

  ELM-0361   Telemetria      TelemetryReading             value                                      decimal                      1..1        Core          InfluxDB           Fase 1

  ELM-0362   Telemetria      TelemetryReading             unit                                       Coding                       1..1        Core          InfluxDB           Fase 1

  ELM-0363   Telemetria      TelemetryReading             measurementQuality                         code                         0..1        Core          InfluxDB           Fase 1

  ELM-0364   Telemetria      TelemetryReading             calibrationStatus                          code                         0..1        Core          InfluxDB/MongoDB   Fase 1

  ELM-0365   Telemetria      TelemetryReading             thresholdProfileId                         Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  ELM-0366   Telemetria e    EnvironmentalExcursion       excursionId                                uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0367   Telemetria e    EnvironmentalExcursion       equipmentId                                Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0368   Telemetria e    EnvironmentalExcursion       startDateTime                              dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0369   Telemetria e    EnvironmentalExcursion       endDateTime                                dateTime                     0..1        Core          MongoDB/Neo4j      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0370   Telemetria e    EnvironmentalExcursion       minimumValue                               Quantity                     0..1        Core          MongoDB            Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0371   Telemetria e    EnvironmentalExcursion       maximumValue                               Quantity                     0..1        Core          MongoDB            Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0372   Telemetria e    EnvironmentalExcursion       duration                                   Duration                     0..1        Core          MongoDB            Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0373   Telemetria e    EnvironmentalExcursion       affectedSpecimenIds                        Reference\[\]                0..\*       Core          Neo4j/MongoDB      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0374   Telemetria e    EnvironmentalExcursion       excursionStatus                            code                         1..1        Core          MongoDB/Neo4j      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0375   Telemetria e    EnvironmentalExcursion       impactAssessment                           markdown                     0..1        Core          MongoDB            Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0376   Telemetria e    EnvironmentalExcursion       quarantineActionId                         Reference                    0..1        Core          Neo4j/MongoDB      Fase 1
             cadeia fria                                                                                                                                                       

  ELM-0377   Gestão da       Nonconformance               nonconformanceId                           uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  ELM-0378   Gestão da       Nonconformance               nonconformanceType                         CodeableConcept              1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  ELM-0379   Gestão da       Nonconformance               detectedAt                                 dateTime                     1..1        Core          MongoDB            Fase 1
             qualidade                                                                                                                                                         

  ELM-0380   Gestão da       Nonconformance               detectedBy                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  ELM-0381   Gestão da       Nonconformance               description                                markdown                     1..1        Core          MongoDB            Fase 1
             qualidade                                                                                                                                                         

  ELM-0382   Gestão da       Nonconformance               affectedEntityIds                          Reference\[\]                1..\*       Core          Neo4j/MongoDB      Fase 1
             qualidade                                                                                                                                                         

  ELM-0383   Gestão da       Nonconformance               immediateActions                           BackboneElement\[\]          0..\*       Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  ELM-0384   Gestão da       Nonconformance               rootCause                                  markdown                     0..1        Core          MongoDB            Fase 1
             qualidade                                                                                                                                                         

  ELM-0385   Gestão da       Nonconformance               capaId                                     Reference                    0..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  ELM-0386   Gestão da       Nonconformance               effectivenessVerification                  BackboneElement              0..1        Core          MongoDB            Fase 1
             qualidade                                                                                                                                                         

  ELM-0387   Gestão da       Nonconformance               closureDate                                date                         0..1        Core          MongoDB            Fase 1
             qualidade                                                                                                                                                         

  ELM-0388   Acesso e        AccessRequest                accessRequestId                            uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0389   Acesso e        AccessRequest                requesterId                                Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0390   Acesso e        AccessRequest                studyId                                    Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0391   Acesso e        AccessRequest                requestedPurpose                           markdown/CodeableConcept     1..1        Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0392   Acesso e        AccessRequest                requestedItems                             BackboneElement\[\]          1..\*       Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0393   Acesso e        AccessRequest                consentCompatibility                       BackboneElement\[\]          1..\*       Core          Neo4j/MongoDB      Fase 1
             distribuição                                                                                                                                                      

  ELM-0394   Acesso e        AccessRequest                committeeDecision                          BackboneElement              1..1        Core          MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0395   Acesso e        AccessRequest                approvalPeriod                             Period                       0..1        Core          MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0396   Transporte e    Shipment                     shipmentId                                 uuid                         1..1        Condicional   MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0397   Transporte e    Shipment                     specimenIds                                Reference\[\]                1..\*       Condicional   Neo4j/MongoDB      Fase 1
             distribuição                                                                                                                                                      

  ELM-0398   Transporte e    Shipment                     senderOrganization                         Reference                    1..1        Condicional   MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0399   Transporte e    Shipment                     recipientOrganization                      Reference                    1..1        Condicional   MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0400   Transporte e    Shipment                     mtaId                                      Reference                    1..1        Condicional   MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0401   Transporte e    Shipment                     carrier                                    string/Reference             0..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0402   Transporte e    Shipment                     trackingNumber                             string                       0..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0403   Transporte e    Shipment                     packagingType                              CodeableConcept              1..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0404   Transporte e    Shipment                     temperatureLoggerId                        Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             distribuição                                                                                                                                                      

  ELM-0405   Transporte e    Shipment                     dispatchDateTime                           dateTime                     1..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0406   Transporte e    Shipment                     receiptDateTime                            dateTime                     0..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0407   Transporte e    Shipment                     conditionOnReceipt                         BackboneElement              0..1        Condicional   MongoDB            Fase 1
             distribuição                                                                                                                                                      

  ELM-0408   Retenção e      RetentionPolicy              retentionPolicyId                          uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             destino final                                                                                                                                                     

  ELM-0409   Retenção e      RetentionPolicy              retentionBasis                             CodeableConcept              1..\*       Core          MongoDB/Neo4j      Fase 1
             destino final                                                                                                                                                     

  ELM-0410   Retenção e      RetentionPolicy              retentionPeriod                            BackboneElement              0..1        Core          MongoDB            Fase 1
             destino final                                                                                                                                                     

  ELM-0411   Retenção e      DispositionAction            legalHold                                  boolean                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             destino final                                                                                                                                                     

  ELM-0412   Retenção e      DispositionAction            dispositionAction                          code                         1..1        Core          MongoDB/Neo4j      Fase 1
             destino final                                                                                                                                                     

  ELM-0413   Retenção e      DispositionAction            dispositionMethod                          CodeableConcept              0..1        Condicional   MongoDB            Fase 1
             destino final                                                                                                                                                     

  ELM-0414   Retenção e      DispositionAction            dispositionDateTime                        dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             destino final                                                                                                                                                     

  ELM-0415   Retenção e      DispositionAction            dispositionCertificateUri                  uri                          0..1        Condicional   Object             Fase 1
             destino final                                                                                                                                  Storage/MongoDB    

  ELM-0416   FAIR e          Dataset                      datasetId                                  uuid                         1..1        Opcional      MongoDB/Neo4j      Fase 1
             publicação                                                                                                                                                        

  ELM-0417   FAIR e          Dataset                      datasetTitle                               string                       1..1        Opcional      MongoDB            Fase 1
             publicação                                                                                                                                                        

  ELM-0418   FAIR e          Dataset                      datasetVersion                             string                       1..1        Opcional      MongoDB            Fase 1
             publicação                                                                                                                                                        

  ELM-0419   FAIR e          Dataset                      creators                                   BackboneElement\[\]          1..\*       Opcional      MongoDB/Neo4j      Fase 1
             publicação                                                                                                                                                        

  ELM-0420   FAIR e          Dataset                      doi                                        Identifier                   0..1        Opcional      MongoDB/Neo4j      Fase 1
             publicação                                                                                                                                                        

  ELM-0421   FAIR e          Dataset                      license                                    CodeableConcept/uri          1..1        Opcional      MongoDB            Fase 1
             publicação                                                                                                                                                        

  ELM-0422   FAIR e          Dataset                      distributionFiles                          Reference\[\]                1..\*       Opcional      Object             Fase 1
             publicação                                                                                                                                     Storage/MongoDB    

  ELM-0423   FAIR e          Dataset                      roCrateManifest                            Reference                    0..1        Opcional      Object             Fase 1
             publicação                                                                                                                                     Storage/MongoDB    

  P1X-0001   Metadados de    Network                      networkId                                  uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0002   Metadados de    Network                      acronym                                    string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0003   Metadados de    Network                      name                                       string                       1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0004   Metadados de    Network                      url                                        uri                          0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0005   Metadados de    Network                      juristicPerson                             Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0006   Metadados de    Network                      countryCodes                               code\[\]                     1..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0007   Metadados de    Network                      contactInformation                         ContactInformation           1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0008   Metadados de    Network                      description                                markdown                     1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0009   Metadados de    Network                      networkStatus                              code                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0010   Metadados de    Network                      networkMembers                             Reference\[\]                0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0011   Metadados de    Network                      commonCollaborationTopics                  code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0012   Metadados de    Network                      networkType                                code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0013   Metadados de    ResearchResource             researchResourceId                         uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0014   Metadados de    ResearchResource             acronym                                    string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0015   Metadados de    ResearchResource             name                                       string                       1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0016   Metadados de    ResearchResource             url                                        uri                          0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0017   Metadados de    ResearchResource             contactInformation                         ContactInformation\[\]       1..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0018   Metadados de    ResearchResource             description                                markdown                     0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0019   Metadados de    ResearchResource             sampleSource                               code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0020   Metadados de    ResearchResource             sexCategories                              code\[\]                     1..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0021   Metadados de    ResearchResource             ageLow                                     decimal                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0022   Metadados de    ResearchResource             ageHigh                                    decimal                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0023   Metadados de    ResearchResource             ageLowUnit                                 code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0024   Metadados de    ResearchResource             ageHighUnit                                code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0025   Metadados de    ResearchResource             datasetTypes                               CodeableConcept\[\]          0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0026   Metadados de    ResearchResource             sampleTypes                                CodeableConcept\[\]          1..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0027   Metadados de    ResearchResource             storageTemperatures                        CodeableConcept\[\]          0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0028   Metadados de    ResearchResource             diseases                                   Disease\[\]                  0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0029   Metadados de    ResearchResource             sampleCollectionSettings                   code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0030   Metadados de    ResearchResource             researchResourceDesigns                    code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0031   Metadados de    ResearchResource             useAccessConditions                        CodeableConcept\[\]          0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0032   Metadados de    ResearchResource             researchResourceStatus                     code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0033   Metadados de    ResearchResource             totalNumberOfSubjects                      integer                      0..1        Derivado      MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0034   Metadados de    ResearchResource             inclusionCriteria                          code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0035   Metadados de    ResearchResource             publications                               Identifier\[\]               0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0036   Metadados de    Biobank                      acronym                                    string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0037   Metadados de    Biobank                      url                                        uri                          0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0038   Metadados de    Biobank                      countryCode                                code                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0039   Metadados de    Biobank                      contactInformation                         ContactInformation           1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0040   Metadados de    Biobank                      infrastructuralCapabilities                code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0041   Metadados de    Biobank                      organisationalCapabilities                 code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0042   Metadados de    Biobank                      bioprocessingAnalyticalCapabilities        code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0043   Metadados de    Biobank                      qualityManagementStandards                 CodeableConcept\[\]          0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0044   Metadados de    Collection                   acronym                                    string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0045   Metadados de    Collection                   url                                        uri                          0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0046   Metadados de    Collection                   contactInformation                         ContactInformation           1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0047   Metadados de    Collection                   sampleSource                               code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0048   Metadados de    Collection                   sexCategories                              code\[\]                     1..\*       Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0049   Metadados de    Collection                   ageLow                                     decimal                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0050   Metadados de    Collection                   ageHigh                                    decimal                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0051   Metadados de    Collection                   ageLowUnit                                 code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0052   Metadados de    Collection                   ageHighUnit                                code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0053   Metadados de    Collection                   sampleCollectionSettings                   code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0054   Metadados de    Collection                   collectionDesigns                          code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0055   Metadados de    Collection                   totalNumberOfSubjects                      integer                      0..1        Derivado      MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0056   Metadados de    Collection                   publications                               Identifier\[\]               0..\*       Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0057   Qualidade       SpecimenPreanalytics         sprecProfileId                             uuid                         1..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0058   Qualidade       SpecimenPreanalytics         specimenId                                 Reference                    1..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0059   Qualidade       SpecimenPreanalytics         profileStatus                              code                         1..1        Core          MongoDB            Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0060   Qualidade       RCSAssessment                rcsAssessmentId                            uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0061   Qualidade       RCSAssessment                specimenId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0062   Qualidade       RCSAssessment                sprecProfileId                             Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0063   Qualidade       RCSAssessment                matrixType                                 code                         1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0064   Qualidade       RCSAssessment                biologicalPenalty                          decimal                      0..1        Condicional   MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0065   Qualidade       RCSAssessment                scoreBasedGrade                            code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0066   Qualidade       RCSAssessment                decisionRoute                              code                         1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0067   Qualidade       RCSAssessment                governanceChecks                           BackboneElement\[\]          1..\*       Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0068   Qualidade       RCSAssessment                governanceFailureCodes                     CodeableConcept\[\]          0..\*       Condicional   MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0069   Qualidade       RCSAssessment                inputSnapshotHash                          string                       1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0070   Qualidade       RCSAssessment                evidenceRefs                               Reference\[\]                0..\*       Essencial     MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0071   Qualidade       RCSAssessment                calculationStatus                          code                         1..1        Core          MongoDB/Neo4j      Fase 1
             pré-analítica                                                                                                                                                     

  P1X-0072   Inventário      StorageAssignment            storageAssignmentId                        uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0073   Inventário      StorageAssignment            specimenId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0074   Dados clínicos  PhenotypeObservation         participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  P1X-0075   Dados clínicos  PhenotypeObservation         encounterId                                Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1

  P1X-0076   Dados clínicos  PhenotypeObservation         effectiveDateTime                          dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1

  P1X-0077   Dados clínicos  ClinicalObservation          participantId                              Reference                    1..1        Core          MongoDB/Neo4j      Fase 1

  P1X-0078   Dados clínicos  ClinicalObservation          encounterId                                Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1

  P1X-0079   Organização     ContactInformation           firstName                                  string                       0..1        Condicional   MongoDB            Fase 1

  P1X-0080   Organização     ContactInformation           lastName                                   string                       0..1        Condicional   MongoDB            Fase 1

  P1X-0081   Organização     ContactInformation           phone                                      string                       0..1        Essencial     MongoDB            Fase 1

  P1X-0082   Organização     ContactInformation           email                                      string                       0..1        Core          MongoDB            Fase 1

  P1X-0083   Organização     ContactInformation           address                                    string                       0..1        Essencial     MongoDB            Fase 1

  P1X-0084   Organização     ContactInformation           postalCode                                 string                       0..1        Essencial     MongoDB            Fase 1

  P1X-0085   Organização     ContactInformation           city                                       string                       0..1        Essencial     MongoDB            Fase 1

  P1X-0086   Organização     ContactInformation           countryCode                                code                         0..1        Essencial     MongoDB            Fase 1

  P1X-0087   Organização     ContactInformation           juristicPerson                             Reference                    0..1        Essencial     MongoDB            Fase 1

  P1X-0088   Organização     ContactInformation           department                                 string                       0..1        Essencial     MongoDB            Fase 1

  P1X-0089   Organização     ContactInformation           orcid                                      Identifier                   0..1        Essencial     MongoDB            Fase 1

  P1X-0090   Consentimento e ConsentTemplate              consentTemplateId                          uuid                         1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0091   Consentimento e ConsentTemplate              templateName                               string                       1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0092   Consentimento e ConsentTemplate              templateVersion                            string                       1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0093   Consentimento e ConsentTemplate              language                                   code                         1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0094   Consentimento e ConsentTemplate              effectivePeriod                            Period                       1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0095   Consentimento e ConsentTemplate              documentUri                                uri                          1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0096   Consentimento e ConsentTemplate              documentHash                               string                       1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0097   Consentimento e ConsentTemplate              approvalStatus                             code                         1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0098   Inventário      StorageLocation              storageLocationId                          uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0099   Inventário      StorageLocation              locationType                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0100   Inventário      StorageLocation              name                                       string                       1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0101   Inventário      StorageLocation              code                                       string                       1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0102   Inventário      StorageLocation              parentLocationId                           Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0103   Inventário      StorageLocation              organizationId                             Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0104   Inventário      StorageLocation              locationStatus                             code                         1..1        Core          MongoDB/Neo4j      Fase 1
             físico                                                                                                                                                            

  P1X-0105   Telemetria      ThresholdProfile             thresholdProfileId                         uuid                         1..1        Core          MongoDB            Fase 1

  P1X-0106   Telemetria      ThresholdProfile             profileName                                string                       1..1        Core          MongoDB            Fase 1

  P1X-0107   Telemetria      ThresholdProfile             metricType                                 code                         1..1        Core          MongoDB            Fase 1

  P1X-0108   Telemetria      ThresholdProfile             lowerLimit                                 Quantity                     0..1        Condicional   MongoDB            Fase 1

  P1X-0109   Telemetria      ThresholdProfile             upperLimit                                 Quantity                     0..1        Condicional   MongoDB            Fase 1

  P1X-0110   Telemetria      ThresholdProfile             minimumDuration                            Duration                     0..1        Essencial     MongoDB            Fase 1

  P1X-0111   Telemetria      ThresholdProfile             effectivePeriod                            Period                       1..1        Core          MongoDB            Fase 1

  P1X-0112   Telemetria      ThresholdProfile             ruleVersion                                string                       1..1        Core          MongoDB            Fase 1

  P1X-0113   Gestão da       QuarantineAction             quarantineActionId                         uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0114   Gestão da       QuarantineAction             specimenIds                                Reference\[\]                1..\*       Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0115   Gestão da       QuarantineAction             reasonCodes                                CodeableConcept\[\]          1..\*       Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0116   Gestão da       QuarantineAction             startedAt                                  dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0117   Gestão da       QuarantineAction             releasedAt                                 dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0118   Gestão da       QuarantineAction             actionStatus                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0119   Gestão da       QuarantineAction             authorizedBy                               Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             qualidade                                                                                                                                                         

  P1X-0120   Administração e AccessPolicy                 accessPolicyId                             uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0121   Administração e AccessPolicy                 policyName                                 string                       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0122   Administração e AccessPolicy                 policyVersion                              string                       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0123   Administração e AccessPolicy                 applicableEntityTypes                      code\[\]                     1..\*       Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0124   Administração e AccessPolicy                 purposeCodes                               Coding\[\]                   0..\*       Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0125   Administração e AccessPolicy                 decisionEffect                             code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0126   Administração e AccessPolicy                 ruleExpression                             string                       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0127   Administração e AccessPolicy                 effectivePeriod                            Period                       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0128   Administração e Actor                        actorId                                    uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0129   Administração e Actor                        actorType                                  code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0130   Administração e Actor                        displayName                                string                       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0131   Administração e Actor                        organizationId                             Reference                    0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0132   Administração e Actor                        externalIdentifier                         Identifier                   0..\*       Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0133   Administração e Actor                        actorStatus                                code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0134   Administração e Actor                        roles                                      code\[\]                     0..\*       Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0135   Metadados de    NetworkMembership            membershipId                               uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0136   Metadados de    NetworkMembership            networkId                                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0137   Metadados de    NetworkMembership            memberType                                 code                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0138   Metadados de    NetworkMembership            memberId                                   Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0139   Metadados de    NetworkMembership            membershipStatus                           code                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0140   Metadados de    NetworkMembership            validFrom                                  dateTime                     0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0141   Metadados de    NetworkMembership            validUntil                                 dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0142   Metadados de    ResearchResourceCollection   associationId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0143   Metadados de    ResearchResourceCollection   researchResourceId                         Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0144   Metadados de    ResearchResourceCollection   collectionId                               Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0145   Metadados de    ResearchResourceCollection   associationRole                            code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0146   Metadados de    ResearchResourceCollection   effectivePeriod                            Period                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0147   Metadados de    ResearchResourceBiobank      associationId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0148   Metadados de    ResearchResourceBiobank      researchResourceId                         Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0149   Metadados de    ResearchResourceBiobank      biobankId                                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0150   Metadados de    ResearchResourceBiobank      associationRole                            code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0151   Metadados de    ResearchResourceBiobank      effectivePeriod                            Period                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0152   Retenção e      RetentionPolicy              triggerEvent                               code                         1..1        Core          MongoDB            Fase 1
             destino final                                                                                                                                                     

  P1X-0153   Retenção e      RetentionPolicy              applicableEntityTypes                      code\[\]                     1..\*       Core          MongoDB            Fase 1
             destino final                                                                                                                                                     

  P1X-0154   Retenção e      RetentionPolicy              postRetentionAction                        code                         1..1        Core          MongoDB            Fase 1
             destino final                                                                                                                                                     

  P1X-0155   Retenção e      RetentionPolicy              effectivePeriod                            Period                       1..1        Core          MongoDB            Fase 1
             destino final                                                                                                                                                     

  P1X-0156   Amostra e       ProcessingBatch              processingBatchId                          uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0157   Amostra e       ProcessingBatch              protocolId                                 Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0158   Amostra e       ProcessingBatch              startedAt                                  dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0159   Amostra e       ProcessingBatch              endedAt                                    dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0160   Amostra e       ProcessingBatch              operatorIds                                Reference\[\]                1..\*       Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0161   Amostra e       ProcessingBatch              batchStatus                                code                         1..1        Core          MongoDB/Neo4j      Fase 1
             material                                                                                                                                                          

  P1X-0162   Governança      MerkleRoot                   merkleRootId                               uuid                         1..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0163   Governança      MerkleRoot                   rootHash                                   string                       1..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0164   Governança      MerkleRoot                   hashAlgorithm                              code                         1..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0165   Governança      MerkleRoot                   coveredPeriod                              Period                       1..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0166   Governança      MerkleRoot                   eventCount                                 integer                      1..1        Core          MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0167   Governança      MerkleRoot                   anchorEvidenceUri                          uri                          0..1        Essencial     MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0168   Dados clínicos  DiagnosticReport             diagnosticReportId                         uuid                         1..1        Core          MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0169   Dados clínicos  DiagnosticReport             participantId                              Reference                    1..1        Core          MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0170   Dados clínicos  DiagnosticReport             encounterId                                Reference                    0..1        Condicional   MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0171   Dados clínicos  DiagnosticReport             reportStatus                               code                         1..1        Core          MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0172   Dados clínicos  DiagnosticReport             issuedDateTime                             dateTime                     0..1        Essencial     MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0173   Dados clínicos  DiagnosticReport             resultIds                                  Reference\[\]                0..\*       Essencial     MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0174   Dados clínicos  DiagnosticReport             documentUri                                uri                          0..1        Essencial     MongoDB/Object     Fase 1
                                                                                                                                                            Storage            

  P1X-0175   Administração e AuditEvent                   auditEventId                               uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0176   Administração e AuditEvent                   eventType                                  code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0177   Administração e AuditEvent                   occurredAt                                 dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0178   Administração e AuditEvent                   actorId                                    Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0179   Administração e AuditEvent                   targetRefs                                 Reference\[\]                1..\*       Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0180   Administração e AuditEvent                   outcome                                    code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0181   Administração e AuditEvent                   correlationId                              string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0182   Administração e UserAccount                  userAccountId                              uuid                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0183   Administração e UserAccount                  actorId                                    Reference(Actor)             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0184   Administração e UserAccount                  displayName                                string                       1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0185   Administração e UserAccount                  email                                      string/email                 1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0186   Administração e UserAccount                  phone                                      string/E.164                 0..1        Opcional      MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0187   Administração e UserAccount                  organizationId                             Reference(Organization)      0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0188   Administração e UserAccount                  institutionLegacy                          string                       0..1        Extensão      MongoDB            Fase 1
             segurança                                                                                                                        local                            

  P1X-0189   Administração e UserAccount                  username                                   string                       1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0190   Administração e UserAccount                  passwordHash                               secret/hash                  1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0191   Administração e UserAccount                  accessTypeLegacy                           integer code                 0..1        Extensão      MongoDB            Fase 1
             segurança                                                                                                                        local                            

  P1X-0192   Administração e UserAccount                  primaryRoleId                              Reference(Role)              1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0193   Administração e UserAccount                  accountStatus                              code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0194   Administração e UserAccount                  anonId                                     string pseudonym             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0195   Administração e UserAccount                  mfaEnabled                                 boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0196   Administração e UserAccount                  mfaMethod                                  code                         0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0197   Administração e UserAccount                  mfaSecretCiphertext                        secret/encrypted             0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0198   Administração e UserAccount                  mfaSetupAt                                 dateTime                     0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0199   Administração e UserAccount                  mfaFailedAttempts                          integer \>=0                 1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0200   Administração e UserAccount                  mfaLocked                                  boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0201   Administração e UserAccount                  mfaLockedUntil                             dateTime                     0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0202   Administração e UserAccount                  lastLoginAt                                dateTime                     0..1        O/D           MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0203   Administração e UserAccount                  passwordHistoryHashes                      secret/hash\[\]              0..\*       Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0204   Administração e UserAccount                  passwordChangedAt                          dateTime                     1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0205   Administração e UserAccount                  forcePasswordReset                         boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0206   Administração e UserAccount                  failedLoginAttempts                        integer \>=0                 1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0207   Administração e UserAccount                  passwordResetTokenHash                     secret/hash                  0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0208   Administração e UserAccount                  passwordResetExpiresAt                     dateTime                     0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0209   Administração e Role                         roleId                                     uuid                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0210   Administração e Role                         roleCode                                   code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0211   Administração e Role                         displayName                                string/i18n                  1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0212   Administração e Role                         description                                string                       0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0213   Administração e Role                         hierarchyLevel                             integer                      0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0214   Administração e Role                         permissionIds                              Reference(Permission)\[\]    1..\*       Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0215   Administração e Role                         roleStatus                                 code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0216   Administração e Role                         effectivePeriod                            Period                       0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0217   Administração e Permission                   permissionId                               uuid                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0218   Administração e Permission                   permissionCode                             code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0219   Administração e Permission                   displayName                                string/i18n                  1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0220   Administração e Permission                   description                                string                       0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0221   Administração e Permission                   resourceType                               code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0222   Administração e Permission                   allowedActions                             code\[\]                     1..\*       Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0223   Administração e Permission                   conditionExpression                        expression                   0..1        Opcional      MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0224   Administração e Permission                   permissionStatus                           code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0225   Administração e UserRoleAssignment           assignmentId                               uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0226   Administração e UserRoleAssignment           userAccountId                              Reference(UserAccount)       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0227   Administração e UserRoleAssignment           roleId                                     Reference(Role)              1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0228   Administração e UserRoleAssignment           scopeType                                  code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0229   Administração e UserRoleAssignment           scopeId                                    Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0230   Administração e UserRoleAssignment           validFrom                                  dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0231   Administração e UserRoleAssignment           validUntil                                 dateTime                     0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0232   Administração e UserRoleAssignment           assignmentStatus                           code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0233   Administração e UserRoleAssignment           grantedBy                                  Reference(Actor)             1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0234   Administração e UserRoleAssignment           grantedAt                                  dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0235   Administração e UserRoleAssignment           revokedBy                                  Reference(Actor)             0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0236   Administração e UserRoleAssignment           revokedAt                                  dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0237   Administração e UserRoleAssignment           revocationReason                           string/code                  0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0238   Administração e AccessGrant                  accessGrantId                              uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0239   Administração e AccessGrant                  userAccountId                              Reference(UserAccount)       1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0240   Administração e AccessGrant                  resourceType                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0241   Administração e AccessGrant                  resourceId                                 Reference                    0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0242   Administração e AccessGrant                  reportTypeLegacy                           string                       0..1        Extensão      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                        local                            

  P1X-0243   Administração e AccessGrant                  permissionCodes                            code\[\]                     1..\*       Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0244   Administração e AccessGrant                  accessTypeLegacy                           integer code                 0..1        Extensão      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                        local                            

  P1X-0245   Administração e AccessGrant                  grantedBy                                  Reference(Actor)             1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0246   Administração e AccessGrant                  grantedAt                                  dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0247   Administração e AccessGrant                  expiresAt                                  dateTime                     0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0248   Administração e AccessGrant                  grantStatus                                code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0249   Administração e AccessGrant                  revokedAt                                  dateTime                     0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0250   Administração e AccessGrant                  revocationReason                           string/code                  0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0251   Administração e Session                      sessionId                                  uuid/string                  1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0252   Administração e Session                      userAccountId                              Reference(UserAccount)       1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0253   Administração e Session                      accessTokenHash                            secret/hash                  1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0254   Administração e Session                      refreshTokenHash                           secret/hash                  1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0255   Administração e Session                      userAgent                                  string                       0..1        Opcional      MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0256   Administração e Session                      ipAddress                                  string/IP                    0..1        Essencial     MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0257   Administração e Session                      deviceInfo                                 object                       0..1        Opcional      MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0258   Administração e Session                      lastActivityAt                             dateTime                     1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0259   Administração e Session                      sessionStartedAt                           dateTime                     1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0260   Administração e Session                      expiresAt                                  dateTime                     1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0261   Administração e Session                      refreshExpiresAt                           dateTime                     1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0262   Administração e Session                      inactivityTimeoutMs                        integer duration             1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0263   Administração e Session                      isActive                                   boolean                      1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0264   Administração e Session                      isRevoked                                  boolean                      1..1        Core          MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0265   Administração e Session                      revokedAt                                  dateTime                     0..1        Condicional   MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0266   Administração e Session                      revokedBy                                  Reference(Actor)             0..1        Condicional   MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0267   Administração e Session                      revocationReason                           string/code                  0..1        Condicional   MongoDB/Redis      Fase 1
             segurança                                                                                                                                                         

  P1X-0268   Administração e RecoveryCodeSet              recoveryCodeSetId                          uuid                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0269   Administração e RecoveryCodeSet              userAccountId                              Reference(UserAccount)       1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0270   Administração e RecoveryCodeSet              codeHashes                                 secret/hash\[\]              1..\*       Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0271   Administração e RecoveryCodeSet              remainingCount                             integer \>=0                 1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0272   Administração e RecoveryCodeSet              usedCodeHashes                             secret/hash\[\]              0..\*       Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0273   Administração e RecoveryCodeSet              generatedAt                                dateTime                     1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0274   Administração e RecoveryCodeSet              regeneratedAt                              dateTime                     0..1        Opcional      MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0275   Administração e RecoveryCodeSet              invalidatedAt                              dateTime                     0..1        Opcional      MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0276   Administração e SecurityConfiguration        securityConfigId                           uuid                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0277   Administração e SecurityConfiguration        environment                                code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0278   Administração e SecurityConfiguration        authentication.requireMFA                  boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0279   Administração e SecurityConfiguration        authentication.mfaMethod                   code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0280   Administração e SecurityConfiguration        authentication.allowPasswordReset          boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0281   Administração e SecurityConfiguration        authentication.maxLoginAttempts            integer                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0282   Administração e SecurityConfiguration        authentication.lockoutDurationMinutes      integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0283   Administração e SecurityConfiguration        authentication.requireStrongPassword       boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0284   Administração e SecurityConfiguration        passwordRules.minLength                    integer                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0285   Administração e SecurityConfiguration        passwordRules.requireUppercase             boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0286   Administração e SecurityConfiguration        passwordRules.requireLowercase             boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0287   Administração e SecurityConfiguration        passwordRules.requireNumbers               boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0288   Administração e SecurityConfiguration        passwordRules.requireSpecialChars          boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0289   Administração e SecurityConfiguration        passwordRules.expirationDays               integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0290   Administração e SecurityConfiguration        passwordRules.preventReuse                 boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0291   Administração e SecurityConfiguration        passwordRules.maxReuseHistory              integer                      0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0292   Administração e SecurityConfiguration        session.timeoutMinutes                     integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0293   Administração e SecurityConfiguration        session.maxSessionDurationHours            integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0294   Administração e SecurityConfiguration        session.allowMultipleSessions              boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0295   Administração e SecurityConfiguration        session.autoRenewal                        boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0296   Administração e SecurityConfiguration        session.logExpiration                      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0297   Administração e SecurityConfiguration        loginAttempts.maxAttempts                  integer                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0298   Administração e SecurityConfiguration        loginAttempts.lockoutDurationMinutes       integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0299   Administração e SecurityConfiguration        loginAttempts.trackIP                      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0300   Administração e SecurityConfiguration        loginAttempts.blockIPAfterAttempts         integer                      0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0301   Administração e SecurityConfiguration        logging.level                              code                         1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0302   Administração e SecurityConfiguration        logging.logLoginAttempts                   boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0303   Administração e SecurityConfiguration        logging.logAllActions                      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0304   Administração e SecurityConfiguration        logging.retentionDays                      integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0305   Administração e SecurityConfiguration        privacy.anonymizeLogs                      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0306   Administração e SecurityConfiguration        privacy.dataRetentionDays                  integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0307   Administração e SecurityConfiguration        privacy.autoPurge                          boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0308   Administração e SecurityConfiguration        privacy.purgeAfterDays                     integer duration             0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0309   Administração e SecurityConfiguration        privacy.anonymizeAfterDays                 integer duration             0..1        Condicional   MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0310   Administração e SecurityConfiguration        enhancedSecurity.enabled                   boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0311   Administração e SecurityConfiguration        enhancedSecurity.requireMFAForAll          boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0312   Administração e SecurityConfiguration        enhancedSecurity.strictPasswordPolicy      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0313   Administração e SecurityConfiguration        enhancedSecurity.sessionTimeoutMinutes     integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0314   Administração e SecurityConfiguration        enhancedSecurity.logAllActions             boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0315   Administração e SecurityConfiguration        enhancedSecurity.blockUnusualActivity      boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0316   Administração e SecurityConfiguration        lgpd.allowDataExport                       boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0317   Administração e SecurityConfiguration        lgpd.allowDataDeletion                     boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0318   Administração e SecurityConfiguration        lgpd.anonymizeOnExport                     boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0319   Administração e SecurityConfiguration        lgpd.requireConsent                        boolean                      1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0320   Administração e SecurityConfiguration        lgpd.consentExpirationDays                 integer duration             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0321   Administração e SecurityConfiguration        configVersion                              integer/string               1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0322   Administração e SecurityConfiguration        lastUpdatedAt                              dateTime                     1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0323   Administração e SecurityConfiguration        lastUpdatedBy                              Reference(Actor)             1..1        Core          MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0324   Administração e SecurityConfiguration        effectivePeriod                            Period                       0..1        Essencial     MongoDB            Fase 1
             segurança                                                                                                                                                         

  P1X-0325   Administração e AuditEvent                   actionCode                                 code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0326   Administração e AuditEvent                   resourceType                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0327   Administração e AuditEvent                   resourceId                                 Reference/id                 0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0328   Administração e AuditEvent                   actorAnonId                                string pseudonym             0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0329   Administração e AuditEvent                   actorRole                                  code                         0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0330   Administração e AuditEvent                   severity                                   code                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0331   Administração e AuditEvent                   source                                     code/string                  1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0332   Administração e AuditEvent                   sourceIp                                   string/IP                    0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0333   Administração e AuditEvent                   userAgent                                  string                       0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0334   Administração e AuditEvent                   requestMethod                              code                         0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0335   Administração e AuditEvent                   requestPath                                string                       0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0336   Administração e AuditEvent                   requestOrigin                              string                       0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0337   Administração e AuditEvent                   message                                    string                       0..1        Essencial     MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0338   Administração e AuditEvent                   payloadSummary                             object                       0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0339   Administração e AuditEvent                   errorStack                                 string                       0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0340   Administração e AuditEvent                   metadata                                   object                       0..1        Opcional      MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0341   Administração e AuditEvent                   auditHash                                  hash                         1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0342   Administração e AuditEvent                   merkleRootId                               Reference(MerkleRoot)        0..1        Condicional   MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0343   Administração e AuditEvent                   module                                     code/string                  1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0344   Administração e AuditEvent                   recordedAt                                 dateTime                     1..1        Core          MongoDB/Neo4j      Fase 1
             segurança                                                                                                                                                         

  P1X-0345   Metadados de    Collection                   inclusionCriteriaDescription               markdown                     0..1        Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  P1X-0346   Metadados de    Collection                   duoCodes                                   Coding\[\]                   0..\*       Condicional   MongoDB/Neo4j      Fase 1
             biobanco                                                                                                                                                          

  P1X-0347   Metadados de    Collection                   accessConditionsText                       markdown                     0..1        Condicional   MongoDB            Fase 1
             biobanco                                                                                                                                                          

  P1X-0348   Doador e        ParticipantIdentity          participantIdentityId                      uuid                         1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0349   Doador e        ParticipantIdentity          participantId                              Reference(Participant)       1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0350   Doador e        ParticipantIdentity          patientName                                string                       1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0351   Doador e        ParticipantIdentity          birthDate                                  date                         1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0352   Doador e        ParticipantIdentity          email                                      string                       0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0353   Doador e        ParticipantIdentity          phone                                      string                       0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0354   Doador e        ParticipantIdentity          identityDocumentCiphertext                 encrypted string             0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0355   Doador e        ParticipantIdentity          recordNumberCiphertext                     encrypted string             0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0356   Doador e        ParticipantIdentity          clinicalUnitId                             Reference(Organization)      0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0357   Doador e        ParticipantIdentity          representativeName                         string                       0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0358   Doador e        ParticipantIdentity          representativeEmail                        string                       0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0359   Doador e        ParticipantIdentity          representativeIdentityDocumentCiphertext   encrypted string             0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0360   Doador e        ParticipantIdentity          representativePhone                        string                       0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0361   Doador e        ParticipantIdentity          identityStatus                             code                         1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0362   Doador e        ParticipantIdentity          encryptionKeyVersion                       string                       1..1        Core          MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0363   Doador e        ParticipantIdentity          lastVerifiedAt                             dateTime                     0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0364   Doador e        ParticipantIdentity          verifiedBy                                 Reference(Actor)             0..1        Condicional   MongoDB protegido  Fase 1
             participante                                                                                                                                                      

  P1X-0365   Consentimento e ConsentTemplate              versionGroupId                             uuid                         1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  P1X-0366   Consentimento e ConsentTemplate              previousConsentTemplateId                  Reference(ConsentTemplate)   0..1        Condicional   MongoDB/Neo4j      Fase 1
             uso                                                                                                                                                               

  P1X-0367   Consentimento e ConsentTemplate              caae                                       string                       1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  P1X-0368   Consentimento e ConsentTemplate              permissionDefinitions                      BackboneElement\[\]          1..\*       Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  P1X-0369   Consentimento e ConsentTemplate              contentFormat                              code                         1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0370   Consentimento e ConsentTemplate              templateStatus                             code                         1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  P1X-0371   Consentimento e Consent                      permissionResponses                        object/BackboneElement\[\]   1..1        Core          MongoDB            Fase 1
             uso                                                                                                                                                               

  P1X-0372   Consentimento e Consent                      signerDisplayName                          string                       0..1        Condicional   MongoDB protegido  Fase 1
             uso                                                                                                                                                               

  P1X-0373   Consentimento e Consent                      evidenceMimeType                           code                         1..1        Core          MongoDB/Object     Fase 1
             uso                                                                                                                                            Storage            

  P1X-0374   Consentimento e Consent                      sourceIp                                   string/IP                    0..1        Opcional      MongoDB protegido  Fase 1
             uso                                                                                                                                                               

  P1X-0375   Consentimento e Consent                      userAgent                                  string                       0..1        Opcional      MongoDB protegido  Fase 1
             uso                                                                                                                                                               

  P1X-0376   Governança      GraphProjectionOutboxEvent   eventId                                    uuid                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0377   Governança      GraphProjectionOutboxEvent   eventType                                  code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0378   Governança      GraphProjectionOutboxEvent   aggregateType                              code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0379   Governança      GraphProjectionOutboxEvent   aggregateId                                string/uuid                  1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0380   Governança      GraphProjectionOutboxEvent   payload                                    object                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0381   Governança      GraphProjectionOutboxEvent   payloadHash                                hash                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0382   Governança      GraphProjectionOutboxEvent   schemaVersion                              integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0383   Governança      GraphProjectionOutboxEvent   occurredAt                                 dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0384   Governança      GraphProjectionOutboxEvent   status                                     code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0385   Governança      GraphProjectionOutboxEvent   attempts                                   integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0386   Governança      GraphProjectionOutboxEvent   lastError                                  string                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0387   Governança      GraphProjectionOutboxEvent   projectedAt                                dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0388   Governança      GraphProjectionOutboxEvent   processedAt                                dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0389   Governança      GraphProjectionOutboxEvent   leaseUntil                                 dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0390   Governança      GraphProjectionOutboxEvent   sourceService                              string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0391   Governança      GraphProjectionOutboxEvent   traceId                                    string                       0..1        Opcional      MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0392   Governança      GraphProjectionOutboxEvent   projectionState                            object                       0..1        Opcional      MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0393   Governança      GraphProjectionOutboxEvent   createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0394   Governança      GraphProjectionOutboxEvent   updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0395   Governança      FoundationDataRun            foundationDataRunId                        uuid                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0396   Governança      FoundationDataRun            pipelineVersion                            string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0397   Governança      FoundationDataRun            schemaVersion                              string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0398   Governança      FoundationDataRun            dictionaryVersion                          string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0399   Governança      FoundationDataRun            environment                                code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0400   Governança      FoundationDataRun            deploymentId                               string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0401   Governança      FoundationDataRun            startedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0402   Governança      FoundationDataRun            completedAt                                dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0403   Governança      FoundationDataRun            runStatus                                  code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0404   Governança      FoundationDataRun            executionMode                              code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0405   Governança      FoundationDataRun            configurationChecksum                      string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0406   Governança      FoundationDataRun            dictionaryChecksum                         string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0407   Governança      FoundationDataRun            steps                                      array\<object\>              1..\*       Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0408   Governança      FoundationDataRun            validationSummary                          object                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0409   Governança      FoundationDataRun            errorSummary                               object                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0410   Governança      FoundationDataRun            initiatedBy                                Reference                    1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0411   Governança      FoundationDataRun            previousRunId                              Reference                    0..1        Opcional      MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0412   Governança      FoundationDataRun            createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0413   Governança      FoundationDataRun            updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0414   Governança      ReferenceDatasetRelease      referenceDatasetReleaseId                  uuid                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0415   Governança      ReferenceDatasetRelease      sourceId                                   code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0416   Governança      ReferenceDatasetRelease      datasetCode                                code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0417   Governança      ReferenceDatasetRelease      datasetName                                string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0418   Governança      ReferenceDatasetRelease      systemUri                                  uri                          1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0419   Governança      ReferenceDatasetRelease      datasetVersion                             string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0420   Governança      ReferenceDatasetRelease      releaseDate                                date                         0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0421   Governança      ReferenceDatasetRelease      retrievalUri                               uri                          1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0422   Governança      ReferenceDatasetRelease      retrievedAt                                dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0423   Governança      ReferenceDatasetRelease      accessMethod                               code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0424   Governança      ReferenceDatasetRelease      sourceFormat                               array\<code\>                1..\*       Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0425   Governança      ReferenceDatasetRelease      license                                    string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0426   Governança      ReferenceDatasetRelease      licenseUri                                 uri                          0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0427   Governança      ReferenceDatasetRelease      sourceChecksum                             string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0428   Governança      ReferenceDatasetRelease      fileSize                                   integer                      0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0429   Governança      ReferenceDatasetRelease      parserVersion                              string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0430   Governança      ReferenceDatasetRelease      mappingVersion                             string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0431   Governança      ReferenceDatasetRelease      releaseStatus                              code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0432   Governança      ReferenceDatasetRelease      previousReleaseId                          Reference                    0..1        Opcional      MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0433   Governança      ReferenceDatasetRelease      createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0434   Governança      ReferenceDatasetRelease      updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0435   Governança      ReferenceImportRun           referenceImportRunId                       uuid                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0436   Governança      ReferenceImportRun           referenceDatasetReleaseId                  Reference                    1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0437   Governança      ReferenceImportRun           foundationDataRunId                        Reference                    0..1        Opcional      MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0438   Governança      ReferenceImportRun           datasetCode                                code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0439   Governança      ReferenceImportRun           importMode                                 code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0440   Governança      ReferenceImportRun           idempotencyKey                             string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0441   Governança      ReferenceImportRun           startedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0442   Governança      ReferenceImportRun           completedAt                                dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0443   Governança      ReferenceImportRun           runStatus                                  code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0444   Governança      ReferenceImportRun           checkpoint                                 object                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0445   Governança      ReferenceImportRun           batchSize                                  integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0446   Governança      ReferenceImportRun           recordsRead                                integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0447   Governança      ReferenceImportRun           recordsValidated                           integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0448   Governança      ReferenceImportRun           recordsInserted                            integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0449   Governança      ReferenceImportRun           recordsUpdated                             integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0450   Governança      ReferenceImportRun           recordsSkipped                             integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0451   Governança      ReferenceImportRun           recordsRejected                            integer                      1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0452   Governança      ReferenceImportRun           inputChecksum                              string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0453   Governança      ReferenceImportRun           validationSummary                          object                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0454   Governança      ReferenceImportRun           errorReportUri                             uri                          0..1        Condicional   MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0455   Governança      ReferenceImportRun           initiatedBy                                Reference                    1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0456   Governança      ReferenceImportRun           createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0457   Governança      ReferenceImportRun           updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0458   Governança      ReferenceImportIssue         referenceImportIssueId                     uuid                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0459   Governança      ReferenceImportIssue         referenceImportRunId                       Reference                    1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0460   Governança      ReferenceImportIssue         referenceDatasetReleaseId                  Reference                    1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0461   Governança      ReferenceImportIssue         sourceRecordId                             string                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0462   Governança      ReferenceImportIssue         rowNumber                                  integer                      0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0463   Governança      ReferenceImportIssue         entityType                                 code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0464   Governança      ReferenceImportIssue         fieldPath                                  string                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0465   Governança      ReferenceImportIssue         rawValue                                   object                       0..1        Condicional   MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0466   Governança      ReferenceImportIssue         errorCode                                  code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0467   Governança      ReferenceImportIssue         errorMessage                               string                       1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0468   Governança      ReferenceImportIssue         severity                                   code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0469   Governança      ReferenceImportIssue         resolutionStatus                           code                         1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0470   Governança      ReferenceImportIssue         quarantinePayloadUri                       uri                          0..1        Condicional   MongoDB/Object     Fase 1
             transversal                                                                                                                                    Storage            

  P1X-0471   Governança      ReferenceImportIssue         detectedAt                                 dateTime                     1..1        Core          MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0472   Governança      ReferenceImportIssue         resolvedAt                                 dateTime                     0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0473   Governança      ReferenceImportIssue         resolvedBy                                 Reference                    0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0474   Governança      ReferenceImportIssue         resolutionNotes                            string                       0..1        Condicional   MongoDB            Fase 1
             transversal                                                                                                                                                       

  P1X-0475   Dados de        TerminologyConcept           terminologyConceptId                       uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0476   Dados de        TerminologyConcept           systemUri                                  uri                          1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0477   Dados de        TerminologyConcept           code                                       code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0478   Dados de        TerminologyConcept           version                                    string                       1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0479   Dados de        TerminologyConcept           display                                    string                       1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0480   Dados de        TerminologyConcept           language                                   code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0481   Dados de        TerminologyConcept           definition                                 string                       0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0482   Dados de        TerminologyConcept           synonyms                                   array\<object\>              0..\*       Opcional      MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0483   Dados de        TerminologyConcept           conceptStatus                              code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0484   Dados de        TerminologyConcept           semanticType                               array\<code\>                0..\*       Opcional      MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0485   Dados de        TerminologyConcept           properties                                 object                       0..1        Opcional      MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0486   Dados de        TerminologyConcept           validFrom                                  date                         0..1        Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0487   Dados de        TerminologyConcept           validTo                                    date                         0..1        Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0488   Dados de        TerminologyConcept           replacementCode                            code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0489   Dados de        TerminologyConcept           sourceRecordId                             string                       1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0490   Dados de        TerminologyConcept           referenceDatasetReleaseId                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0491   Dados de        TerminologyConcept           createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0492   Dados de        TerminologyConcept           updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0493   Dados de        TerminologyRelation          terminologyRelationId                      uuid                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0494   Dados de        TerminologyRelation          sourceConceptId                            Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0495   Dados de        TerminologyRelation          targetConceptId                            Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0496   Dados de        TerminologyRelation          relationType                               code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0497   Dados de        TerminologyRelation          relationSystem                             uri                          0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0498   Dados de        TerminologyRelation          relationVersion                            string                       1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0499   Dados de        TerminologyRelation          relationStatus                             code                         1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0500   Dados de        TerminologyRelation          evidenceLevel                              code                         0..1        Condicional   MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0501   Dados de        TerminologyRelation          evidenceReferences                         array\<Reference\>           0..\*       Opcional      MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0502   Dados de        TerminologyRelation          relationProperties                         object                       0..1        Opcional      MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0503   Dados de        TerminologyRelation          referenceDatasetReleaseId                  Reference                    1..1        Core          MongoDB/Neo4j      Fase 1
             referência                                                                                                                                                        

  P1X-0504   Dados de        TerminologyRelation          sourceRecordId                             string                       0..1        Condicional   MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0505   Dados de        TerminologyRelation          createdAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        

  P1X-0506   Dados de        TerminologyRelation          updatedAt                                  dateTime                     1..1        Core          MongoDB            Fase 1
             referência                                                                                                                                                        
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Apêndice B - Resumo de cobertura por entidade

O resumo confirma 79 entidades canônicas e 929 variáveis preparadas na
Fase 1. As seis entidades técnicas do control plane de bootstrap e
importação já estão incorporadas ao dicionário v1.3.0.

<table>
<colgroup>
<col style="width: 34%" />
<col style="width: 10%" />
<col style="width: 54%" />
</colgroup>
<thead>
<tr>
<th><strong>Entidade</strong></th>
<th><strong>Variáveis</strong></th>
<th><strong>Fase vigente</strong></th>
</tr>
</thead>
<tbody>
<tr>
<td>SecurityConfiguration</td>
<td>49</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Consent</td>
<td>31</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Specimen</td>
<td>31</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Collection</td>
<td>30</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>AuditEvent</td>
<td>27</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>UserAccount</td>
<td>27</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>BaseRecord</td>
<td>23</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ReferenceImportRun</td>
<td>23</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ResearchResource</td>
<td>23</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ReferenceDatasetRelease</td>
<td>21</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>RCSAssessment</td>
<td>20</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>FoundationDataRun</td>
<td>19</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>GraphProjectionOutboxEvent</td>
<td>19</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>TerminologyConcept</td>
<td>18</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ParticipantIdentity</td>
<td>17</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ReferenceImportIssue</td>
<td>17</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Session</td>
<td>17</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>SpecimenPreanalytics</td>
<td>17</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ClinicalObservation</td>
<td>16</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Biobank</td>
<td>15</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>CustodyEvent</td>
<td>15</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Study</td>
<td>15</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ConsentTemplate</td>
<td>14</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>StorageAssignment</td>
<td>14</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>TerminologyRelation</td>
<td>14</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>AccessGrant</td>
<td>13</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>UserRoleAssignment</td>
<td>13</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Assay</td>
<td>12</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Network</td>
<td>12</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Participant</td>
<td>12</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Shipment</td>
<td>12</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>BiomarkerAssociation</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Condition</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ContactInformation</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Device</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>EnvironmentalExcursion</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Nonconformance</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>PhenotypeObservation</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>WorkflowRun</td>
<td>11</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>DataFile</td>
<td>10</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>DiseaseConcept</td>
<td>9</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>MedicationExposure</td>
<td>9</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>TelemetryReading</td>
<td>9</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>AccessPolicy</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>AccessRequest</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Dataset</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Organization</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Permission</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Protocol</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>RecoveryCodeSet</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Role</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ThresholdProfile</td>
<td>8</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Actor</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>DiagnosticReport</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>NetworkMembership</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>QuarantineAction</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ReagentLot</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>RetentionPolicy</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>StorageLocation</td>
<td>7</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Encounter</td>
<td>6</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>GeneConcept</td>
<td>6</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>MerkleRoot</td>
<td>6</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>OmicsQualification</td>
<td>6</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ProcessingBatch</td>
<td>6</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>DerivedScore</td>
<td>5</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>DispositionAction</td>
<td>5</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ResearchResourceBiobank</td>
<td>5</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ResearchResourceCollection</td>
<td>5</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>GenomicsRun</td>
<td>4</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>Procedure</td>
<td>4</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>AllergyIntolerance</td>
<td>3</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ClinicalOutcome</td>
<td>3</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>FamilyHistory</td>
<td>3</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ImagingDerivedData</td>
<td>2</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ImagingStudy</td>
<td>2</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>MicrobiomeRun</td>
<td>2</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>ProteomicsRun</td>
<td>2</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>MetabolomicsRun</td>
<td>1</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td>TranscriptomicsRun</td>
<td>1</td>
<td>Fase 1 - Foundation</td>
</tr>
<tr>
<td colspan="3">Validação final da matriz<br />
Total de linhas: 929. IDs únicos: 929. Entidades únicas: 79. Domínios:
26. Todos os registros estão classificados como Fase 1 no dicionário
consolidado v1.3.0.</td>
</tr>
</tbody>
</table>
