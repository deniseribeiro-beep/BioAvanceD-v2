# Inventario de Arquivos para Registro - BioAvanceD v1.1.0

## Escopo

Este inventario acompanha a versao BioAvanceD v1.1.0 para novo congelamento INPI, preservando o motor metodologico RCS-GOV 1.0.

## Pastas incluidas

- `api/backend`: backend Node.js/Express, rotas, controllers, services, models, middlewares, configuracoes, seeds e testes.
- `frontend`: frontend React/TypeScript, views/pages, componentes, services/api, contexts, hooks, tipos e testes E2E.
- `docs`: documentacao tecnica, INPI, deploy, importacao FHIR/Excel e inventario.
- `scripts`: scripts versionados de deploy, validacao e smoke test.
- raiz do repositorio: Docker Compose, arquivos de exemplo, configuracoes e metadados do projeto.

## Documentacao incluida

- `INPI_MEMORIAL_DESCRITIVO.md`;
- `RESUMO_REGISTRO_INPI_V1_1_0.md`;
- `RCS_GOV_1_0_SPEC.md`;
- `ARQUITETURA_TECNICA.md`;
- `DECLARACAO_SANITIZACAO.md`;
- `MANIFESTO_HASH.md`;
- `INVENTARIO_ARQUIVOS_REGISTRO.md`;
- `CHANGELOG_INPI_V1_1_0.md`;
- `PLANO_CONGELAMENTO_INPI_V1_1_0.md`.

## Modulos principais

- autenticacao/RBAC;
- pacientes;
- amostras;
- Intake Wizard;
- RCS-GOV 1.0;
- importacao FHIR em lote;
- staging;
- TCLE/e-consent;
- Consent Builder;
- quarentena etica/operacional;
- etiquetas;
- auditoria/logs;
- Merkle/integridade;
- storage;
- sensores/IoT;
- telemetria/temperatura;
- incidentes;
- relatorios;
- terminologias, Orphadata e HPO;
- MongoDB, Neo4j, Redis, InfluxDB;
- Docker/VM.

## Pastas e arquivos excluidos

- `.git`;
- `.env`;
- `.env.docker` real;
- `node_modules`;
- `dist`;
- `build`;
- `coverage`;
- `playwright-report`;
- `test-results`;
- logs;
- uploads;
- backups;
- dumps;
- tokens;
- chaves;
- secrets;
- dados reais.

## Ausencia de segredos

Este inventario nao inclui valores reais de ambiente, credenciais, tokens, senhas, URIs sensiveis ou hashes ficticios.
