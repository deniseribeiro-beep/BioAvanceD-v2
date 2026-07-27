# Requisitos Funcionais e Não Funcionais — BioAvanceD v3.0.0 (2026-07-22)

Extraído de `1 - Requisitos Funcionais e Não Funcionais.docx` para navegação barata por IA/grep. Fonte normativa: `BioAvanceD_Dicionario_Dados_Consolidado_v1.3.0_padronizado.xlsx`. Substitui os Apêndices B e C v2.0.

Ver também: `1-Requisitos-Funcionais-e-Nao-Funcionais.md` (conversão pandoc completa, inclui seções de governança/fases fora do escopo deste índice) e `DENISE_VALIDATION_STATUS.md` (status de validação item a item).

## Apêndice B — Requisitos Funcionais (RF)

### RF001 — Segurança e autenticação

**Requisito:** O sistema deve autenticar usuários por credenciais protegidas por hash seguro, RBAC, aplicar autenticação multifator conforme a política de segurança e emitir sessões autenticadas, expiráveis e revogáveis.

**Ator primário:** Usuário autenticável  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Rejeitar o acesso quando a senha ou o fator adicional forem inválidos.
- 2. Bloquear temporariamente a conta após o limite configurado de tentativas malsucedidas.
- 3. Criar sessão com prazo de expiração e papéis associados.
- 4. Invalidar a sessão após logout, inativação da conta ou revogação administrativa.
- 5. Registrar tentativas e decisões de autenticação em AuditEvent.

### RF002 — Dashboard e autorização

**Requisito:** O sistema deve apresentar dashboards, menus, indicadores e ações conforme as permissões efetivas e o escopo de acesso do usuário autenticado.

**Ator primário:** Usuário autenticado  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. O Técnico visualiza operações autorizadas de cadastro, custódia e armazenamento.
- 2. O Coordenador visualiza indicadores operacionais, alertas e relatórios de governança.
- 3. O Administrador visualiza segurança, usuários, auditoria e configurações.
- 4. O Usuário Externo visualiza somente dados e relatórios previamente autorizados.
- 5. O backend valida a permissão independentemente da ocultação da função no frontend.

### RF003 — Gestão de usuários

**Requisito:** O sistema deve permitir ao Administrador gerenciar o ciclo de vida de contas de usuário, seus papéis, permissões, escopos, credenciais, MFA e sessões.

**Ator primário:** Administrador  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Validar unicidade de e-mail e username.
- 2. Aplicar a política de complexidade e histórico de senhas.
- 3. Atribuir papel com vigência e escopo institucional.
- 4. Inativar a conta sem excluir o histórico.
- 5. Revogar sessões e permitir redefinição controlada do MFA.
- 6. Auditar criação, edição, bloqueio, inativação e alterações de papel.

### RF004 — Cadastro integrado do biobanco

**Requisito:** O sistema deve disponibilizar um fluxo integrado para registro de participantes, estudos, consentimentos e espécimes, aplicando validações de consistência, regras pré-analíticas e bloqueios operacionais versionados.

**Ator primário:** Técnico  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Impedir o cadastro de espécime sem participantId válido.
- 2. Gerar specimenId único e imutável.
- 3. Exigir vínculo com estudo, protocolo e coleção quando aplicável.
- 4. Validar tipo de material, origem, método de coleta e processamento.
- 5. Registrar variáveis SPREC aplicáveis.
- 6. Bloquear operações incompatíveis com consentimento, protocolo ou estado da amostra.

### RF005 — Participante e dados clínicos

**Requisito:** O sistema deve registrar o participante de forma pseudonimizada, manter a identidade civil em fronteira protegida e associar dados clínicos, diagnósticos e fenotípicos estruturados por terminologias versionadas.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 contrato / F2 referências / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Gerar participantId único.
- 2. Armazenar dados civis diretos somente em ParticipantIdentity.
- 3. Impedir a projeção de identificadores civis para o Neo4j.
- 4. Permitir codificação por HPO, ORPHA, CID, MONDO ou OMIM, somente quando houver ReferenceDatasetRelease ativa e validada para o sistema e a versão adotados.
- 5. Preservar código, sistema, versão e descrição da terminologia utilizada.
- 6. Permitir texto narrativo apenas nos campos destinados a observações complementares.

### RF006 — Rastreabilidade e cadeia de custódia

**Requisito:** O sistema deve registrar a cadeia de custódia, movimentações, retiradas, devoluções e consumo de quantidade de cada espécime por eventos imutáveis.

**Ator primário:** Técnico  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Registrar origem, destino, responsável, data, finalidade e quantidade.
- 2. Alterar o estado para PARTIAL quando houver quantidade remanescente.
- 3. Alterar o estado para DEPLETED quando a quantidade disponível for zero.
- 4. Bloquear movimentação de espécime UNAVAILABLE, DESTROYED, DISPOSED ou QUARANTINED.
- 5. Impedir alteração ou exclusão de eventos de custódia.
- 6. Atualizar a quantidade disponível por transação controlada.

### RF007 — Arquivos científicos e dados brutos

**Requisito:** O sistema deve receber, validar e armazenar arquivos científicos vinculados a espécimes, ensaios, estudos ou datasets, mantendo metadados de integridade, acesso e proveniência.

**Ator primário:** Pesquisador  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Validar os formatos permitidos pela política de upload.
- 2. Aplicar limite de tamanho configurável.
- 3. Calcular checksum do arquivo.
- 4. Armazenar o conteúdo em Object Storage.
- 5. Registrar URI, formato, tamanho, criptografia e restrições de acesso.
- 6. Vincular o arquivo a specimenId, assayId, studyId ou datasetId.
- 7. Auditar upload, acesso, substituição e remoção lógica.

### RF008 — Relatórios

**Requisito:** O sistema deve gerar relatórios operacionais, gerenciais, científicos e de auditoria conforme as permissões do usuário, com filtros dinâmicos e exportações controladas.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 base / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Aplicar filtros por período, coleção, tipo, origem, estado e localização.
- 2. Restringir os dados conforme AccessPolicy, papel e consentimento.
- 3. Pseudonimizar ou omitir dados identificadores quando necessário.
- 4. Exportar somente nos formatos habilitados.
- 5. Registrar o evento de exportação.
- 6. Permitir a criação de novos modelos de relatório sem depender de uma lista fixa.

### RF009 — Telemetria e monitoramento ambiental

**Requisito:** O sistema deve coletar, validar e persistir telemetria de sensores ambientais, identificar falhas e excursões e gerar eventos operacionais associados aos equipamentos e locais afetados.

**Ator primário:** Sistema  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Coletar leituras em intervalo configurável.
- 2. Persistir séries temporais no InfluxDB.
- 3. Vincular cada leitura ao Device e ao local de armazenamento.
- 4. Detectar leituras ausentes, inválidas ou fora da faixa.
- 5. Criar EnvironmentalExcursion quando aplicável.
- 6. Acionar alerta e avaliação de quarentena.
- 7. Preservar a leitura original e a regra utilizada na decisão.

### RF010 — Consentimento eletrônico e dinâmico

**Requisito:** O sistema deve gerenciar modelos versionados de consentimento e instâncias individuais de consentimento, permitindo manifestação granular, atualização e revogação rastreáveis por finalidade.

**Ator primário:** Participante  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Versionar ConsentTemplate sem sobrescrever versões anteriores.
- 2. Registrar cada manifestação como Consent identificado por consentId.
- 3. Vincular as respostas à versão exata do termo.
- 4. Registrar data, evidência, hash, origem e signatário.
- 5. Preservar o histórico de concessão, atualização e revogação.
- 6. Bloquear uso incompatível com a decisão vigente.
- 7. Emitir evento canônico para o outbox.
- 8. Aplicar quarentena quando houver revogação relevante.

### RF011 — Interoperabilidade HL7 FHIR R4

**Requisito:** O sistema deve importar e exportar dados por recursos HL7 FHIR R4, convertendo-os entre o modelo canônico do BioAvanceD e representações de interoperabilidade sem persistir recursos FHIR como coleções operacionais.

**Ator primário:** Sistema  
**Aplicação/status:** F1 contrato / F3 integração / Escopo atual

**Critérios de aceitação:**
- 1. Validar estrutura, perfil e campos obrigatórios do recurso.
- 2. Mapear Participant para FHIR Patient.
- 3. Mapear Specimen, Consent, Observation, DiagnosticReport e demais recursos aplicáveis.
- 4. Rejeitar campos não canônicos ou recursos inválidos.
- 5. Registrar origem, versão e proveniência.
- 6. Utilizar staging e quarentena para importações que exijam revisão.
- 7. Garantir que a conversão FHIR não produza escrita direta no MongoDB ou no Neo4j.

### RF012 — Auditoria e integridade criptográfica

**Requisito:** O sistema deve registrar eventos de auditoria append-only e aplicar mecanismos criptográficos de verificação de integridade, incluindo encadeamento de registros e consolidação periódica por raiz Merkle.

**Ator primário:** Sistema  
**Aplicação/status:** F1 em diante / Escopo atual

**Critérios de aceitação:**
- 1. Registrar ator, ação, recurso, data, IP, resultado e correlação.
- 2. Calcular o hash canônico de cada evento.
- 3. Vincular o evento ao hash anterior quando utilizado encadeamento sequencial.
- 4. Consolidar lotes de eventos em raiz Merkle verificável.
- 5. Impedir alteração ou exclusão dos eventos pela aplicação.
- 6. Detectar divergência ou adulteração.
- 7. Sanitizar payloads e evitar dados sensíveis desnecessários.

### RF013 — Backup e restauração

**Requisito:** O sistema deve permitir ao Administrador configurar, executar, acompanhar e validar rotinas de backup e restauração.

**Ator primário:** Administrador  
**Aplicação/status:** Transversal / Escopo atual

**Critérios de aceitação:**
- 1. Exibir estado, data e resultado das execuções.
- 2. Permitir execução manual autorizada.
- 3. Registrar checksum e evidência de conclusão.
- 4. Permitir teste controlado de restauração.
- 5. Auditar alterações da política de backup.
- 6. Aplicar frequência, retenção, criptografia, RPO e RTO definidos nos requisitos não funcionais.

### RF014 — Políticas de segurança

**Requisito:** O sistema deve permitir ao Administrador gerenciar políticas globais de autenticação, senha, MFA, sessão, acesso, auditoria, privacidade e retenção.

**Ator primário:** Administrador  
**Aplicação/status:** F1 em diante / Escopo atual

**Critérios de aceitação:**
- 1. Configurar timeout e duração máxima da sessão.
- 2. Configurar tentativas, bloqueios e regras de senha.
- 3. Definir obrigatoriedade de MFA.
- 4. Forçar redefinição de senha.
- 5. Versionar alterações de política.
- 6. Validar limites mínimos de segurança.
- 7. Registrar a alteração como AuditEvent crítico.
- 8. Revogar sessões quando a alteração exigir.

### RF015 — Alertas e notificações

**Requisito:** O sistema deve gerar notificações multicanal a partir de eventos críticos de segurança, telemetria, consentimento, qualidade e governança.

**Ator primário:** Sistema  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Criar notificação a partir de regra versionada.
- 2. Enviar pelos canais habilitados.
- 3. Registrar tentativas, falhas, entrega e confirmação.
- 4. Aplicar escalonamento quando necessário.
- 5. Não incluir dados sensíveis desnecessários.
- 6. Vincular a notificação ao evento que a originou.
- 7. Aplicar tempos máximos de entrega definidos nos requisitos não funcionais.

### RF016 — Etiquetagem

**Requisito:** O sistema deve gerar e imprimir etiquetas unitárias ou em lote vinculadas ao identificador canônico do espécime.

**Ator primário:** Técnico  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Utilizar specimenId e barcode únicos.
- 2. Suportar Code 128, DataMatrix ou QR conforme configuração.
- 3. Validar o layout da impressora.
- 4. Gerar lote após cadastro ou importação autorizada.
- 5. Impedir reutilização de identificadores.
- 6. Auditar geração e reimpressão.

### RF017 — Equipamentos e armazenamento

**Requisito:** O sistema deve gerenciar equipamentos, dispositivos, sensores e a topologia física de armazenamento dos espécimes.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Representar Freezer > Prateleira > Rack > Caixa > Posição.
- 2. Impedir ocupação duplicada de uma posição.
- 3. Vincular StorageAssignment ao espécime.
- 4. Vincular sensor ou dispositivo ao equipamento.
- 5. Registrar instalação, movimentação e retirada.
- 6. Preservar o histórico das localizações.
- 7. Bloquear local indisponível, interditado ou fora de condição.

### RF018 — Qualidade de biospecímenes - SPREC e RCS

**Requisito:** O sistema deve registrar todas as variáveis pré-analíticas SPREC incorporadas ao dicionário consolidado vigente e calcular uma avaliação RCS versionada para qualificação operacional do espécime, sem utilizar recortes reduzidos como modelo-alvo.

**Ator primário:** Sistema  
**Aplicação/status:** F1 modelo / F2 referências / F3 cálculo / Escopo atual

**Critérios de aceitação:**
- 1. Validar códigos, eixos, campos e versão SPREC de acordo com o dicionário consolidado vigente.
- 2. Calcular penalidades pelos eixos aplicáveis.
- 3. Registrar biologicalPenalty, rcsScore, grau e rota de decisão.
- 4. Aplicar as faixas A, B, C, D e E da versão vigente.
- 5. Forçar grau E em falha de governança não compensável.
- 6. Tratar códigos desconhecidos ou Other como revisão ou falha, nunca como penalidade zero silenciosa.
- 7. Manter o resultado calculado como somente leitura.
- 8. Registrar versão das regras, proveniência e trilha de cálculo.
- 9. Rejeitar qualquer implementação que represente somente um subconjunto reduzido dos campos SPREC aprovados.

### RF019 — Quarentena lógica

**Requisito:** O sistema deve aplicar quarentena lógica orientada a eventos quando o espécime, lote ou local apresentar condição incompatível com uso, processamento ou distribuição.

**Ator primário:** Sistema  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Acionar por revogação de consentimento.
- 2. Acionar por excursão ambiental.
- 3. Acionar por falha de governança do RCS.
- 4. Acionar por não conformidade crítica.
- 5. Bloquear retirada, processamento, envio e disponibilização.
- 6. Registrar causa, evento originador e momento da quarentena.
- 7. Permitir liberação somente por ator autorizado e mediante evidência.
- 8. Auditar a liberação e emitir evento de projeção.

### RF020 — Metadados institucionais e MIABIS

**Requisito:** O sistema deve gerenciar organizações, redes, biobancos, coleções e recursos de pesquisa, cobrindo todos os elementos MIABIS incorporados ao dicionário consolidado vigente e mantendo perfil projetado para interoperabilidade.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 modelo / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Cadastrar Organization, Network, Biobank, Collection e entidades associativas previstas.
- 2. Manter identificadores, contatos, descrições, relações e estado.
- 3. Registrar tipos de amostra, doenças, datasets e condições de acesso conforme os campos canônicos.
- 4. Exportar o perfil MIABIS adotado a partir do modelo canônico.
- 5. Cobrir integralmente os elementos MIABIS incorporados ao dicionário consolidado vigente.
- 6. Não declarar conformidade plena antes de validação formal independente.

### RF021 — Estudos, protocolos e ética

**Requisito:** O sistema deve gerenciar estudos, protocolos, versões, pesquisadores responsáveis, centros participantes e aprovações éticas.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 estrutura / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Gerar studyId e protocolId.
- 2. Versionar o protocolo.
- 3. Registrar CAAE e período de validade.
- 4. Vincular participante, consentimento, coleta e espécime ao estudo aplicável.
- 5. Impedir operação com protocolo inativo ou incompatível.

### RF022 — Foundation Data Pipeline

**Requisito:** O sistema deve executar o Foundation Data Pipeline como job one-shot da Fase 1 para preparar integralmente a estrutura de dados, as configurações fundacionais e os mecanismos de controle necessários às cargas das Fases 2 e 3.

**Ator primário:** Sistema / DevOps  
**Aplicação/status:** F1 - Foundation / Escopo atual

**Critérios de aceitação:**
- 1. Ler e validar a versão vigente do dicionário consolidado, incluindo os 929 elementos da versão 1.3.0.
- 2. Criar ou validar coleções, objetos embutidos, referências, schemas, índices, restrições, configurações e estruturas de controle para todos os elementos, sem exceções não registradas.
- 3. Executar após os health checks das persistências e antes da liberação das APIs e workers dependentes.
- 4. Permanecer separado do startup da aplicação e não depender de rotas de domínio.
- 5. Registrar cada execução em FoundationDataRun, com versões, checksums, etapas, resultados e estado final.
- 6. Suportar validação de configuração, dry run, relatório de cobertura, aplicação idempotente, verificação pós-execução e retomada segura.
- 7. Preparar ReferenceDatasetRelease, ReferenceImportRun, ReferenceImportIssue, TerminologyConcept, TerminologyRelation, staging, quarentena, checkpoint e promoção de releases.
- 8. Não criar participantes, identidades, consentimentos, espécimes, telemetria, arquivos ou workflows fictícios para satisfazer cardinalidades.
- 9. Bloquear a prontidão das Fases 2 e 3 quando houver erro estrutural fatal ou elemento sem tratamento definido.
- 10. Não utilizar perfis reduzidos de MIABIS, SPREC ou de qualquer outro padrão como modelo-alvo.

### RF023 — Outbox e projeção Neo4j

**Requisito:** O sistema deve registrar eventos de projeção no MongoDB e atualizar o Neo4j exclusivamente por processamento assíncrono do outbox.

**Ator primário:** Sistema  
**Aplicação/status:** F1 em diante / Escopo atual

**Critérios de aceitação:**
- 1. Criar GraphProjectionOutboxEvent.
- 2. Registrar identificadores canônicos e versão do schema.
- 3. Calcular hash do payload.
- 4. Processar com idempotência.
- 5. Suportar lease, retry e dead letter.
- 6. Proibir escrita direta de domínio no Neo4j.
- 7. Não projetar dados civis de ParticipantIdentity.

### RF024 — Solicitações de acesso e distribuição

**Requisito:** O sistema deve registrar solicitações de acesso a dados ou espécimes, avaliar compatibilidade ética e registrar a decisão do comitê responsável.

**Ator primário:** Pesquisador  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Registrar solicitante, estudo, finalidade e itens solicitados.
- 2. Avaliar consentimento, DUO e políticas de acesso.
- 3. Registrar decisão, justificativa e vigência.
- 4. Vincular aprovação à remessa ou disponibilização.
- 5. Bloquear acesso expirado, negado ou revogado.

### RF025 — Ensaios, reagentes e não conformidades

**Requisito:** O sistema deve gerenciar ensaios, lotes de reagentes, equipamentos, controles, não conformidades e ações corretivas.

**Ator primário:** Técnico  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Vincular espécimes, protocolo, operador e laboratório.
- 2. Registrar lotes e validade de reagentes.
- 3. Registrar equipamentos utilizados.
- 4. Registrar controles do ensaio.
- 5. Abrir não conformidade e ação corretiva.
- 6. Preservar causa, ação, responsável e verificação de eficácia.

### RF026 — Retenção e destinação

**Requisito:** O sistema deve aplicar políticas de retenção e registrar ações de destinação, descarte ou preservação legal.

**Ator primário:** Coordenador  
**Aplicação/status:** F1 política / F3 execução / Escopo atual

**Critérios de aceitação:**
- 1. Vincular registros a RetentionPolicy.
- 2. Aplicar legal hold quando necessário.
- 3. Registrar DispositionAction.
- 4. Registrar método, data, responsável e itens afetados.
- 5. Gerar evidência ou certificado.
- 6. Impedir destruição quando houver bloqueio ético ou legal.

### RF027 — Workflows e dados ômicos

**Requisito:** O sistema deve registrar a execução reprodutível de workflows computacionais e a proveniência de arquivos genômicos e transcriptômicos.

**Ator primário:** Pesquisador  
**Aplicação/status:** F1 contrato / F3 operação / Escopo atual

**Critérios de aceitação:**
- 1. Registrar workflow, versão e imagem de container.
- 2. Registrar parâmetros e dependências.
- 3. Vincular arquivos de entrada e saída.
- 4. Registrar início, término, executor e estado.
- 5. Registrar referência genômica quando aplicável.
- 6. Registrar qualificação ômica específica ao ensaio.
- 7. Não incluir IA ou XAI nesta fase.

### RF028 — Importação de dados de referência

**Requisito:** O sistema deve importar, validar, versionar e promover datasets, ontologias, terminologias e catálogos externos por pipelines explícitos da Fase 2, preservando licença, proveniência, release e reprodutibilidade.

**Ator primário:** Administrador / Sistema  
**Aplicação/status:** F2 - referências / Escopo atual

**Critérios de aceitação:**
- 1. Registrar a fonte e a release em ReferenceDatasetRelease antes da carga.
- 2. Suportar MONDO, HPO, ORPHA, CID, OMIM, HGNC, LOINC, UCUM, ATC, DCB, DUO, Uberon, NCBI Taxonomy, EDAM e demais fontes aprovadas.
- 3. Preservar URI de origem, versão, data, licença, checksum, formato, parserVersion e mappingVersion.
- 4. Executar download ou leitura, parsing em streaming, normalização, staging, validação e promoção controlada.
- 5. Registrar cada tentativa em ReferenceImportRun e cada rejeição em ReferenceImportIssue.
- 6. Persistir conceitos em TerminologyConcept e relações em TerminologyRelation, sempre vinculados à release.
- 7. Suportar dry run, checkpoint, retomada, idempotência, quarentena, verificação e rollback de release.
- 8. Considerar um dataset disponível somente quando houver release ativa e validada.
- 9. Persistir primeiro no MongoDB e projetar no Neo4j exclusivamente pelo outbox.
- 10. Impedir promoção quando licença, checksum, validação ou proveniência estiverem ausentes ou inválidos.

### RF029 — Ingestão operacional e científica

**Requisito:** O sistema deve receber e persistir, na Fase 3, dados operacionais, clínicos, laboratoriais, científicos e ômicos por APIs, arquivos, integrações e streams autorizados, utilizando a estrutura e as referências preparadas nas fases anteriores.

**Ator primário:** Sistema / Ator autorizado  
**Aplicação/status:** F3 - dados / Escopo atual

**Critérios de aceitação:**
- 1. Validar todo payload contra os contratos canônicos preparados na Fase 1.
- 2. Rejeitar aliases, campos desconhecidos, referências inexistentes e cardinalidades inválidas.
- 3. Exigir provenance, origem, timestamps, ator e finalidade conforme o tipo de dado.
- 4. Utilizar somente códigos pertencentes a releases de referência ativas ou registrar revisão controlada quando permitido.
- 5. Suportar ingestão idempotente e rastreável de participantes, consentimentos, espécimes, dados clínicos, telemetria, arquivos, datasets, ensaios, workflows e dados ômicos.
- 6. Encaminhar registros inválidos para staging ou quarentena, sem correção silenciosa.
- 7. Armazenar binários no Object Storage, telemetria de alta frequência no InfluxDB e documentos canônicos no MongoDB.
- 8. Gerar AuditEvent e GraphProjectionOutboxEvent quando aplicável.
- 9. Não persistir dados civis em projeções Neo4j.
- 10. Não introduzir IA, Assistente Inteligente ou XAI no escopo atual.

## Requisito funcional de projeto futuro separado

### RF-FUT-001 — Assistente inteligente

**Descrição:** Em projeto futuro separado, o sistema poderá prover um Assistente Inteligente para suporte operacional contextual e tutoria, sem acesso indevido a dados sensíveis.

**Ator:** Usuário

> **Regra de exclusão:** RF-FUT-001 não pode ser usado como evidência de funcionalidade implementada nas Fases 1, 2 ou 3. IA/Assistente Inteligente/XAI permanecem em projeto futuro separado — fora do escopo atual de testes e2e.

## Apêndice C — Requisitos Não Funcionais (RNF)

### RNF001 — Tempo de resposta da interface

**Categoria:** Desempenho  
**Aplicação:** F3  
**Prioridade:** Alta

A interface deve responder às interações ordinárias do usuário em até 2 segundos no percentil 95, considerando o ambiente de referência documentado.

**Critérios de aceitação:**
- 1. Cliques, navegação e abertura de formulários simples atendem ao limite estabelecido.
- 2. Operações com duração superior a 500 ms exibem indicador de processamento.
- 3. Downloads, importações extensas e indisponibilidade de serviços externos são medidos separadamente.
- 4. O resultado é verificado por testes E2E e telemetria do frontend.

### RNF002 — Latência na consulta de espécimes e participantes

**Categoria:** Desempenho  
**Aplicação:** F3  
**Prioridade:** Alta

Consultas simples pelos identificadores canônicos devem retornar em até 3 segundos no percentil 95 com pelo menos 100.000 registros operacionais no ambiente de referência.

**Critérios de aceitação:**
- 1. As pesquisas utilizam specimenId, participantId, barcode ou identificador indexado.
- 2. Listagens são paginadas e não realizam varredura integral da coleção.
- 3. O plano de execução e os índices utilizados são registrados no teste de carga.
- 4. Consultas gráficas complexas e relatórios analíticos são avaliados por cenários próprios.

### RNF003 — Disponibilidade do serviço

**Categoria:** Disponibilidade  
**Aplicação:** Transversal  
**Prioridade:** Alta

A plataforma deve operar continuamente, com disponibilidade mensal alvo de pelo menos 99,5%, desconsideradas janelas de manutenção previamente comunicadas.

**Critérios de aceitação:**
- 1. O tempo total de manutenção programada não excede 4 horas por mês.
- 2. Indisponibilidades são registradas com início, término, causa e impacto.
- 3. Serviços críticos possuem health checks e mecanismos de reinicialização controlada.
- 4. A disponibilidade é calculada e publicada em relatório operacional.

### RNF004 — Coleta de telemetria durante falhas de conectividade

**Categoria:** Resiliência  
**Aplicação:** F3  
**Prioridade:** Crítica

O subsistema de monitoramento ambiental deve continuar capturando leituras durante falhas temporárias de comunicação com o servidor central.

**Critérios de aceitação:**
- 1. O componente de borda mantém buffer durável com timestamp de origem e identificador do dispositivo.
- 2. A sincronização posterior é idempotente e preserva a ordem temporal possível.
- 3. Leituras já confirmadas não são duplicadas.
- 4. Nenhuma leitura confirmada pelo componente de borda é perdida por falha transitória de rede.
- 5. Lacunas de coleta são identificadas e geram alerta operacional.

### RNF005 — Curva de aprendizado

**Categoria:** Usabilidade  
**Aplicação:** F3  
**Prioridade:** Alta

Usuários com conhecimento básico de informática devem executar as operações essenciais após treinamento de até 4 horas.

**Critérios de aceitação:**
- 1. Pelo menos 80% dos participantes do teste de usabilidade concluem cadastro, consulta e movimentação sem erro crítico.
- 2. Mensagens de erro indicam o problema e a ação necessária.
- 3. A terminologia da interface é consistente com o domínio do biobanco.
- 4. Operações irreversíveis exigem confirmação explícita.

### RNF006 — Documentação técnica e de usuário

**Categoria:** Suportabilidade  
**Aplicação:** Transversal  
**Prioridade:** Alta

A plataforma deve possuir documentação versionada e compatível com a versão publicada do sistema.

**Critérios de aceitação:**
- 1. Há guias para participantes autorizados, técnicos, coordenadores e administradores.
- 2. Há documentação de instalação, configuração, backup, restauração, APIs, eventos e troubleshooting.
- 3. O dicionário de dados e os contratos canônicos são referenciados como fontes normativas.
- 4. Mudanças relevantes possuem notas de versão e instruções de migração.
- 5. A documentação não contém segredos, credenciais ou dados pessoais reais.
- 6. A documentação descreve o Foundation Data Pipeline, os gates das fases, a gestão de releases de referência e a ingestão operacional.
- 7. A versão normativa do dicionário consolidado é identificada explicitamente em cada release do sistema.

### RNF007 — Segregação da identidade e pseudonimização

**Categoria:** Privacidade e LGPD  
**Aplicação:** F3  
**Prioridade:** Crítica

A identidade civil deve permanecer segregada do registro científico pseudonimizado.

**Critérios de aceitação:**
- 1. Participant utiliza participantId como identificador canônico de pesquisa.
- 2. Nome, data exata de nascimento, contatos e identificadores civis são mantidos em ParticipantIdentity sob controles reforçados.
- 3. ParticipantIdentity não é projetado para o Neo4j.
- 4. Logs, relatórios e exportações omitem ou pseudonimizam identificadores diretos por padrão.
- 5. A reidentificação somente ocorre por fluxo autorizado, auditado e vinculado a finalidade legítima.

### RNF008 — Autorização baseada em papéis, permissões e escopo

**Categoria:** Segurança  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

O controle de acesso deve ser aplicado no backend por Role, Permission e atribuições com escopo.

**Critérios de aceitação:**
- 1. A política padrão é negar o acesso quando não houver permissão explícita.
- 2. Os papéis canônicos possuem códigos estáveis e rótulos localizados.
- 3. A autorização considera vigência, organização, biobanco, coleção, estudo ou recurso quando aplicável.
- 4. A ocultação de controles no frontend não substitui a validação do backend.
- 5. Mudanças de papel ou escopo invalidam sessões ou permissões em cache conforme a política.

### RNF009 — Registro imutável e verificável de auditoria

**Categoria:** Auditoria e rastreabilidade  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

Eventos críticos devem ser registrados em AuditEvent append-only, pesquisável e verificável.

**Critérios de aceitação:**
- 1. São auditados autenticação, acesso a dados sensíveis, alterações, exportações, consentimento, custódia, qualidade, políticas e administração.
- 2. Cada evento contém ator pseudonimizado, ação, recurso, resultado, timestamps e correlação.
- 3. Payloads são sanitizados e não armazenam segredos ou dados pessoais desnecessários.
- 4. A integridade é verificada por hash encadeado e/ou consolidação por raiz Merkle.
- 5. A aplicação não permite edição ou exclusão dos eventos de auditoria.

### RNF010 — Backup, recuperação e continuidade

**Categoria:** Confiabilidade  
**Aplicação:** Transversal  
**Prioridade:** Crítica

A plataforma deve adotar estratégia de backup 3-2-1, com cópias criptografadas e restauração testada.

**Critérios de aceitação:**
- 1. Há pelo menos três cópias, em duas tecnologias ou mídias, com uma cópia fora do ambiente principal.
- 2. O RPO alvo dos dados operacionais é de até 24 horas.
- 3. O RTO alvo para recuperação completa é de até 12 horas.
- 4. A retenção mínima padrão é de 30 dias, ajustável por política e exigência legal.
- 5. Testes de restauração são executados periodicamente e validados por checksum.

### RNF011 — Integridade, validação e consistência dos registros

**Categoria:** Qualidade de dados  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

Metadados críticos e dados importados devem ser validados antes da promoção ou persistência canônica e permanecer consistentes entre entidades.

**Critérios de aceitação:**
- 1. Identificadores canônicos são únicos e imutáveis.
- 2. Campos obrigatórios, tipos, cardinalidades e vocabulários são validados por schema.
- 3. Referências inexistentes, posições duplicadas, relações órfãs e transições inválidas são rejeitadas.
- 4. Importações inválidas são colocadas em staging ou quarentena, sem correção silenciosa.
- 5. Conceitos e relações de terminologia permanecem vinculados à ReferenceDatasetRelease correspondente.
- 6. Nenhuma release é ativada com erro fatal aberto.
- 7. Em teste controlado, a aceitação indevida de valores inválidos em campos críticos deve ser inferior a 0,1%.

### RNF012 — Apoio aos processos alinhados à ISO 20387

**Categoria:** Conformidade  
**Aplicação:** Transversal  
**Prioridade:** Alta

O sistema deve apoiar processos de competência, rastreabilidade, qualidade e gestão de registros coerentes com os princípios aplicáveis da ISO 20387.

**Critérios de aceitação:**
- 1. A linhagem do participante ao espécime, processamento, localização e destinação é recuperável.
- 2. Métodos, equipamentos, não conformidades e evidências possuem histórico.
- 3. A documentação mantém matriz de rastreabilidade entre requisitos e funcionalidades.
- 4. O sistema não declara certificação ou conformidade formal sem avaliação institucional independente.

### RNF013 — Gestão de segurança alinhada à ISO/IEC 27001

**Categoria:** Conformidade e segurança  
**Aplicação:** Transversal  
**Prioridade:** Alta

A segurança da informação deve ser orientada por risco e por controles compatíveis com os princípios da ISO/IEC 27001.

**Critérios de aceitação:**
- 1. Ativos, riscos, responsáveis e tratamentos são documentados.
- 2. Há controles de acesso, gestão de incidentes, continuidade, backup, registro e revisão periódica.
- 3. Exceções de segurança possuem aprovação, prazo e risco residual.
- 4. O sistema não declara certificação ISO/IEC 27001 sem auditoria formal da organização.

### RNF014 — Conteinerização e reprodutibilidade de ambientes

**Categoria:** Portabilidade  
**Aplicação:** F1-F3  
**Prioridade:** Alta

Os componentes implantáveis devem ser empacotados em containers versionados e reproduzíveis.

**Critérios de aceitação:**
- 1. As imagens são construídas por arquivo declarativo e possuem versão ou digest imutável.
- 2. Configurações são externas à imagem e segredos não são incorporados ao artefato.
- 3. Containers possuem health checks, limites de recursos e execução sem privilégios desnecessários.
- 4. Desenvolvimento, teste e produção utilizam a mesma família de artefatos.
- 5. Kubernetes é opcional e não constitui dependência obrigatória da arquitetura.
- 6. O Foundation Data Pipeline é empacotado como job ou container one-shot versionado e possui condição de conclusão verificável.
- 7. A liberação de APIs e workers dependentes considera o resultado do gate de prontidão da Fase 1.

### RNF015 — Monitoramento de aplicação, infraestrutura e filas

**Categoria:** Observabilidade  
**Aplicação:** F1-F3  
**Prioridade:** Alta

A plataforma deve produzir métricas, logs e rastreamento suficientes para detectar falhas e degradação.

**Critérios de aceitação:**
- 1. São monitorados frontend, APIs, workers, MongoDB, Neo4j, InfluxDB, Redis, Object Storage e integrações.
- 2. Há alertas para indisponibilidade, latência, erro, CPU, memória, disco, fila acumulada e dead letter.
- 3. Eventos correlacionados compartilham traceId ou identificador equivalente.
- 4. Prometheus, Grafana, Nagios ou ferramentas equivalentes podem ser adotados conforme a implantação.
- 5. Logs observacionais permanecem separados do AuditEvent normativo.
- 6. FoundationDataRun, ReferenceImportRun, ReferenceImportIssue, promoção de releases e backlog de projeção possuem métricas e alertas.
- 7. Falhas estruturais da Fase 1 e falhas fatais de importação da Fase 2 são distinguíveis de falhas operacionais da Fase 3.

### RNF016 — Escalabilidade independente da persistência poliglota

**Categoria:** Escalabilidade  
**Aplicação:** F1-F3  
**Prioridade:** Alta

Cada tecnologia de persistência deve poder evoluir conforme seu padrão de carga, sem criar fonte canônica concorrente.

**Critérios de aceitação:**
- 1. MongoDB atende documentos operacionais e outbox.
- 2. Neo4j atende projeções de linhagem e governança.
- 3. InfluxDB atende telemetria de alta frequência.
- 4. Object Storage atende arquivos científicos e evidências.
- 5. Testes de capacidade documentam limites, índices, particionamento e estratégia de expansão de cada componente.

### RNF017 — Automação de testes e gates de integração

**Categoria:** Qualidade de software  
**Aplicação:** Transversal  
**Prioridade:** Crítica

A esteira de integração deve executar testes automatizados antes da incorporação de mudanças.

**Critérios de aceitação:**
- 1. Há testes unitários, integração, contrato, arquitetura, segurança e E2E.
- 2. Playwright ou ferramenta equivalente cobre 100% das jornadas críticas listadas na matriz de testes.
- 3. Falhas em lint, typecheck, schema, contrato ou jornada crítica bloqueiam a integração.
- 4. Os testes utilizam dados sintéticos e não expõem informações reais.
- 5. Cobertura numérica é monitorada, mas não substitui a cobertura de risco e de cenários.
- 6. A CI verifica a cobertura integral do dicionário vigente pelo Foundation Data Pipeline.
- 7. Testes de importação validam idempotência, checkpoint, quarentena, promoção, rollback e reconciliação do outbox.

### RNF018 — Validação em múltiplas camadas

**Categoria:** Validação  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

Entradas devem ser validadas no frontend e novamente no backend a partir dos contratos canônicos.

**Critérios de aceitação:**
- 1. A validação ordinária da interface responde em até 1 segundo.
- 2. Bibliotecas como Zod, JSON Schema ou equivalentes podem ser utilizadas.
- 3. O backend permanece autoritativo e rejeita propriedades desconhecidas ou aliases não permitidos.
- 4. Payloads não canônicos retornam erro explícito, preferencialmente HTTP 422.
- 5. Regras críticas não dependem exclusivamente da validação do cliente.

### RNF019 — Outbox durável, retries e reconciliação

**Categoria:** Resiliência de eventos  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

Eventos destinados ao Neo4j devem ser persistidos em GraphProjectionOutboxEvent antes do processamento assíncrono.

**Critérios de aceitação:**
- 1. O processamento utiliza entrega pelo menos uma vez e consumidores idempotentes.
- 2. Há lease, timeout, retries limitados, backoff e dead letter.
- 3. Nenhum evento confirmado no outbox é perdido por falha transitória.
- 4. A reconciliação detecta projeções ausentes ou divergentes e permite reprocessamento seguro.
- 5. Escritas diretas de domínio no Neo4j são proibidas.

### RNF020 — Proteção criptográfica e gestão de segredos

**Categoria:** Criptografia  
**Aplicação:** F1-F3  
**Prioridade:** Crítica

Dados, credenciais e segredos devem ser protegidos durante armazenamento, transmissão e processamento.

**Critérios de aceitação:**
- 1. Comunicações externas utilizam TLS 1.2 ou superior.
- 2. Senhas são armazenadas somente por algoritmo de hash adaptativo apropriado.
- 3. Tokens de recuperação e códigos sensíveis são armazenados por hash; segredos MFA são cifrados.
- 4. ParticipantIdentity e outros campos críticos utilizam criptografia em repouso ou por campo.
- 5. Segredos são fornecidos por mecanismo seguro e podem ser rotacionados sem alteração de código.
- 6. Segredos e valores sensíveis não aparecem em logs.

### RNF021 — Ciclo de vida seguro de sessões e tokens

**Categoria:** Segurança de sessão  
**Aplicação:** F3  
**Prioridade:** Crítica

Sessões autenticadas devem possuir duração limitada, revogação e proteção contra reutilização indevida.

**Critérios de aceitação:**
- 1. Access tokens são de curta duração e refresh tokens, quando utilizados, possuem rotação.
- 2. Logout, inativação, troca de senha ou alteração crítica de papel revogam as sessões afetadas.
- 3. Timeout por inatividade e duração máxima são configuráveis.
- 4. Tokens não são persistidos em texto claro no banco.
- 5. Cookies, quando utilizados, aplicam Secure, HttpOnly e SameSite adequados.
- 6. O usuário pode consultar e encerrar suas sessões ativas.

### RNF022 — Minimização, retenção e destinação de dados

**Categoria:** Privacidade e retenção  
**Aplicação:** F3  
**Prioridade:** Crítica

A plataforma deve coletar e manter somente dados necessários às finalidades documentadas.

**Critérios de aceitação:**
- 1. Cada classe de dado possui finalidade, sensibilidade, prazo de retenção e responsável.
- 2. Legal hold impede descarte quando houver obrigação ética, científica ou legal.
- 3. Exclusões permitidas utilizam destinação controlada, pseudonimização ou descarte verificável.
- 4. Contas vinculadas a auditoria são inativadas ou pseudonimizadas, evitando exclusão física destrutiva.
- 5. Relatórios e ambientes de teste aplicam minimização e dados sintéticos.

### RNF023 — Versionamento de schemas e migrações controladas

**Categoria:** Evolução do modelo  
**Aplicação:** Transversal  
**Prioridade:** Crítica

Mudanças no modelo de dados, APIs e eventos devem ser versionadas e migráveis.

**Critérios de aceitação:**
- 1. Documentos e eventos registram schemaVersion.
- 2. Alterações incompatíveis exigem nova versão de contrato e plano de migração.
- 3. Migrações são idempotentes, observáveis e testadas com cópia ou dados sintéticos.
- 4. Aliases legados não são aceitos silenciosamente em novos contratos.
- 5. Dicionário, diagramas, schemas, backend, frontend e testes são atualizados no mesmo ciclo de mudança.
- 6. Há estratégia documentada de rollback ou recuperação.
- 7. Alterações na Fase 1, nos importadores da Fase 2 ou nos contratos da Fase 3 referenciam a mesma versão normativa do dicionário.
- 8. A adição de entidade ou campo ocorre primeiro no XLSX consolidado e somente depois em schemas, código, diagramas e testes.

### RNF024 — FHIR R4 como fronteira sem efeitos colaterais

**Categoria:** Interoperabilidade  
**Aplicação:** F3  
**Prioridade:** Crítica

Conversões FHIR devem funcionar como transformação de interoperabilidade e não como persistência paralela.

**Critérios de aceitação:**
- 1. Recursos são validados contra estrutura e perfil adotados.
- 2. A conversão preserva identificadores canônicos, versão e proveniência.
- 3. Funções de serialização não escrevem diretamente no MongoDB ou Neo4j.
- 4. Recursos FHIR não são persistidos como coleções operacionais canônicas.
- 5. Importações utilizam staging, validação e quarentena quando necessário.

### RNF025 — Consistência de timestamps e sincronização de relógios

**Categoria:** Temporalidade  
**Aplicação:** F1-F3  
**Prioridade:** Alta

Eventos de consentimento, custódia, auditoria, telemetria e processamento devem possuir temporalidade consistente e verificável.

**Critérios de aceitação:**
- 1. Serviços e dispositivos sincronizam relógio por mecanismo institucional, como NTP.
- 2. Timestamps canônicos são armazenados em UTC com informação suficiente para apresentação local.
- 3. Telemetria distingue occurredAt, receivedAt e persistedAt quando aplicável.
- 4. Desvios de relógio acima do limite configurado são detectados.
- 5. Ordenação temporal não depende exclusivamente da hora do cliente.

### RNF026 — Latência e confiabilidade das notificações críticas

**Categoria:** Desempenho de alertas  
**Aplicação:** F3  
**Prioridade:** Alta

Alertas críticos devem ser emitidos com baixa latência e possuir rastreabilidade de entrega.

**Critérios de aceitação:**
- 1. Alertas de excursão ambiental e ataque de força bruta são encaminhados em até 2 minutos no percentil 95 após a detecção, no ambiente de referência.
- 2. Falhas de envio utilizam retry e escalonamento configuráveis.
- 3. Cada tentativa registra canal, horário, resultado e evento originador.
- 4. A mensagem evita dados pessoais ou científicos desnecessários.

### RNF027 — Acesso inclusivo e compatibilidade de interface

**Categoria:** Acessibilidade e compatibilidade  
**Aplicação:** F3  
**Prioridade:** Média

A interface deve seguir princípios de acessibilidade compatíveis com nível AA e operar nos navegadores suportados pela instituição.

**Critérios de aceitação:**
- 1. Navegação essencial é possível por teclado.
- 2. Campos possuem rótulos, foco visível, contraste adequado e mensagens associadas.
- 3. Componentes críticos são testados com tecnologias assistivas representativas.
- 4. A aplicação suporta as duas versões estáveis mais recentes dos navegadores definidos na matriz de suporte.
- 5. O layout permanece utilizável em resoluções institucionais previstas.

### RNF028 — Modularidade, qualidade interna e governança arquitetural

**Categoria:** Manutenibilidade  
**Aplicação:** Transversal  
**Prioridade:** Crítica

O código deve manter separação de responsabilidades e limites coerentes com os domínios do modelo.

**Critérios de aceitação:**
- 1. Escritas canônicas, projeções, interoperabilidade e apresentação permanecem em camadas distintas.
- 2. Não há dual write entre MongoDB e Neo4j.
- 3. Lint, typecheck, análise de dependências e testes de arquitetura integram a CI.
- 4. Dependências críticas são atualizadas por processo controlado.
- 5. Dívidas técnicas e superfícies legadas possuem inventário, prioridade e plano de remoção.
- 6. O gate modelo-código impede alterações que contradigam o dicionário aprovado.
- 7. O gate modelo-código verifica que todos os elementos do dicionário vigente possuem tratamento explícito no Foundation Data Pipeline.
- 8. Importadores de referência e ingestores operacionais não podem criar campos, aliases ou entidades fora do modelo aprovado.

### RNF029 — Integridade e proteção do Object Storage

**Categoria:** Segurança de arquivos  
**Aplicação:** F3  
**Prioridade:** Alta

Arquivos científicos e evidências devem ser armazenados fora dos documentos operacionais, com integridade e acesso controlados.

**Critérios de aceitação:**
- 1. O upload valida tamanho, MIME, extensão e política de formato.
- 2. Cada arquivo possui checksum SHA-256, tamanho, URI, versão e proveniência.
- 3. O conteúdo é submetido a verificação de malware quando a infraestrutura permitir.
- 4. Acesso ocorre por credencial temporária ou mecanismo equivalente, com auditoria.
- 5. Criptografia, retenção e ciclo de vida seguem a classificação do dado.
- 6. Binários grandes não são incorporados ao documento MongoDB.

### RNF030 — Proveniência computacional de workflows e dados ômicos

**Categoria:** Reprodutibilidade  
**Aplicação:** F3  
**Prioridade:** Alta

Execuções computacionais devem ser reprodutíveis e rastreáveis até entradas, parâmetros, ambiente e saídas.

**Critérios de aceitação:**
- 1. WorkflowRun registra versão do workflow, imagem ou digest do container, parâmetros e executor.
- 2. Entradas e saídas possuem identificador, versão e checksum.
- 3. Referências genômicas, bibliotecas e ferramentas são versionadas.
- 4. Falhas, retomadas e derivações são registradas por evento.
- 5. A proveniência pode ser mapeada para PROV-O.

## RNF031 — Preparação integral, versionada, idempotente e integrada à implantação

**Categoria:** Foundation Data Pipeline | **Aplicação:** F1 - Foundation | **Prioridade:** Crítica | **Status:** Obrigatório para o gate da fase

Ver texto completo (15 critérios) em `1-Requisitos-Funcionais-e-Nao-Funcionais.md` seção "Requisitos não funcionais específicos do pipeline".

## RNF032 — Proveniência, qualidade, promoção e rollback de releases externas

**Categoria:** Governança de dados de referência | **Aplicação:** F2 - referências | **Prioridade:** Crítica | **Status:** Obrigatório para o gate da fase

Ver texto completo (10 critérios) em `1-Requisitos-Funcionais-e-Nao-Funcionais.md` seção "Requisitos não funcionais específicos do pipeline".
