# Arquitetura Tecnica - BioAvanceD

## Visao Geral

BioAvanceD e organizado em tres blocos principais:

- backend JavaScript/Node.js;
- frontend React/Vite;
- infraestrutura Docker com bancos e servicos auxiliares em containers.

## Backend

O backend e responsavel por:

- APIs REST;
- regras de dominio;
- autenticacao e autorizacao;
- persistencia;
- RCS-GOV 1.0;
- trilhas de auditoria;
- integridade e Merkle;
- comunicacao com bancos locais/containerizados.

Principais tecnologias:

- Node.js;
- Express;
- MongoDB;
- Redis;
- Neo4j;
- InfluxDB;
- Resend para e-mails.

## Frontend

O frontend e implementado com React, TypeScript e Vite. Ele consome os endpoints do backend e exibe dados operacionais de pacientes, amostras, consentimentos, qualidade RCS-GOV e rastreabilidade.

## Dados e Persistencia

- MongoDB: dados principais de pacientes, amostras, consentimentos, logs e referencias;
- Redis: filas/cache quando habilitados pelo backend;
- Neo4j: relacoes de linhagem e grafo quando aplicavel;
- InfluxDB: series temporais/telemetria quando aplicavel.

Todos esses servicos devem operar em containers no ambiente de auditoria.

## Qualidade e Governanca

A unica metodologia ativa de qualidade pre-analitica e RCS-GOV 1.0:

```text
RCS = 100 - Pbio
penalty_axis = weight x severity
```

A decisao final e `final_grade` A-E. Falha de governanca e nao compensavel e gera `final_grade = E`.

## Integridade

O sistema usa estruturas de integridade por hash, trilhas auditaveis e Merkle para apoiar verificacao de consistencia. Os resultados RCS-GOV incluem `calculation_trace` para reproducao e auditoria.

## Integracoes Externas

No perfil de auditoria, integracoes cloud externas sao desabilitadas. Resend e a unica integracao externa permitida, exclusivamente para envio de e-mail quando configurado.

## Sanitizacao

A arquitetura documentada nao depende de dados reais. Variaveis sensiveis devem ficar fora do repositorio e serem representadas apenas por exemplos sem segredo real.
