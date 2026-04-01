# Memorial Descritivo Tecnico para Registro no INPI

## 0. Identificacao da Solucao

Titulo tecnico proposto: Metodo e Sistema Computacional para Governanca Etica de Biobancos com Validacao Semantica em Grafo, Quarentena Logica por Consentimento e Ledger Imutavel de Custodia.

Objeto: Arquitetura de software implementada por computador para ingestao, validacao, autorizacao, rastreabilidade e auditoria de amostras biologicas e metadados clinicos.

Escopo tecnico: resolucao de problemas de integridade semantica, bloqueio etico em tempo de execucao e imutabilidade de trilha de custodia em ambiente poliglota MongoDB + Neo4j, com resiliencia por fila assincrona.

---

## 1. Campo da Invencao e Problema Tecnico

### 1.1 Campo da invencao

A invencao se insere no campo de sistemas de informacao para biobancos, dados clinicos e fluxos de cadeia de custodia, com aplicacao em laboratorios, pesquisa translacional e ambientes regulados por requisitos de privacidade, rastreabilidade e auditoria.

### 1.2 Problema tecnico objetivo

Solucoes convencionais de gestao de amostras apresentam, em conjunto, tres falhas tecnicas recorrentes:

1. Falha de padronizacao semantica automatica.
   - Dados clinicos sao persistidos como texto livre, sem garantia de coerencia entre classificacoes clinicas e fenotipicas.
   - Consequencia tecnica: perda de consistencia estrutural, ambiguidade de classificacao e baixa confiabilidade em consultas de inferencia.

2. Falha de isolamento etico em tempo de execucao.
   - Controles de consentimento sao tratados como metadado administrativo, sem bloqueio transacional acoplado ao acesso ao dado biologico.
   - Consequencia tecnica: possibilidade de leitura/escrita indevida de amostras sob consentimento ausente, expirado ou revogado.

3. Falha de imutabilidade da rastreabilidade.
   - Historicos de movimentacao fisica normalmente sao mantidos em tabelas mutaveis sem encadeamento criptografico entre eventos.
   - Consequencia tecnica: trilha suscetivel a alteracao posterior e dificuldade de verificacao de integridade historica.

### 1.3 Objetivo tecnico da invencao

A invencao resolve os problemas acima por meio de:

1. Motor semantico em grafo para inferencia clinica estruturada.
2. Quarentena logica orientada por consentimento como porteiro de autorizacao.
3. Ledger append-only com hash encadeado SHA-256 para custodia.
4. Mecanismo de auto-recuperacao para indisponibilidade transitoria da base de grafo.

---

## 2. Solucao Proposta: Arquitetura Poliglota e Nucleo Inventivo

### 2.1 Topologia arquitetural

A arquitetura combina dois modelos de dados complementares com papeis tecnicos distintos:

1. MongoDB (documental):
   - Persistencia administrativa e transacional de pacientes, amostras, consentimentos e eventos operacionais.

2. Neo4j (grafos):
   - Persistencia de relacionamentos semanticos e topologicos de linhagem clinica e custodia.

Nucleo inventivo: acoplamento consistente entre estado documental e relacional em grafo, com verificacao etica pre-persistencia e reconciliacao assincrona quando houver indisponibilidade do grafo.

### 2.2 Inovacao 1: Motor Semantico em Cascata

#### 2.2.1 Entrada e transformacao

Entrada estruturada minima para diagnostico:
- system (URI de ontologia)
- code (identificador canonico)
- display (descricao)

Processo:
1. Recebe entidade clinica indexada (por exemplo, ORPHA).
2. Executa travessia de grafo para expansionar relacoes fenotipicas (HPO) e biomarcadores associados.
3. Gera estrutura coerente para armazenamento e consulta.

#### 2.2.2 Grafo clinico de referencia

- Patient -[:HAS_DIAGNOSIS]-> Disease
- Disease -[:PRESENTS_PHENOTYPE]-> Phenotype_HPO
- Phenotype_HPO -[:MEASURED_BY]-> Biomarker

#### 2.2.3 Propriedade tecnica

A cascata substitui mapeamento manual por inferencia topologica controlada, reduzindo erro de consistencia semantica e mantendo integridade estrutural em operacoes subsequentes.

---

## 3. Detalhamento Algoritmico: Quarentena Logica e Etica

### 3.1 Middleware de autorizacao etica

Componente: authConsent.

Funcao tecnica: gatekeeper de autorizacao que intercepta requisicoes e valida:

1. Identificacao do paciente (patientID) por extracao multiponto (body, params, query, locals, ou resolver customizado).
2. Existencia de consentimento ativo.
3. Presenca de escopos obrigatorios de consentimento.
4. Ausencia de revogacao.

Se qualquer condicao falhar, retorna bloqueio tecnico com codigo HTTP apropriado (400, 403 ou 503), sem permitir acesso ao recurso de amostra.

### 3.2 Modelo de estado de quarentena

Estados relevantes de amostra:
- QUARANTINED
- AVAILABLE
- PARTIAL
- DEPLETED
- UNAVAILABLE

Transicoes eticas implementadas:

1. Revogacao de consentimento:
   - Condicao: existe pelo menos um consentimento REVOKED.
   - Acao: atualiza amostras relacionadas para QUARANTINED em Neo4j e MongoDB.
   - Efeito: isolamento logico imediato de acesso.

2. Reativacao por aceite:
   - Condicao: todos os consentimentos necessarios em ACTIVE ou GRANTED.
   - Acao: atualiza amostras de QUARANTINED para AVAILABLE em Neo4j e MongoDB.
   - Efeito: restauracao controlada de acessibilidade.

### 3.3 Consistencia trans-bancos

A transicao de estado e aplicada em duas representacoes:

1. Estado documental (MongoDB) para operacoes administrativas e API.
2. Estado topologico (Neo4j) para inferencia e regras de linhagem.

A invencao evita divergencia de interpretacao entre camadas ao propagar a mesma regra de estado para os dois modelos.

### 3.4 Auto-recuperacao topologica

Componente: TopologicalQuarantine.

Finalidade tecnica: evitar perda de eventos de linhagem durante falha transitoria no banco de grafo.

Algoritmo resumido:

1. Se persistencia no grafo falhar em modo permissivo, serializa evento e enfileira em Redis.
2. Worker periodico processa lotes com limite configuravel.
3. Cada item tenta novamente validar consentimento e registrar evento no grafo.
4. Em falha sucessiva, reencaminha item com contador de tentativas.
5. Ao atingir maximo de tentativas, descarta com metrica de observabilidade.

Propriedade tecnica obtida:
- degradacao controlada sem corromper a cadeia de linhagem.

---

## 4. Cadeia de Custodia Imutavel (Chain of Custody)

### 4.1 Ledger append-only

Componente: sampleMovementLedger.

Regra estrutural:
- eventos de movimentacao sao gravados por insercao.
- metodos mutantes (update/delete/replace) sao bloqueados por politica append-only.

### 4.2 Encadeamento criptografico SHA-256

Para cada novo evento E_n:

1. Recupera hash anterior H_(n-1) da ultima movimentacao da mesma amostra.
2. Constroi payload canonico com campos relevantes de rastreabilidade.
3. Calcula H_n = SHA256(payload(E_n, H_(n-1))).
4. Persiste E_n contendo:
   - chainPrevHash = H_(n-1)
   - chainHash = H_n
   - chainAlgorithm = sha256
   - immutable = true

Efeito tecnico:
- qualquer alteracao retroativa em evento anterior quebra a verificacao de encadeamento.

### 4.3 Localizacao fisica como extensao logica

No grafo, eventos de custodia podem referenciar origem e destino de armazenamento por relacoes FROM e TO com nos de posicao.

Com isso, localizacao nao e apenas atributo textual, mas elemento estruturado da trilha de custodia, permitindo reconstruir trajetoria fisica da amostra em alinhamento com requisitos de rastreabilidade ISO 20387.

---

## 5. Fluxogramas de Dados (Descricao Narrativa Algoritmica)

### 5.1 Algoritmo de ingestao inteligente (Smart Import)

1. Entrada de arquivo estrutural (CSV/FHIR Bundle).
2. Validacao sintatica e semantica por schemas (Zod/AJV), incluindo obrigatoriedade de pares system+code para entidades clinicas.
3. Rejeicao de texto livre em diagnostico quando nao atender estrutura canonica.
4. Normalizacao e mapeamento para padroes internos.
5. Persistencia administrativa em MongoDB.
6. Persistencia de relacoes topologicas em Neo4j.
7. Registro de evento de custodia inicial com hash encadeado.
8. Emissao de identificador rastreavel para etiquetagem DataMatrix.

### 5.2 Algoritmo de autorizacao etica em runtime

1. Requisicao chega ao endpoint protegido.
2. Middleware authConsent extrai patientID.
3. Consulta consentimento ativo e escopos.
4. Se invalido: bloqueia operacao com resposta de erro tecnica.
5. Se valido: injeta metadados de consentimento no contexto da requisicao e libera fluxo.

### 5.3 Algoritmo de transicao de quarentena

1. Recebe atualizacao de consentimentos via endpoint de e-consentimento.
2. Atualiza estado de nos de consentimento no grafo.
3. Avalia regra:
   - existe REVOKED -> QUARANTINED
   - todos ACTIVE/GRANTED -> AVAILABLE
4. Aplica transicao em Neo4j e MongoDB.
5. Emite evento de notificacao para consumidores em tempo real.

---

## 6. Especificacoes Tecnicas Finais

### 6.1 Linguagens e frameworks

1. Backend: Node.js, Express.
2. Frontend: React + TypeScript.
3. Validacao: Zod e AJV.
4. Filas/processamento assincrono: Redis e BullMQ.

### 6.2 Persistencia e modelagem

1. Banco documental: MongoDB.
2. Banco de grafo: Neo4j.
3. Modelo hibrido: documental para estado transacional + grafo para inferencia e rastreabilidade relacional.

### 6.3 Comunicacao

1. REST para operacoes transacionais.
2. WebSocket para notificacoes de eventos de estado.

### 6.4 Seguranca

1. Autenticacao: JWT.
2. Camadas adicionais: MFA.
3. Protecao de dados pessoais: criptografia AES-256-GCM para campos sensiveis.
4. Auditoria de decisao etica por registros de bloqueio/liberacao.

### 6.5 Conformidade normativa

1. LGPD: controle de consentimento e revogacao com efeito operacional.
2. ISO 20387: rastreabilidade e custodia verificavel.
3. FHIR R4: interoperabilidade de recursos clinicos estruturados.

---

## 7. Reivindicacoes Tecnicas de Diferenciacao (Base Descritiva)

1. Integracao coordenada entre banco documental e banco de grafo com regra etica de pre-validacao antes da persistencia de linhagem.
2. Quarentena logica de amostras orientada por estado de consentimento com transicao bidirecional sincronizada entre dois modelos de dados.
3. Mecanismo de reconciliacao assincrona de eventos de linhagem com fila de quarentena topologica e tentativas controladas.
4. Ledger append-only com bloqueio de mutacao e encadeamento SHA-256 para verificacao de integridade historica.
5. Representacao de localizacao fisica como entidade topologica de custodia para reconstruir percurso da amostra.

---

## 8. Aplicabilidade Industrial

A solucao e aplicavel em ambientes de biobanco, laboratorios de referencia, centros de pesquisa clinica e hospitais que demandem:

1. bloqueio etico efetivo no nivel computacional,
2. trilha imutavel de custodia,
3. consistencia semantica de metadados clinicos,
4. resiliencia operacional diante de falhas transitorias de infraestrutura.

A implementacao atual demonstra viabilidade tecnica por meio de suites automatizadas de validacao fullstack e evidencia de operacao dos mecanismos descritos.

---

## 9. Observacao de Redacao para Deposito

Este memorial descreve a invencao em nivel tecnico-operacional, com foco em processo computacional de transformacao de informacao, sincronizacao de estados e garantia de integridade. Para peticao formal de patente, recomenda-se converter esta base em:

1. Relatorio descritivo final formatado conforme formulario do INPI.
2. Quadro de reivindicacoes em linguagem juridico-tecnica.
3. Resumo tecnico e figuras/fluxogramas numerados.
