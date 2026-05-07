# Guia de Execucao Docker - BioAvanceD-v2

## Objetivo

Este guia descreve a execucao minima do BioAvanceD em Docker para revisao tecnica. Nao inclui segredos reais.

## Pre-Requisitos

- Docker Engine;
- Docker Compose v2;
- portas locais livres para backend, frontend e containers auxiliares;
- arquivo `.env.docker` criado a partir de exemplo sem segredos reais.

## Servicos

- `backend`: Node.js/Express com APIs;
- `frontend`: React/Vite;
- `mongodb`: banco principal;
- `redis`: cache/fila;
- `neo4j`: grafo/linhagem;
- `influxdb`: telemetria/series temporais.

## Variaveis

Manter em `.env.docker` local, nunca versionado:

- credenciais MongoDB;
- segredos JWT;
- chaves de criptografia;
- credenciais Neo4j;
- token InfluxDB;
- parametros Redis;
- URL de API e frontend;
- `RESEND_API_KEY`, se envio real de e-mail for necessario.

## Subir Ambiente

```bash
docker compose --env-file .env.docker -f docker-compose.yml up --build backend frontend
```

## Rodar Seeds RCS-GOV

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run migrate:rcs
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run seed
```

Os seeds preservam S1, S2, S3, pesos, thresholds A-E e regras de governanca.

## Confirmar Execucao

Frontend:

```bash
curl -I http://localhost:5173
```

Backend:

```bash
curl -I http://localhost:3000
```

Logs:

```bash
docker compose --env-file .env.docker -f docker-compose.yml logs -f backend frontend
```

Parar:

```bash
docker compose --env-file .env.docker -f docker-compose.yml down
```

## Linux em Nuvem

Em servidor Linux, expor publicamente apenas as portas necessarias. Bancos, Redis, Neo4j, InfluxDB e inspector Node devem ficar protegidos por firewall ou rede privada. Ajustar URLs, CORS e HMR conforme dominio, IP ou proxy reverso.

## Integracoes

Cloud externa deve permanecer desabilitada no perfil de auditoria. Resend e a unica integracao externa permitida.
