# Roteiro incremental para o Codex

## BioAvanceD v3 — MVP conteinerizado com Foundation Data Pipeline Fase 1

**Finalidade:** este documento contém prompts independentes e sequenciais para execução no Codex. Ele não contém código do BioAvanceD. Execute um laboratório por vez, em uma nova mensagem, sempre anexando o Prompt Mestre e o prompt do laboratório correspondente.

**Regra de avanço:** um laboratório somente termina com `PASS` quando todos os testes automatizados e critérios do gate passarem. `PARTIAL PASS`, exceções silenciosas, TODOs usados para ocultar escopo e testes desativados não são aceitos. Em caso de ambiguidade, conflito documental ou decisão técnica pendente, o resultado obrigatório é `BLOCKED`, acompanhado da pergunta objetiva para Denise.

**Condição inicial oficial:** o repositório GitHub `BioAvanceD-v3` pode estar completamente vazio: sem commit, sem `main`, sem branch remota, sem arquivos e sem estrutura de projeto. O Codex deve iniciar desse estado no Lab 00. Não presuma que existe código anterior, não copie automaticamente o protótipo do Lovable e não use o BioAvanceD v2 como fundação.

---

# Como usar

1. Disponibilize ao Codex o repositório oficial vazio e os oito documentos canônicos.
2. Cole primeiro o **Prompt Mestre**.
3. Cole apenas um prompt de laboratório por execução.
4. Não execute o laboratório seguinte até que o relatório do atual apresente `PASS`.
5. Se houver `BLOCKED`, responda à pergunta do Codex e mande-o retomar o mesmo laboratório.
6. Preserve os relatórios de gate em `docs/traceability/gates/`.
7. No primeiro uso, informe explicitamente ao Codex a URL do repositório oficial vazio. Não peça clonagem de conteúdo de outro repositório.

---

# Prompt Mestre — cole em todos os laboratórios

```text
Você está implementando o BioAvanceD v3. Trabalhe apenas no laboratório indicado após este Prompt Mestre.

ESTADO INICIAL DO REPOSITÓRIO
- O repositório oficial pode estar totalmente vazio: zero commits, nenhuma branch, nenhum arquivo e nenhuma estrutura.
- Se estiver vazio, isso é o estado esperado, não um erro e não autoriza copiar outro projeto.
- O Lab 00 é responsável pelo bootstrap documental e Git mínimo.
- Não presuma a existência de main. Não crie nem modifique main para contornar o estado vazio.
- A primeira branch de trabalho deve ser `mvp/foundation-phase-1`, criada como branch inicial/orphan quando necessário.
- Todo código deste ciclo permanecerá nessa branch até autorização explícita de Denise para integração.
- Não conecte, importe, faça merge, cherry-pick ou copie conteúdo de `BioAvanceD-v2`, `bioavanced-proto`, Lovable ou qualquer outro repositório.

FONTES CANÔNICAS E ORDEM DE AUTORIDADE
1. Dicionário de Dados Consolidado v1.3.0: autoridade para Elemento ID, entidades, campos, nomes, tipos, cardinalidade, obrigatoriedade, domínios, vocabulários, sensibilidade, proveniência, persistência, índices, FHIR e fase.
2. Requisitos Funcionais e Não Funcionais v3.0.1: autoridade comportamental, atores, critérios de aceitação, segurança, operação e qualidade.
3. Plano Integrado do Foundation Data Pipeline v2.1.1: autoridade para a Fase 1, control plane, execução, idempotência, retomada, verificação e gates.
4. Manuscrito RCS e Supplementary Files 1 e 2: autoridade para SPREC, severidade, algoritmo RCS, governança e explicabilidade.
5. Modelagem poliglota: use apenas quando não contrariar as quatro fontes anteriores.

ARQUIVOS CANÔNICOS
- 1 - Requisitos Funcionais e Não Funcionais.docx
- 2 - Dicionario_Dados_Consolidado_v1.3.0.xlsx
- 2.1 - Additional_file_1.xlsx
- 3 - Plano_Integrado_Foundation_Data_Pipeline.docx
- 3.1 - Modelagem de dados poliglota - Biobancos.docx
- 4 - A_Governance_Aware_Rule_Based_Computational_Framework_for_Biospecimen_Qualification_in_Biobank_Information_Systems.pdf
- 4.1 - Supplementary File 1. SPREC Reference and Severity Tables.pdf
- 4.2 - Supplementary File 2. Supplementary Methods.pdf

Não use internet, conhecimento externo, BioAvanceD v2 ou outras versões documentais para definir requisitos, campos, regras ou comportamento. A v2 só poderá ser consultada em laboratório explicitamente autorizado como referência de experiência operacional, nunca como fonte normativa ou estrutural.

REGRAS INEGOCIÁVEIS
- Não invente campos, entidades, enums, aliases, estados, permissões, integrações, regras, dados fundacionais ou comportamentos.
- A série funcional válida encerra-se em `RF029`. Não existe `RF030`; qualquer referência a esse identificador é erro documental e deve ser corrigida antes do gate.
- Use `RF022` exclusivamente para o Foundation Data Pipeline, `RF023` para outbox/projeção Neo4j, `RF028` para importação de referências da Fase 2 e `RF029` para ingestão operacional/científica da Fase 3.
- Não aceite aliases legados como patient, sample, patientID ou sampleId.
- Backend, código, contratos, identificadores, rotas, eventos, logs e mensagens técnicas em inglês.
- Frontend com inglês padrão e cobertura integral em português e espanhol.
- TailAdmin real como shell/design system; superfícies predominantemente brancas, sobretudo o Integrated Biobank Intake.
- Todo componente executável roda em container. foundation-data é job one-shot separado do startup interno da API.
- MongoDB é a fonte operacional canônica. Neo4j é apenas projeção assíncrona via outbox. Proíba dual write.
- InfluxDB é destinado à telemetria de alta frequência; Object Storage aos binários; Redis somente a estado transitório; FHIR R4 é fronteira de transformação, não persistência operacional.
- ParticipantIdentity permanece segregado, cifrado e ausente do Neo4j, logs e payloads indevidos.
- Pseudonimização, segurança, auditoria e Merkle são controles relacionados, porém distintos. Merkle comprova integridade; não pseudonimiza.
- ConsentTemplate e Consent são recursos distintos; decisões executáveis usam consentId.
- Resultados calculados de RCS são somente leitura. Unknown/Other nunca recebe penalidade zero por suposição.
- A Fase 1 não insere participantes, identidades, consentimentos, espécimes, telemetria ou dados operacionais/científicos fictícios.
- Não execute a população de referências da Fase 2 nem a população operacional/científica da Fase 3.
- A futura implementação de `RF028` deve inventariar todos os endpoints, assets ou partições oficiais aplicáveis, reconciliar contagens esperadas e obtidas e bloquear promoção quando houver cobertura parcial não justificada.
- IA, XAI, assistente inteligente, marketplace, apoio automatizado à decisão clínica e armazenamento 3D estão fora do escopo.
- Não crie nem modifique main diretamente. Trabalhe em `mvp/foundation-phase-1` durante este roteiro e preserve alterações do usuário.

PROTOCOLO ANTI-INVENÇÃO
1. Antes de editar, inspecione o repositório, os documentos canônicos e o último relatório de gate.
2. Construa ou atualize a matriz:
   requisito → Elemento ID do dicionário → API/evento → tela/estado → teste automatizado → gate.
3. Para cada artefato proposto, registre a fonte exata. Um item sem requisito e sem Elemento ID aplicável é proibido.
4. Quando documentos divergirem, registre o conflito em docs/traceability/open-decisions.md e pare o artefato afetado.
5. Quando uma escolha técnica não estiver definida nos documentos ou em ADR aprovado, não decida por conveniência. Apresente alternativas compatíveis e pergunte a Denise.
6. Não altere testes para acomodar comportamento incorreto. Corrija a implementação.
7. Não desative, pule, marque xfail ou reduza a abrangência de testes para obter PASS.
8. Não declare sucesso com mocks quando o gate exige integração real entre containers.

TESTES E DEFINITION OF DONE
- Todo domínio/regra pura exige teste unitário.
- Toda API exige teste de contrato, validação de payload e autorização.
- Toda persistência/adaptador exige teste de integração no container real correspondente.
- Toda jornada entregue exige E2E no navegador e, quando aplicável, E2E de backend.
- Gates de arquitetura devem detectar: escrita direta no Neo4j, ParticipantIdentity no grafo, aliases legados, efeitos colaterais em serializadores FHIR, dual write e segredos/dados sensíveis em logs.
- Testes de segurança cobrem autenticação, autorização, escopo, mass assignment, sessões, criptografia, auditoria e acesso indevido.
- Testes devem executar de forma reproduzível por comando conteinerizado documentado.
- A CI parte de checkout limpo, usa o lockfile e a mesma base Linux dos containers, valida dependências nativas/opcionais e executa Playwright contra a composição real.
- A CI deve descobrir todos os arquivos de teste; arquivo não alcançado por nenhum comando executado bloqueia o gate.
- A linha de base de cobertura é versionada; regressão bloqueia a integração, salvo mudança explicitamente justificada, aprovada e acompanhada da atualização da matriz de riscos e cenários.
- `.env.example`, Compose, CI e runners devem usar o mesmo conjunto de chaves e uma única origem por segredo. Rate limits, bloqueios e demais controles não podem ser relaxados apenas por `NODE_ENV`.
- Uma etapa só termina quando lint, typecheck, unit, contract, integration, security, architecture e E2E aplicáveis estiverem verdes.

FORMATO OBRIGATÓRIO DO RELATÓRIO FINAL DO LABORATÓRIO
1. Resultado: PASS ou BLOCKED.
2. Escopo implementado e explicitamente não implementado.
3. Arquivos alterados.
4. Matriz de rastreabilidade com as colunas:
   Requirement ID | Element ID(s) | API/Event | Screen/State | Automated Test | Gate | Evidence.
5. Comandos executados e resumo dos resultados.
6. Evidências do gate.
7. Conflitos ou decisões pendentes.
8. Confirmação de que nenhum requisito, campo ou regra foi inventado.

Se qualquer critério obrigatório falhar, responda BLOCKED e não avance ao próximo laboratório.
```

---

# Lab 00 — Bootstrap do repositório vazio, fontes e decisões técnicas

```text
LAB 00 — BOOTSTRAP DOCUMENTAL A PARTIR DE REPOSITÓRIO GITHUB VAZIO

Objetivo único: iniciar de forma controlada o repositório oficial vazio, fixar as fontes canônicas e transformar decisões técnicas pendentes em perguntas explícitas. Não implemente frontend, backend, schemas, pipeline, containers ou YAML operacional neste laboratório.

Tarefas:
1. Confirme a URL e o nome do repositório oficial antes de qualquer escrita.
2. Inspecione o Git local e remoto e classifique objetivamente o estado:
   - EMPTY_REMOTE: repositório remoto sem refs/commits;
   - EMPTY_LOCAL: diretório sem repositório Git;
   - INITIALIZED: já existe algum commit ou branch.
3. Se o remoto ou o diretório já contiver conteúdo inesperado, não sobrescreva, não apague e não faça merge. Finalize como BLOCKED, listando apenas os achados necessários para Denise decidir.
4. Se o estado estiver vazio como esperado:
   - inicialize o Git local, se necessário;
   - configure o remote oficial sem alterar outro remote existente;
   - crie `mvp/foundation-phase-1` como primeira branch/orphan;
   - não crie `main`;
   - não importe histórico ou arquivos de outro repositório.
5. Verifique se existe AGENTS.md no workspace disponibilizado e cumpra-o. A ausência de AGENTS.md não autoriza inventar regras.
6. Localize os oito documentos canônicos fornecidos por Denise fora da árvore versionada da aplicação, quando possível. Calcule SHA-256 e registre nome, versão interna, tamanho e checksum. Não versione anexos que contenham material restrito sem autorização explícita.
7. Identifique toda decisão técnica não fixada documentalmente, incluindo:
   - linguagem/framework do backend;
   - stack de frontend compatível com TailAdmin;
   - produto de Object Storage;
   - fila/broker transitório;
   - autenticação/identidade;
   - gestão de segredos e criptografia de campo;
   - observabilidade;
   - servidor DICOM;
   - ferramentas de testes;
   - estratégia de Compose e eventual Kubernetes.
8. Para cada decisão pendente, apresente no máximo três opções compatíveis, impactos e uma recomendação claramente marcada como proposta, nunca como requisito.
9. Crie somente o baseline mínimo:
   - README.md informando que o projeto está em bootstrap e apontando para as fontes e gates;
   - .gitignore mínimo para impedir versionamento de segredos, arquivos locais e cópias de fontes restritas;
   - docs/canonical/source-manifest.json;
   - docs/traceability/open-decisions.md;
   - docs/traceability/repository-baseline.md;
   - docs/traceability/gates/L00.md.
10. O manifesto deve referenciar as fontes por nome, versão e checksum, sem incorporar ou reescrever seu conteúdo.
11. Faça o primeiro commit somente com esse baseline documental e publique somente a branch `mvp/foundation-phase-1`.
12. Não escolha stack, não instale dependências, não gere scaffold e não crie código placeholder antes da aprovação de Denise.

Testes/gate:
- Validar automaticamente que os oito arquivos estão presentes, legíveis e com checksums registrados.
- Validar que o manifesto não contém caminhos externos nem fontes adicionais.
- Validar que o commit inicial não contém segredos, binários dos documentos canônicos, código, dependências, containers ou arquivos copiados de outros projetos.
- Validar que a única branch publicada por este laboratório é `mvp/foundation-phase-1`.
- Gate L00: repositório vazio inicializado de forma reproduzível, baseline documental publicado, fontes fixadas e todas as decisões bloqueadoras explicitadas.

Resultado esperado:
- O primeiro resultado pode ser BLOCKED quando houver decisões técnicas pendentes; isso é esperado e não invalida o bootstrap documental.
- Após Denise responder e o mesmo Lab 00 ser retomado, registre as decisões aprovadas em open-decisions/relatório, reexecute as validações e finalize com PASS.
- PASS apenas se o bootstrap estiver publicado e nenhuma decisão técnica bloqueadora permanecer pendente.
- Caso existam decisões pendentes, BLOCKED com perguntas numeradas para Denise. Esse BLOCKED é o comportamento correto.
```

---

# Lab 01 — ADRs e scaffold inicial do projeto conteinerizado

```text
LAB 01 — PRIMEIRO SCAFFOLD EXECUTÁVEL DO REPOSITÓRIO

Pré-condição: Lab 00 retomado e concluído com PASS; branch `mvp/foundation-phase-1` publicada; todas as decisões bloqueadoras aprovadas por Denise.

Objetivo único: criar, pela primeira vez, a estrutura mínima e executável do projeto, registrar somente as escolhas aprovadas e provar que o ambiente conteinerizado vazio funciona, sem implementar regras de negócio.

Tarefas:
1. Leia as respostas aprovadas de Denise e converta-as em ADRs. Não acrescente decisões.
2. Confirme que continua na branch `mvp/foundation-phase-1` e que não há conteúdo importado de outros repositórios.
3. Crie a organização modular aprovada para frontend, API, contracts, workers, foundation-data, testes e documentação.
4. Gere cada workspace a partir das ferramentas oficiais da stack aprovada, fixando versões; não copie templates do BioAvanceD v2, do protótipo Lovable ou de projetos externos.
5. Crie imagens de desenvolvimento mínimas e não privilegiadas para os componentes aprovados.
6. Crie o primeiro Compose de desenvolvimento somente com os serviços mínimos necessários ao scaffold e seus healthchecks. Persistências que ainda não tenham contrato aprovado podem ser declaradas somente quando a decisão correspondente estiver registrada em ADR.
7. Adicione configuração por ambiente, exemplo de variáveis sem segredos e validação de configuração. Garanta paridade de chaves entre `.env.example`, Compose, CI e runners, com uma única origem por segredo.
8. Adicione comandos conteinerizados reais para install/build, lint, typecheck e testes infraestruturais e configure uma CI mínima obrigatória que os execute a partir de checkout limpo, usando lockfile e a mesma base Linux dos containers.
9. Crie testes smoke mínimos que provem:
   - build reproduzível desde clone limpo;
   - frontend placeholder técnico responde no container, sem tela funcional;
   - API health endpoint técnico responde no container, sem endpoint de domínio;
   - serviços encerram e reiniciam de forma controlada;
   - nenhum serviço depende de arquivos não versionados, exceto configuração local documentada;
   - dependências nativas/opcionais são resolvidas de modo reproduzível no runner e no container;
   - todos os arquivos de teste existentes são descobertos por pelo menos um comando da CI.
10. Configure regras que impeçam commits de segredos e logs contendo valores sensíveis conhecidos.
11. Não implemente entidades, endpoints de domínio, telas funcionais, migrations/validators definitivos, seeds ou dados sintéticos.

Testes/gate:
- Executar a validação a partir de um clone/worktree limpo da branch publicada.
- Build de todas as imagens mínimas.
- Containers executam como usuário não root quando tecnicamente aplicável.
- Lint e typecheck verdes.
- Scanner de segredos e teste de configuração verdes.
- Smoke tests conteinerizados verdes para frontend e API técnica.
- Workflow de CI executado e verde em checkout limpo, com evidência do lockfile, da base Linux e da descoberta integral de testes.
- Teste de arquitetura confirma ausência de dependência invertida entre domain/application/adapters.
- Confirmar que main continua inexistente/intocada e que nenhum histórico externo foi importado.
- Gate L01: primeiro scaffold reproduzível, executável e integralmente conteinerizado, criado do zero e sem regra de negócio inventada.
```

---

# Lab 02 — Compilador do dicionário e matriz canônica 929/79/26

```text
LAB 02 — CONTRACT COMPILER E RASTREABILIDADE CANÔNICA

Pré-condição: L01 PASS.

Objetivo único: representar e validar integralmente o Dicionário Consolidado v1.3.0 sem ainda criar APIs ou telas.

Tarefas:
1. Leia programaticamente a aba normativa do dicionário.
2. Preserve exatamente cada Elemento ID e todos os metadados canônicos.
3. Gere um manifesto intermediário determinístico, versionado e com checksum.
4. Modele tratamento explícito para 929 elementos, 79 entidades/objetos e 26 domínios.
5. Represente tipo, cardinalidade, obrigatoriedade/condição, enum/vocabulário, sensibilidade, proveniência, destino, índice, FHIR e fase sem converter silenciosamente valores condicionais em opcionais.
6. Classifique propriedades calculadas/imutáveis como não graváveis pelo cliente.
7. Gere a matriz base `Requirement ID → Element ID`, permitindo ausência apenas quando o requisito é puramente operacional e isso estiver justificado.
8. Detecte duplicatas, IDs ausentes, destinos incoerentes, campos sem entidade e conflitos com requisitos.
9. Não corrija o dicionário por inferência; registre conflitos e bloqueie.

Testes/gate:
- Contagem exata 929/929, 79/79 e 26/26.
- Cada Elemento ID aparece uma única vez.
- Snapshot/checksum determinístico.
- Testes de tipos, cardinalidade, obrigatoriedade condicional, sensibilidade, destino e fase.
- Teste negativo: propriedade desconhecida é rejeitada.
- F1-G01 e F1-G02 somente podem ser marcados PASS com relatório integral.
- Gate L02: cobertura canônica completa, zero elemento ignorado.
```

---

# Lab 03 — Contratos compartilhados e envelopes de API/evento

```text
LAB 03 — CONTRATOS VERSIONADOS, SEM ENDPOINTS DE NEGÓCIO

Pré-condição: L02 PASS.

Objetivo único: gerar contratos canônicos compartilhados a partir do manifesto, sem implementar casos de uso.

Tarefas:
1. Gere schemas de create, update, read, event e projection apenas quando aplicáveis.
2. Proíba campos calculados/imutáveis em create/update.
3. Rejeite propriedades desconhecidas e aliases legados com erro 422 no contrato futuro.
4. Defina envelopes de sucesso/erro com schemaVersion, correlationId, code técnico em inglês, fieldPath canônico e detalhes sanitizados.
5. Defina versionamento, UTC, optimistic concurrency, idempotency key e paginação estável conforme aplicável.
6. Gere tipos consumíveis por backend, frontend e testes a partir da mesma fonte.
7. Não acrescente propriedades de conveniência ao contrato.

Testes/gate:
- Contract tests para todas as entidades aplicáveis.
- Golden tests comprovam estabilidade determinística.
- Casos negativos cobrem aliases, mass assignment, campos read-only e desconhecidos.
- Teste de paridade prova que backend/frontend/testes usam a mesma versão/checksum.
- Gate L03: contratos gerados sem divergência do manifesto L02.
```

---

# Lab 04 — FoundationDataRun e runner one-shot

```text
LAB 04 — FOUNDATION RUNNER

Pré-condição: L03 PASS.

Objetivo único: implementar o control plane mínimo da Fase 1 e o container one-shot foundation-data.

Tarefas:
1. Implemente FoundationDataRun com os 19 campos exatos do dicionário.
2. Implemente os modos validate, dry-run, apply, verify e resume.
3. Modele estados e transições somente quando documentados.
4. Implemente checkpoints, idempotência, fail-fast, relatórios e retomada segura.
5. Faça o runner consumir o manifesto versionado/checksummed do Lab 02.
6. Proíba inicialização interna do runner pela API.
7. Não aplique ainda estruturas definitivas das persistências; use adapters testáveis que serão completados no Lab 05.

Testes/gate:
- Unitários para transições, idempotência, checkpoint, erro fatal e resume.
- Integração com MongoDB real para FoundationDataRun.
- Reexecução com mesmo manifesto não duplica efeitos.
- Alteração de checksum produz comportamento documentado, nunca aplicação silenciosa.
- Falha interrompe dependentes e produz relatório seguro.
- F1-G08 e Gate L04: runner one-shot, versionado, auditável, idempotente e retomável.
```

---

# Lab 05 — Fundação poliglota e gates estruturais

```text
LAB 05 — PERSISTÊNCIAS E FASE 1 ESTRUTURAL

Pré-condição: L04 PASS.

Objetivo único: preparar, via foundation-data, as estruturas documentadas de MongoDB, Neo4j, InfluxDB, Redis e Object Storage.

Tarefas:
1. Suba os serviços reais em containers com healthchecks.
2. MongoDB: aplique validators, índices, uniques, TTL quando explicitamente aplicável, control plane e proteção de campos.
3. Neo4j: aplique apenas constraints/índices e contratos de projeção. Não crie caminho de escrita direta de domínio.
4. InfluxDB: prepare buckets, retenção e contratos de measurements/tags/fields conforme o dicionário.
5. Redis: prepare namespaces para cache, sessão, lock, fila, rate limit e idempotência; nunca estado canônico.
6. Object Storage: prepare buckets/políticas/retention/integridade autorizados.
7. Faça validate → dry-run → apply → verify.
8. Não insira dados operacionais/científicos fictícios nem referências externas da Fase 2.

Testes/gate:
- Integração real para cada persistência.
- Teste de idempotência executa apply duas vezes e compara o estado.
- Testes de fronteira impedem ParticipantIdentity no Neo4j, binários grandes no MongoDB, incidentes canônicos no InfluxDB e estado normativo no Redis.
- Relatório comprova 929/929, 79/79, 26/26 e zero erro estrutural fatal.
- F1-G03, F1-G07, F1-G09 e Gate L05.
```

---

# Lab 06 — Segurança, identidade protegida, auditoria e Merkle

```text
LAB 06 — SECURITY FOUNDATION

Pré-condição: L05 PASS.

Objetivo único: implementar apenas os controles de segurança e governança rastreáveis aos documentos.

Tarefas:
1. Implemente Actor, UserAccount, Role, Permission, UserRoleAssignment, Session, RecoveryCodeSet, SecurityConfiguration, AccessPolicy e RetentionPolicy conforme seus Elemento IDs.
2. Implemente autenticação, MFA, recovery, bloqueio, expiração/inatividade/rotação/revogação de sessão conforme requisitos. Rate limits e bloqueios não podem ser relaxados apenas por `NODE_ENV`; exceções de teste exigem perfil explícito e isolado.
3. Implemente RBAC + permissão + vigência + escopo; menu do frontend nunca é controle de autorização.
4. Implemente ParticipantIdentity em fronteira protegida, com criptografia e permissão específica aprovadas no Lab 00/01.
5. Implemente AuditEvent append-only com payload sanitizado e canonicalização determinística de objetos aninhados, arrays, valores nulos e datas; rejeite ciclos e tipos não suportados explicitamente.
6. Implemente hash canônico/encadeamento e MerkleRoot como integridade de evidências. Não use Merkle como pseudonimização e não inclua PII na raiz.
7. Separe logs observacionais de AuditEvent e deduplique ou limite avisos repetitivos sem suprimir eventos de segurança distintos.
8. Exponha somente APIs administrativas necessárias aos requisitos mapeados.

Testes/gate:
- Unitários para políticas, escopo, sessão e sanitização.
- Golden tests de canonicalização para objetos aninhados, arrays, `null`, datas, ordenação estável, ciclos e tipos não suportados; teste de deduplicação/limitação de warnings.
- Contrato/API para autenticação e administração.
- Segurança: acesso horizontal/vertical, mass assignment, brute force/lockout, sessão revogada, PII em logs, segredos e criptografia.
- Arquitetura: ParticipantIdentity ausente do Neo4j/outbox impróprio; AuditEvent imutável.
- E2E: sign-in, MFA aplicável, sessão e administração autorizada.
- F1-G05 e Gate L06.
```

---

# Lab 07 — Outbox e projeção Neo4j

```text
LAB 07 — OUTBOX, PROJECTOR E RECONCILIAÇÃO

Pré-condição: L06 PASS.

Objetivo único: implementar consistência eventual MongoDB → outbox → Neo4j sem dual write.

Tarefas:
1. Implemente GraphProjectionOutboxEvent com os 19 campos exatos.
2. Persista documento operacional e outbox na mesma transação MongoDB.
3. Implemente projector com lease, entrega pelo menos uma vez, consumidor idempotente, retry limitado, dead letter, replay e reconciliação.
4. Sanitize projeções conforme sensibilidade e proíba ParticipantIdentity.
5. Adicione métricas de backlog, erro, retry, dead letter e divergência.
6. Não permita que casos de uso acessem o driver Neo4j diretamente.

Testes/gate:
- Integração real MongoDB/Neo4j.
- Falha entre persistência e projeção não perde evento.
- Replay não duplica nós/arestas.
- Reconciliação detecta e corrige projeção divergente sem alterar a fonte canônica.
- Teste arquitetural falha se houver import/chamada direta ao Neo4j fora do projector.
- Gate L07: outbox durável, idempotente, reconciliável e sem PII proibida.
```

---

# Lab 08 — Registros institucionais, estudos e ética

```text
LAB 08 — INSTITUTIONAL REGISTRY + STUDY/PROTOCOL

Pré-condição: L07 PASS.

Objetivo único: implementar os recursos institucionais e de estudo necessários às jornadas posteriores.

Tarefas:
1. Implemente apenas entidades e relações institucionais mapeadas: Organization, Network, NetworkMembership, Biobank, Collection, ResearchResource e associações.
2. Implemente Study e Protocol com estados, vigência e evidências exatamente documentados.
3. APIs devem aplicar autorização, escopo, validação canônica, concorrência e auditoria.
4. Crie telas TailAdmin correspondentes, brancas, responsivas e trilíngues.
5. Não implemente intake neste laboratório.

Testes/gate:
- Unitários das invariantes documentadas.
- Contrato e integração de API/persistência/outbox.
- E2E das jornadas institucionais e study/protocol.
- Acessibilidade AA nas jornadas críticas.
- Testes de i18n garantem zero texto funcional hardcoded fora dos recursos.
- Gate L08: matriz requisito → elemento → API → tela → teste integral.
```

---

# Lab 09 — Participante, identidade protegida e consentimento

```text
LAB 09 — PARTICIPANT + PROTECTED IDENTITY + CONSENT

Pré-condição: L08 PASS.

Objetivo único: implementar os recursos que formarão os passos 1, 2 e 5 do intake, ainda sem o wizard integrado.

Tarefas:
1. Implemente Participant separado de ParticipantIdentity.
2. Implemente pseudonymId e demais campos exatamente conforme o dicionário; não crie algoritmo de pseudônimo não aprovado.
3. Implemente ConsentTemplate e Consent separados, com versão, evidência/hash, finalidades, restrições, atualização/revogação e consentId.
4. Implemente impacto de consentimento apenas conforme requisitos, incluindo bloqueio/quarentena quando documentado.
5. Crie telas independentes de participante, identidade protegida e consentimento usando TailAdmin branco e i18n EN/PT/ES.
6. O frontend nunca deve persistir ou registrar identidade protegida em storage/logs indevidos.

Testes/gate:
- Unitários de consentimento, vigência, revogação e política.
- Segurança de reidentificação e segregação.
- Contrato/integracão/outbox.
- E2E participante, acesso protegido, consentimento e revogação.
- F1-G06 e Gate L09.
```

---

# Lab 10 — Espécimes, processamento, armazenamento e custódia

```text
LAB 10 — SPECIMEN OPERATIONS

Pré-condição: L09 PASS.

Objetivo único: implementar Specimen, ProcessingBatch, StorageLocation, StorageAssignment e CustodyEvent.

Tarefas:
1. Use somente campos, cardinalidades e estados canônicos.
2. Garanta identificadores únicos e vínculos autorizados com participantId, study/protocol/collection.
3. Implemente linhagem/projeções exclusivamente via outbox.
4. CustodyEvent deve ser imutável e usar previousEventHash/eventHash/merkleRootRef conforme o dicionário e regras aplicáveis.
5. Implemente alocação, movimentação e liberação sem sobrescrever o histórico.
6. Execute operações de custódia que alterem múltiplos documentos em transação MongoDB real sobre replica set; qualquer falha deve realizar rollback integral.
7. Crie inventory, details, lineage, processing, storage e custody no padrão TailAdmin branco.
8. Não implemente SPREC/RCS neste laboratório.

Testes/gate:
- Unitários de invariantes, transições e hash de custódia.
- Contrato/integração/outbox/Neo4j com MongoDB em replica set.
- Concorrência, atomicidade e rollback de alocação, movimentação e liberação no stack real.
- E2E criação, inventário, linhagem, alocação e movimentação.
- Gate L10.
```

---

# Lab 11 — SPREC, RCS, revisão técnica e quarentena

```text
LAB 11 — QUALIFICAÇÃO GOVERNANCE-AWARE

Pré-condição: L10 PASS.

Objetivo único: implementar integralmente SpecimenPreanalytics e RCSAssessment segundo o dicionário, manuscrito e suplementos.

Tarefas:
1. Carregue tabelas/regras SPREC e severidades somente das fontes canônicas, versionadas e com checksum.
2. Implemente cálculo puro e reprodutível de penalidades aplicáveis, biologicalPenalty, rcsScore, grade e rota de decisão.
3. Implemente governance evaluator e grau E quando a regra vigente determinar.
4. Unknown/Other deve encaminhar a revisão/falha documentada; nunca assuma zero.
5. RCSAssessment persiste entrada referenciada, resultado, versão, proveniência e explicação eixo a eixo como read-only.
6. Revisão técnica registra decisão humana autorizada sem reescrever o cálculo original.
7. Implemente QuarantineAction apenas quando acionada pelas regras/requisitos documentados.
8. Crie telas SPREC, RCS, calculation details, technical review, assessment queue e quarantine aplicáveis.

Testes/gate:
- Unitários cobrindo todas as tabelas/regras, limites e casos suplementares.
- Golden tests com vetores derivados exclusivamente dos suplementos.
- Mutation/property tests quando compatíveis com o algoritmo aprovado.
- Contrato/integracão/segurança.
- E2E calculado, unknown, revisão técnica e governance failure/grade E.
- F1-G04 e Gate L11.
```

---

# Lab 12 — Integrated Biobank Intake em oito passos

```text
LAB 12 — INTEGRATED BIOBANK INTAKE

Pré-condição: L11 PASS.

Objetivo único: integrar os contratos já aprovados em um wizard sem criar objeto monolítico.

Passos obrigatórios:
1. Participant
2. Protected Identity
3. Study and Protocol
4. Clinical Context
5. Consent
6. Specimen
7. SPREC and RCS
8. Review and Submit

Tarefas:
1. Implemente draft e submit final como orquestração de recursos independentes.
2. Cada passo valida seu contrato canônico; o submit revalida todos, autorização, escopo, consentimento e governança.
3. Falhas não podem deixar registros parciais invisíveis.
4. Use TailAdmin real: aplicação, header, sidebar, cards, forms, alerts, badges, modals e stepper.
5. Superfícies integralmente brancas; bordas cinza claras, sombras mínimas e verde/teal apenas para ação/progresso.
6. Desktop: 1100–1280 px, stepper compacto, formulário à esquerda, resumo à direita e barra fixa Back/Save draft/Continue.
7. Mobile: uma coluna, “Step N of 8”, resumo em accordion, ações fixas e sem scroll horizontal.
8. Estados: ready, loading, empty, validation error, service unavailable, permission denied, dictionary unavailable, foundation not ready, saved draft, unsaved changes, completed e blocked by governance.
9. Estados RCS: not available, calculated, unknown code, technical review required e governance failure/grade E.
10. EN padrão, PT/ES completos; contratos continuam em inglês.

Testes/gate:
- Unitários de componentes, step coordination, validação e i18n.
- Contratos para draft/submit.
- Integração garantindo rollback/compensação documentada e ausência de estado parcial invisível.
- E2E desktop e mobile para happy path e todos os estados críticos.
- Acessibilidade AA, teclado, foco, mensagens associadas e responsividade.
- Visual regression das superfícies brancas e passos.
- Gate L12: jornada completa, sem contrato monolítico e sem campos inventados.
```

---

# Lab 13 — Demais módulos funcionais priorizados

```text
LAB 13 — MÓDULOS RESTANTES DO MVP APROVADO

Pré-condição: L12 PASS.

Objetivo único: implementar apenas os módulos explicitamente classificados para o primeiro MVP pela matriz aprovada. Não interprete o catálogo de 127 telas como autorização automática para implementar todas.

Procedimento obrigatório:
1. Antes de editar, apresente a lista exata de Requirement IDs, Element IDs, APIs e telas a implementar neste laboratório.
2. Se a priorização do MVP não estiver registrada de forma inequívoca, responda BLOCKED e peça a Denise que selecione os módulos. Não escolha sozinho.
3. Para os módulos aprovados, implemente vertical slices completos, um por vez:
   - Clinical;
   - Telemetry/Environmental Excursions;
   - Quality/Nonconformance/Disposition;
   - Access/Distribution/Shipment;
   - Scientific Data;
   - Reports/Exports;
   - outros somente se explicitamente aprovados.
4. Cada slice exige domínio, API, persistência/outbox aplicável, tela TailAdmin, i18n e testes.
5. Funcionalidade futura não implementada deve aparecer apenas como estado honesto de indisponibilidade se isso for aprovado; não simule backend.
6. O slice Reports/Exports deve derivar no backend o escopo organizacional efetivo das atribuições vigentes e aplicá-lo igualmente a linhas detalhadas, indicadores, agregações e exportações.

Testes/gate:
- Suite completa por vertical slice.
- E2E da jornada correspondente.
- Gate L13 separado por slice; o laboratório só recebe PASS quando todos os slices aprovados estiverem verdes.
```

---

# Lab 14 — Workers, arquivos e interoperabilidade autorizada

```text
LAB 14 — WORKERS E FRONTEIRAS

Pré-condição: L13 PASS.

Objetivo único: concluir os workers e adapters exigidos pelo escopo aprovado, sem executar Fase 2 ou 3.

Tarefas:
1. Finalize telemetry-worker, notification-worker e audit-integrity-worker apenas conforme requisitos mapeados.
2. Implemente upload/acesso a arquivos com MIME, extensão, tamanho, SHA-256, política, URI, versão, proveniência e acesso temporário. Vincule cada arquivo a `specimenId`, `assayId`, `studyId` ou `datasetId` quando aplicável e audite upload, acesso, substituição e remoção lógica.
3. Implemente FHIR R4 import/export como transformação/validação/staging quando aplicável; serializadores não gravam em banco.
4. Implemente MIABIS sem reduzir o perfil documentado.
5. Integração DICOM somente se decisão e requisitos estiverem aprovados; caso contrário, BLOCKED no artefato afetado.
6. Não baixar/importar/promover terminologias externas da Fase 2.

Testes/gate:
- Unitários de transformações puras.
- Integração dos workers e Object Storage.
- Segurança de upload/download e logs, vínculos canônicos e auditoria completa do ciclo de vida do arquivo.
- Arquitetura para FHIR sem side effects.
- E2E somente das jornadas aprovadas.
- Gate L14.
```

---

# Lab 15 — Compose completo, observabilidade, recuperação e gate final Fase 1

```text
LAB 15 — AMBIENTE COMPLETO E RELEASE GATE

Pré-condição: L01–L14 PASS, respeitando os módulos efetivamente aprovados.

Objetivo único: entregar a composição YAML completa e provar que a Fase 1 sobe de forma segura e reproduzível.

Ordem obrigatória:
1. Validar configuração/segredos e a paridade de chaves entre `.env.example`, Compose, CI e runners.
2. Subir MongoDB, Neo4j, InfluxDB, Redis e Object Storage com healthchecks.
3. Executar foundation-data validate/dry-run/apply/verify.
4. Persistir FoundationDataRun e produzir relatório.
5. Liberar gate apenas com 929/929, 79/79, 26/26, zero erro estrutural fatal e F1-G01…F1-G10.
6. Liberar domain-api, api-gateway e workers.
7. Liberar frontend somente após api-gateway ready.
8. Executar smoke/E2E críticos.

Tarefas:
1. Implemente perfis foundation, application, observability e test.
2. Defina depends_on/healthchecks/gate sem depender apenas da ordem de criação de containers.
3. Garanta que falha do foundation bloqueia API/workers/frontend.
4. Adicione métricas, logs e traces com correlationId/traceId e sem dados sensíveis.
5. Teste backup/restore, replay do outbox e resume do FoundationDataRun.
6. Produza relatório final checksummed com F1-G01 a F1-G10.
7. Documente um único procedimento reproduzível para subir, testar, parar e recuperar o ambiente.

Testes/gate:
- Build limpo de todas as imagens.
- Subida do zero em ambiente isolado.
- Suite conteinerizada completa: lint, typecheck, unit, contract, integration, architecture, security, accessibility, visual e E2E.
- CI comprova descoberta de todos os arquivos de teste, Playwright contra a composição real e ausência de regressão não aprovada da linha de base de cobertura.
- Build usa lockfile, a mesma base Linux dos containers e valida dependências nativas/opcionais no runner suportado.
- Teste negativo corrompe uma pré-condição do dicionário e prova que a aplicação não fica ready.
- Teste de idempotência reaplica Foundation sem efeitos duplicados.
- Teste de recuperação restaura estado e comprova checksums.
- READY somente se o último FoundationDataRun aplicável estiver COMPLETED e todos os gates passarem.
- Gate L15/Fase 1: PASS final ou BLOCKED; nenhum estado intermediário.
```

---

# Lab 16 — Auditoria final de escopo e handoff

```text
LAB 16 — AUDITORIA FINAL, SEM NOVAS FUNCIONALIDADES

Pré-condição: L15 PASS.

Objetivo único: auditar integridade, rastreabilidade e escopo antes de declarar o MVP concluído.

Tarefas:
1. Reconstrua a matriz completa:
   requisito → Elemento ID → API/evento → tela/estado → teste → gate.
2. Liste cada Requirement ID e cada Elemento ID sem cobertura e classifique:
   - legitimamente fora do MVP aprovado;
   - preparado estruturalmente na Fase 1;
   - bloqueado por decisão;
   - defeito de cobertura.
3. Falhas de cobertura dentro do escopo são BLOCKED; não crie implementação nova neste laboratório.
4. Audite ausência de IA/XAI/assistant/marketplace/3D e de população Fase 2/3.
5. Audite ausência de aliases legados, dual write, ParticipantIdentity no grafo, RCS editável, PII/segredos em logs, dados operacionais fictícios no bootstrap e qualquer referência a RF030.
6. Audite explicitamente descoberta integral de testes, cobertura sem regressão não aprovada, Playwright na CI, paridade de configuração, ausência de bypass por `NODE_ENV`, transações reais de custódia, canonicalização de auditoria, escopo de relatórios e vínculos/auditoria de arquivos.
7. Execute novamente a suite completa e preserve evidências.
8. Produza handoff com arquitetura efetiva, comandos, ADRs, riscos, limitações e fronteiras das Fases 2/3.

Gate:
- PASS apenas se toda linha do escopo aprovado possuir requisito, Elemento ID aplicável, implementação, teste e evidência de gate.
- O relatório deve declarar explicitamente que Fases 2 e 3 não foram executadas.
```

---

# Modelo de resposta de retomada após BLOCKED

Use este prompt somente depois de responder às perguntas do Codex:

```text
RETOMADA DO LAB [NÚMERO]

Considere apenas as decisões abaixo como novas autorizações:
[cole as respostas numeradas de Denise]

Retome exatamente o Lab [NÚMERO] do ponto bloqueado.
- Não recomece laboratórios já aprovados.
- Não amplie o escopo.
- Atualize os ADRs/open-decisions e a matriz de rastreabilidade.
- Execute novamente todos os testes aplicáveis ao laboratório.
- Finalize somente com PASS ou novo BLOCKED no formato obrigatório.
```

---

# Checklist de controle de Denise

Antes de autorizar o próximo laboratório, confirme:

- [ ] O relatório diz `PASS`, não “parcial”.
- [ ] Todos os testes aplicáveis passaram.
- [ ] Há evidência do comando e do resultado.
- [ ] A matriz contém Requirement ID e Element ID.
- [ ] Nenhum campo/regra/estado foi criado sem fonte.
- [ ] Nenhum teste foi desativado ou reduzido.
- [ ] Nenhum dado operacional fictício foi inserido na Fase 1.
- [ ] A branch e o escopo estão corretos.
- [ ] O laboratório seguinte não antecipa Fase 2 ou 3.
