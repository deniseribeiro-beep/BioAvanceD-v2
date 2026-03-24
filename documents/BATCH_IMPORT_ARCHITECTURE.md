# Batch Import Architecture

## Visao Geral

A arquitetura de importacao em lote foi implementada como uma camada adicional ao fluxo legado de cadastro unitario. O objetivo e permitir ingestao massiva com isolamento de estagio, validacao assicrona e persistencia canonica, sem alterar os contratos atuais de `PatientService` e `SampleService`.

O fluxo segue o padrao:

### Upload -> Staging -> ETL via Chunks -> Canonical Store

### Objetivos da solucao

- Preservar os fluxos unitarios existentes.
- Reduzir impacto no banco por meio de chunking de 100 registros por vez.
- Classificar linhas em `VALID`, `PARTIAL` e `INVALID`.
- Reutilizar as regras de dominio ja existentes para persistencia.
- Oferecer rastreabilidade do lote por `jobId`, progresso e log de erros.

## Fluxo Implementado

### 1. Upload

O frontend envia o arquivo para `POST /api/import/batch`.

Nesta etapa:

- o arquivo e validado por extensao e mimetype;
- o upload bruto e salvo em area temporaria de staging;
- um documento `StagingImport` e criado com metadados do lote;
- o `jobId` e despachado para a fila BullMQ existente.

### 2. Staging

O documento `StagingImport` funciona como camada de controle do lote e registra:

- `jobId`
- `fileName`
- `status`
- `totalRows`
- `processedRows`
- `errors`
- `rawData`

O campo `rawData` guarda a referencia estavel do arquivo em disco, checksum logico e metadados tecnicos necessarios para auditoria e reprocessamento.

### 3. ETL via Chunks

O worker BullMQ consome o `jobId`, recupera o lote em staging e processa o arquivo em blocos de 100 linhas.

Durante o processamento:

- o lote e lido e particionado em chunks;
- cada linha e normalizada e classificada;
- registros validos ou parcialmente validos sao persistidos;
- erros criticos sao acumulados no documento de staging;
- o progresso e atualizado incrementalmente.

Essa estrategia reduz picos de escrita no banco e evita saturacao da camada de persistencia.

### 4. Canonical Store

Para os registros `VALID` e `PARTIAL`, a persistencia final ocorre na camada canonica ja existente do sistema, com reutilizacao das regras de negocio de:

- `PatientService.createPatient`
- `SampleService.createSample`

A camada de importacao nao substitui essas regras; ela apenas prepara, classifica e encaminha os dados para os servicos oficiais do dominio.

## Componentes Principais

### Backend

- `backend/src/models/StagingImport.js`
  - schema Mongoose isolado para controle do lote.
- `backend/src/controllers/import-batch.controller.js`
  - recebe upload, cria staging e expoe o status do lote.
- `backend/src/services/staging-import.service.js`
  - persiste o arquivo bruto, grava o staging e enfileira o job.
- `backend/src/services/batch-validation-engine.service.js`
  - executa validacao, classificacao e persistencia em chunks.
- `backend/src/workers/import-worker.js`
  - processa o job `batch-import` e atualiza o staging.

### Frontend

- `frontend/src/components/v2/ImportForm.jsx`
  - entrada da importacao em lote com upload e handoff para o viewer de progresso.
- `frontend/src/components/v2/BatchProgressViewer.jsx`
  - polling a cada 3 segundos, barra de progresso, resumo final e download do log de erros.
- `frontend/src/components/UI/ProgressBar.tsx`
  - barra visual de progresso do lote.

### Legado removido

- A tela antiga de importacao e o hook de polling foram substituidos pela camada v2 e nao devem mais receber manutencao.

## Modelo de Qualidade de Dados

O engine classifica cada linha da seguinte forma:

- `VALID`: registro sem pendencias e persistido com sucesso.
- `PARTIAL`: registro persistido com avisos de qualidade ou normalizacoes.
- `INVALID`: erro critico que impede persistencia.

Os avisos de qualidade sao usados para refletir divergencias que nao bloqueiam o dado, mas que precisam de visibilidade para curadoria posterior.

## Monitoramento e Rastreabilidade

O lote e acompanhado por polling no frontend, usando a consulta de status do `jobId` a cada 3 segundos.

O documento de staging registra:

- progresso em porcentagem;
- total de registros;
- registros processados;
- lista consolidada de erros;
- resumo final do lote.

Ao concluir, o usuario pode baixar o log de erros para auditoria e analise posterior.

## Aderencia Academica e Normativa

### DAMA-DMBOK

A solucao esta alinhada ao DAMA-DMBOK porque formaliza o ciclo de vida do dado em camadas de governanca e operacao:

- **Data Governance**: separacao entre staging, validacao e armazenamento canonico;
- **Data Quality Management**: classificacao de linhas, tratamento de avisos e registro de erros;
- **Data Integration and Interoperability**: ingestao assicrona por fila e transformacao controlada;
- **Metadata Management**: persistencia de metadados do lote em `StagingImport`;
- **Master and Reference Data Management**: uso dos servicos canonicos existentes como fonte oficial de persistencia.

### WANG & STRONG

O modelo de Wang e Strong define qualidade a partir da perspectiva do consumidor do dado, incluindo dimensoes como acuracia, completude, consistencia, atualidade e interpretabilidade.

A implementacao adota essa visao ao:

- validar campos obrigatorios antes da persistencia;
- classificar registros com advertencias de qualidade como `PARTIAL`;
- manter rastreabilidade linha a linha;
- registrar logs estruturados para analise posterior;
- preservar os servicos canonicos como fonte de verdade.

### HL7 FHIR

A camada canonica do sistema se beneficia da semantica FHIR por meio do uso de representacoes estruturadas para entidades clinicas, especialmente pacientes e amostras.

A aderencia ocorre porque:

- o lote nao cria uma nova semantica concorrente para o dominio;
- a importacao encaminha os dados para a camada de persistencia oficial;
- a normalizacao prepara os dados para estruturas canonicas compatíveis com interoperabilidade;
- a separacao entre staging e canonical store facilita mapeamento futuro para recursos FHIR R4.

## Referencias ABNT

WANG, R. Y.; STRONG, D. M. Beyond accuracy: what data quality means to data consumers. Journal of Management Information Systems, 1996.

KIMBALL, R.; ROSS, M. The Data Warehouse Toolkit. 3. ed. Wiley, 2013.

DIXON, J. Pentaho, Hadoop, and Data Lakes. Pentaho Blog, 2010.

DAMA INTERNATIONAL. DAMA-DMBOK. 2. ed. 2017.

FELLEGI, I. P.; SUNTER, A. B. A theory for record linkage. JASA, 1969.

EUROPEAN COMMISSION. Turning FAIR into reality. 2018.

HL7 INTERNATIONAL. FHIR Release 4 (R4). 2019.

CHAPMAN, P. et al. CRISP-DM 1.0. SPSS Inc., 2000.

KREPS, J. et al. Kafka: a distributed messaging system for log processing. NetDB, 2011.

WHITE, T. Hadoop: The Definitive Guide. O’Reilly, 2015.

GARTNER, Inc. Master Data Management (MDM). 2023.

## Conclusao

A arquitetura implementada separa ingestao, staging, validacao e persistencia canonica de forma incremental e escalavel, com baixo acoplamento ao fluxo legado. Isso permite evolucao futura para novas fontes, novas regras de qualidade e eventual exportacao/interoperabilidade em padroes de saude sem comprometer a operacao corrente.
