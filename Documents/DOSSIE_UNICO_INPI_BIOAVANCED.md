# Dossie Unico INPI - BioAvanceD

## 1. Identificacao do Documento

- Projeto: BioAvanceD
- Finalidade: Consolidacao unica de informacoes tecnicas para deposito no INPI
- Data de fechamento: 01 de Abril de 2026
- Versao do dossie: 1.0
- Repositorio: deniseribeiro-beep/BioAvanceD
- Branch de referencia: main

## 2. Hash de Integridade para Envio

- Algoritmo: SHA-256
- Escopo da assinatura: conteudo entre os marcadores "INICIO_CONTEUDO_ASSINADO" e "FIM_CONTEUDO_ASSINADO"
- Hash SHA-256 do conteudo assinado: 342b1bb9837e90cefeee075c05ac29b8cde4a50ed7be7cdd7100bceb6588b877

Observacao tecnica: o hash assina o bloco tecnico principal e evita ambiguidade de integridade no protocolo de envio.

---

INICIO_CONTEUDO_ASSINADO

## 3. Campo da Invencao e Problema Tecnico

### 3.1 Campo tecnico

A invencao se insere no dominio de sistemas computacionais para biobancos e dados clinicos, com foco em governanca etica de amostras, consistencia semantica de metadados e rastreabilidade imutavel de cadeia de custodia.

### 3.2 Problemas tecnicos tratados

1. Inconsistencia semantica de dados clinicos
- Dados de diagnostico frequentemente sao inseridos em texto livre, sem relacao computavel com ontologias clinicas.
- Efeito tecnico adverso: perda de interoperabilidade e inferencia clinica inconsistente.

2. Falha de bloqueio etico operacional
- Consentimento tratado apenas como registro documental, sem bloqueio em runtime do acesso a amostra.
- Efeito tecnico adverso: risco de operacao sobre amostra sem consentimento valido.

3. Fragilidade de trilha de custodia
- Historico de movimentacao mantido em estruturas mutaveis sem encadeamento criptografico.
- Efeito tecnico adverso: baixa confiabilidade de auditoria e verificacao retroativa.

## 4. Nucleo Inventivo: Arquitetura Poliglota Coordenada

### 4.1 Estrutura de dados e papeis tecnicos

1. MongoDB (estado documental/transacional)
- Pacientes, amostras, consentimentos, eventos operacionais.

2. Neo4j (estado relacional/topologico)
- Relacoes clinicas (diagnostico, fenotipo, biomarcadores) e custodia com contexto de posicao.

Nucleo inventivo: sincronizacao de regras de negocio entre estado documental e estado de grafo, com validacao etica pre-persistencia e recuperacao assincrona de falhas transitorias.

## 5. Inovacao 1: Motor Semantico em Cascata

### 5.1 Algoritmo de inferencia relacional

Entrada estruturada (system, code, display) aciona travessia em grafo:
1. Patient -> Disease (ORPHA)
2. Disease -> Phenotype_HPO
3. Phenotype_HPO -> Biomarker

Efeito tecnico: substitui correlacao manual por inferencia topologica computavel, aumentando coerencia semantica e qualidade de consulta.

## 6. Inovacao 2: Quarentena Logica com Autorizacao Etica

### 6.1 Middleware authConsent

Funcao tecnica: gate de autorizacao em runtime, com verificacao de:
1. Extracao de patientID.
2. Existencia de consentimento ativo.
3. Escopo de consentimento requerido.
4. Ausencia de revogacao.

Se qualquer validacao falhar, bloqueio tecnico por HTTP 400/403/503 antes da operacao em amostra.

### 6.2 Maquina de estado etico da amostra

Estados relevantes:
- QUARANTINED
- AVAILABLE
- PARTIAL
- DEPLETED
- UNAVAILABLE

Transicoes implementadas:
1. Revogacao detectada -> status QUARANTINED (Neo4j + MongoDB)
2. Consentimentos requeridos em ACTIVE/GRANTED -> QUARANTINED para AVAILABLE (Neo4j + MongoDB)

Efeito tecnico: isolamento logico imediato e reversivel, sincronizado entre os dois bancos.

## 7. Inovacao 3: Auto-recuperacao Topologica (TopologicalQuarantine)

### 7.1 Algoritmo de resiliencia

1. Falha de persistencia no Neo4j em modo permissivo.
2. Serializacao do evento e enfileiramento no Redis.
3. Worker periodico reprocessa em lotes (maxBatchSize).
4. Controle de tentativas (maxAttempts) com metrica de sucesso/falha/descartes.
5. Reconciliacao quando o grafo retorna.

Efeito tecnico: preservacao de continuidade de linhagem sem perda silenciosa de eventos.

## 8. Inovacao 4: Ledger Imutavel de Cadeia de Custodia

### 8.1 Encadeamento SHA-256

Para cada evento de movimentacao E_n:
1. Obtem H_(n-1) do evento anterior da mesma amostra.
2. Calcula H_n = SHA256(payload canonico de E_n + H_(n-1)).
3. Persiste chainPrevHash = H_(n-1) e chainHash = H_n.

### 8.2 Politica append-only

A colecao de movimentos possui bloqueio de operacoes mutantes (update/delete/replace), preservando historico cronologico e verificabilidade de integridade.

Efeito tecnico: trilha de custodia resistente a adulteracao retroativa.

## 9. Fluxo Narrativo de Dados (Pipeline Tecnico)

1. Ingestao Smart Import (CSV/FHIR).
2. Validacao estrutural por schema (Zod/AJV), com rejeicao de diagnostico em texto livre fora do formato canonico.
3. Persistencia documental no MongoDB.
4. Persistencia relacional/topologica no Neo4j.
5. Registro de evento inicial no ledger com hash encadeado.
6. Aplicacao de politica de consentimento em runtime nas operacoes subsequentes.
7. Emissao de identificacao operacional (DataMatrix) para rastreabilidade fisica.

## 10. Especificacoes Tecnicas

- Backend: Node.js + Express
- Frontend: React + TypeScript
- Persistencia: MongoDB + Neo4j
- Fila e processamento assincrono: Redis + BullMQ
- Comunicacao: REST + WebSockets
- Seguranca: JWT + MFA + criptografia AES-256-GCM para campos sensiveis
- Conformidade tecnica reportada: LGPD, ISO 20387, FHIR R4

## 11. Evidencias de Implementacao e Validacao

### 11.1 Componentes tecnicos relevantes

- backend/src/infrastructure/middleware/authConsent.js
- backend/src/routes/eConsent.js
- backend/src/infrastructure/queue/TopologicalQuarantine.js
- backend/src/utils/sampleMovementLedger.js
- backend/src/infrastructure/database/neo4j/LineageRepository.js

### 11.2 Evidencias documentais internas

- Documents/MEMORIAL_DESCRITIVO_INPI.md
- Documents/RESUMO_TECNICO_INPI.md
- Documents/Arquitetura_de_Software.md
- Documents/VALIDATION_QUARANTINE_COC.md
- Documents/IMPLEMENTATION_CRITICAL_GAPS.md
- Documents/AUDIT_REPORT_FINAL.md

### 11.3 Evidencias de teste (estado reportado)

- Backend: 44+ testes aprovados
- Frontend E2E: 7 testes aprovados
- Total consolidado: 51+ testes

## 12. Reivindicacoes Tecnicas Descritivas (Base)

1. Integracao coordenada MongoDB + Neo4j para sincronizacao de estado etico e semantico.
2. Quarentena logica bidirecional orientada por consentimento, aplicada em runtime e persistencia.
3. Reconciliacao assincrona de eventos topologicos via fila de quarentena com retentativa controlada.
4. Ledger append-only com hash encadeado SHA-256 para verificacao de integridade historica.
5. Modelagem de localizacao de custodia como entidade relacional para rastreabilidade de percurso.

## 13. Aplicabilidade Industrial

A solucao e aplicavel em biobancos, hospitais, laboratorios clinicos e centros de pesquisa que exijam:
1. bloqueio etico operacional de acesso,
2. integridade semantica de metadados clinicos,
3. rastreabilidade imutavel de cadeia de custodia,
4. resiliencia a falhas transitorias da camada de grafo.

## 14. Declaracao de Fechamento

Este dossie consolida, em documento unico, os elementos tecnicos relevantes para instrucao de deposito junto ao INPI, com hash de integridade para verificacao independente.

FIM_CONTEUDO_ASSINADO

---

## 15. Procedimento de Verificacao da Hash

1. Extrair o bloco entre os marcadores de conteudo assinado.
2. Codificar em UTF-8.
3. Aplicar SHA-256.
4. Comparar com o valor informado na Secao 2.
