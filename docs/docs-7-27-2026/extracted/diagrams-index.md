# Diagramas (WhatsApp, 2026-07-27) — transcrição textual

Os 5 arquivos `WhatsApp Image 2026-07-27 at *.jpeg` são diagramas de
arquitetura/casos de uso (C4 + UML use case), não screenshots do
aplicativo. Transcrição textual abaixo para navegação por IA sem reabrir
as imagens; consultar o arquivo original apenas se precisar do layout
visual.

> **Cuidado — numeração de RF nos diagramas está ~1 versão atrás do
> documento de requisitos v3.0.0.** Comparando o conteúdo de cada bolha
> com `extracted/requisitos-index.md`, a regra empírica (verificada
> bolha a bolha nas 3 imagens de caso de uso) é: **diagrama RF(n) =
> doc v3.0.0 RF(n) para n ≤ 13; diagrama RF(n) = doc v3.0.0 RF(n-1)
> para n ≥ 15** (nenhuma bolha usa "RF014"; o doc não tem "RF030").
> Isso é esperado, não é erro de leitura: o próprio Plano Integrado
> (seção 4, "Autoridade documental") classifica o Lucidchart como
> artefato derivado, abaixo do documento de requisitos na hierarquia de
> autoridade, e a seção 13 ("Governança de mudanças") só manda
> atualizar o Lucidchart depois do dicionário/changelog — ou seja, os
> diagramas ficam uma revisão atrás por design. **Ao montar a matriz de
> rastreabilidade RF → teste e2e, usar sempre o ID do
> `requisitos-index.md` (autoritativo); os diagramas servem só para a
> estrutura de agrupamento/atores/`«include»`, não para o rótulo do ID.**
> As seções abaixo já foram reescritas com os IDs corrigidos (doc
> v3.0.0), não os rótulos originais do diagrama.

## 11.24.25 — C4 System Context (PT)

Ator/sistema central: **BioAvanceD [Software System]** — "Gestão,
governança e rastreabilidade de biobancos"; escopo atual: eConsent,
amostras e dados científicos.

Atores humanos → BioAvanceD:
- Participante — gerencia seu consentimento ("Atualiza consentimento")
- Equipe do Biobanco (Técnico + Coordenador) — opera participantes,
  amostras e qualidade
- Administrador — administra acessos e configurações
- Pesquisador Externo — consulta dados autorizados

Sistemas externos ↔ BioAvanceD:
- Sistemas Clínicos [EHR, FHIR, institucional] — integra recursos
  clínicos via HL7 FHIR R4
- Sistemas Laboratoriais [LIMS, ELN] — integra dados laboratoriais
- Sensores IoT — envia telemetria via MQTT
- Terminologias — fornece releases versionadas
- Provedor de Identidade — autentica usuários via OIDC/OAuth2
- Repositórios Científicos — recebe dados publicados/autorizados
- Notificações — entrega mensagens e alertas

## 11.24.26 — C4 Container (EN)

Central container: **BioAvanceD [eConsent · FHIR Boundary · Event
Processing]**.

- Participant → submits/updates consent [HTTPS/JSON]
- Clinical & Lab Systems (EHR/LIMS/ELN) → integrates data [FHIR/API]
- IoT Sensors (freezers & cold chain) → streams telemetry [MQTT]
- BioAvanceD → persists canonical documents and outbox → **MongoDB**
  [Canonical Documents & Outbox]
- MongoDB → publishes pending projection event → **Outbox Worker**
  [Container] → consumes GraphProjectionOutboxEvent → projects nodes
  and relationships → **Neo4j** [Derived Graph Projection]
- BioAvanceD → queries derived lineage [read-only] → Neo4j
- BioAvanceD → provides authorized data [HTTPS/API] → Authorized
  Researcher [Data Consumer]
- BioAvanceD → stores telemetry and files; maintains transient state →
  **Specialized Data Services** [InfluxDB · Object Storage · Redis]

> **Security boundary** (called out explicitly on the diagram):
> ParticipantIdentity remains protected and is never projected to
> Neo4j. — matches RF005/RNF007/RF023 in the requirements doc and gate
> F1-G05 in the Foundation Data Pipeline plan.

This is the diagram to check against any e2e test that touches
consent → outbox → Neo4j projection: the flow is always
**Mongo (canonical) → outbox event → Outbox Worker → Neo4j
(derived)**, never a direct write to Neo4j.

## 11.24.34 — UML Use Case, top-level groupings (PT)

Actors: Pesquisador Externo, Coordenador, Administrador, Sistema/DevOps
(top); Repositório Científico, Sistemas Clínicos e Laboratoriais,
Sensores IoT, Serviço de Notificações, Fontes de Referência e
Terminologias (bottom, external).

Groups (use-case package boxes) and their RF members (IDs corrected to
doc v3.0.0 — see caveat above):
- **Pipelines, continuidade e proteções**: RF022 (Executar Foundation
  Data Pipeline one-shot) «includes» validar cobertura 929/929, 79
  entidades e proveniência da Fase 1; RF029 (Ingerir dados
  operacionais/clínicos/laboratoriais/ômicos) «includes» RF023
  (Projetar relações no Neo4j exclusivamente pelo outbox), RF028
  (Importar/validar/promover/reverter dados de referência), RF013
  (Executar backup/restauração/teste controlado).
- **Interoperabilidade e monitoramento**: RF011 (Importar/exportar
  recursos HL7 FHIR R4) «includes» validar contratos canônicos,
  cardinalidades e referências ativas; RF015 (Gerar alertas e
  notificações multicanal) «extends» RF009 (Coletar telemetria,
  detectar falhas e excursões ambientais).
- **Dados científicos e acesso**: RF027 (Gerenciar datasets, workflows,
  proveniência e dados ômicos) «includes» RF007 (Receber, validar e
  armazenar arquivos científicos); RF024 (Solicitar, avaliar e
  distribuir dados autorizados) «includes» validar consentimento,
  finalidade, papel e AccessPolicy; RF008 (Gerar relatórios e
  exportações controladas) «includes» the same consent/policy check.
- **Central node (all groups include it)**: **RF012 — Registrar
  AuditEvent, proveniência e verificar integridade criptográfica.**

## 11.24.34a — UML Use Case, "Participante/consentimento/estudos" + "Acesso e segurança" (PT)

Actors: Participante, Técnico, Coordenador, Administrador (left);
Provedor de Identidade (right, external).

- **Participante, consentimento e estudos**: RF004 (Executar cadastro
  integrado de participante/estudo/consentimento/espécime), RF005
  (Gerenciar participante e identidade direta protegida), RF010
  (Gerenciar ConsentTemplate/Consent/versões/evidências/revogação),
  RF020 (Gerenciar organização/rede/biobanco/coleção — "Metadados
  institucionais e MIABIS" no doc), RF021 (Gerenciar
  estudos/protocolos/ética/vínculos institucionais).
- **Acesso e segurança**: RF002 (Visualizar dashboard/menus/ações
  autorizadas) «includes» RF001 (Autenticar usuário, aplicar RBAC/MFA,
  emitir sessão); RF003 (Gerenciar usuários/papéis/permissões/MFA/
  sessões); RF014 (Gerenciar políticas de segurança/privacidade/
  retenção).
- **Controles incluídos (shared, dotted box)**: "Validar consentimento,
  finalidade e vigência" and **RF012** (AuditEvent + integridade
  criptográfica) — both `«include»`d by nearly every use case in this
  diagram.

## 11.24.35 — UML Use Case, "Espécime/qualidade/inventário" (PT)

Actors: Técnico, Coordenador, Sistema de Regras.

- **Espécime e identificação**: RF004 (Registrar espécime, derivações
  e dados pré-analíticos), RF016 (Gerar/imprimir etiquetas unitárias ou
  em lote — "Etiquetagem" no doc), RF017 (Gerenciar equipamentos,
  sensores e topologia de armazenamento).
- **Qualidade e governança do espécime**: RF018 (Registrar SPREC e
  calcular RCSAssessment versionado); RF019 (Aplicar/revisar/liberar
  quarentena lógica) `«extend»`s RF018; RF025 (Gerenciar ensaios,
  reagentes e não conformidades) `«include»`s RF018.
- **Inventário, custódia e destinação**: RF006 (Registrar
  movimentações, quantidade e cadeia de custódia imutável), RF026
  (Aplicar retenção, legal hold e destinação controlada) — this box
  `«extend»`s the quality/governance box.
- **Controles incluídos (shared)**: "Validar consentimento, finalidade
  e vínculo com o estudo"; "Validar estado, localização e quarentena
  do espécime"; **RF012** (AuditEvent).

## Why this matters for the e2e milestone

Across all three use-case diagrams (34, 34a, 35), almost every RF
`«include»`s **RF012** (audit event + crypto integrity) and a
consent/state/quarantine validation use case. That is a strong signal,
straight from the diagrams, that **every e2e test built from an RF
should assert the audit-trail side effect, not just the primary
outcome** — a spec that only checks "specimen was created" without
also checking "an AuditEvent was appended" is only testing half of what
the diagram says the use case does. See the milestone plan in
`../../E2E_TRACEABILITY_PLAN.md` for how this translates into the
traceability matrix's "audit assertion" column.
