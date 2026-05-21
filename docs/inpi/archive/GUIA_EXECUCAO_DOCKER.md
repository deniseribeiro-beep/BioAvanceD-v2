# Guia de Execucao Docker - BioAvanceD v1.1.0

## Escopo

Este guia descreve a execucao Docker do BioAvanceD v1.1.0 para ambiente de VM/deploy, sem incluir segredos reais.

- Branch de deploy atual: `deploy/google-vm-post-inpi`
- Futura branch de congelamento: `release/inpi-v1.1.0-rcs-gov`
- Tag futura: `v1.1.0-inpi-rcs-gov`
- Frontend VM atual: http://34.60.170.17:5173
- Backend VM atual: http://34.60.170.17:3000

## Pre-requisitos

- Docker Engine;
- Docker Compose v2;
- arquivo `.env.docker` local criado a partir de exemplo;
- portas liberadas conforme ambiente;
- nenhum `.env` real versionado.

## Servicos esperados

- `backend`: Node.js/Express;
- `frontend`: React/Vite;
- `mongodb`: banco documental;
- `redis`: cache/fila;
- `neo4j`: grafo/rastreabilidade;
- `influxdb`: series temporais.

## Comandos Docker Compose

Subir ambiente:

```bash
docker compose --env-file .env.docker -f docker-compose.yml up --build backend frontend
```

Subir em segundo plano:

```bash
docker compose --env-file .env.docker -f docker-compose.yml up -d --build
```

Ver logs:

```bash
docker compose --env-file .env.docker -f docker-compose.yml logs -f backend frontend
```

Parar:

```bash
docker compose --env-file .env.docker -f docker-compose.yml down
```

## Health check

Backend local:

```bash
curl -i http://localhost:3000/api/health
```

Backend publico da VM:

```bash
curl -i http://34.60.170.17:3000/api/health
```

Frontend local:

```bash
curl -I http://localhost:5173
```

Frontend publico da VM:

```bash
curl -I http://34.60.170.17:5173
```

## CORS

Validar origem publica do frontend:

```bash
curl -i -H "Origin: http://34.60.170.17:5173" http://localhost:3000/api/health
```

O retorno esperado deve incluir `Access-Control-Allow-Origin: http://34.60.170.17:5173`. Recomenda-se manter `CORS_ALLOW_ALL=false`.

## Variaveis e segredos

Nao commitar `.env`, `.env.docker` real, tokens, chaves, senhas ou URIs sensiveis. Usar apenas arquivos `.example` para documentacao.
