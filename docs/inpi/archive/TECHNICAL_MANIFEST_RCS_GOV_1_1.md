# Manifesto Tecnico - BioAvanceD v1.1.0

## Arquitetura

BioAvanceD v1.1.0 utiliza frontend React/TypeScript, backend Node.js/Express, persistencia documental em MongoDB, grafo/rastreabilidade em Neo4j, filas/cache em Redis, series temporais em InfluxDB e orquestracao por Docker Compose. O motor metodologico preservado e RCS-GOV 1.0.

## Modulos

- Autenticacao, sessoes e RBAC.
- Pacientes, amostras e Intake Wizard.
- RCS-GOV como metodologia principal de certificacao.
- Importacao FHIR R4 Bundle JSON por staging.
- TCLE/e-consent, Consent Builder e envio por Resend.
- Quarentena etica e operacional.
- Auditoria, logs, Merkle/integridade e cadeia de custodia.
- Armazenamento, etiquetas, sensores/IoT, telemetria e temperatura.
- Incidentes, relatorios, backup e terminologias.
- Orphadata/HPO e redundancia local.
- Sincronizacao MongoDB -> Neo4j.

## Tecnologias

- JavaScript;
- TypeScript;
- Node.js;
- Express;
- React;
- Playwright;
- Vitest;
- Docker Compose.

## Bancos e servicos

- MongoDB;
- Neo4j;
- Redis;
- InfluxDB;
- Resend para e-mail transacional de TCLE;
- MQTT opcional quando houver broker configurado.

## Scripts

O projeto contem scripts de deploy, smoke test, validacao de ambiente, seeds metodologicos e rotinas auxiliares. Seeds metodologicos S1/S2/S3 e admin seed inicial devem ser preservados conforme controle de versao.

## Testes

- Testes unitarios de backend.
- Testes de integracao de backend.
- Testes E2E de frontend.
- Smoke test de VM.
- Testes focados em RCS-GOV, FHIR/staging, TCLE, amostras, pacientes, CORS e health check.

## Documentacao

- Memorial descritivo.
- Resumo para registro.
- Inventario tecnico.
- Guia de importacao FHIR/Excel.

## Itens excluidos

O pacote oficial nao deve conter `.git`, `node_modules`, `dist`, `build`, `coverage`, `playwright-report`, `test-results`, `.env`, `.env.docker` real, logs, uploads, backups, dumps de banco, secrets, tokens ou chaves privadas.

## Ausencia de segredos

Este manifesto nao inclui segredos, tokens, chaves privadas, senhas reais, URIs sensiveis ou valores reais de ambiente.
