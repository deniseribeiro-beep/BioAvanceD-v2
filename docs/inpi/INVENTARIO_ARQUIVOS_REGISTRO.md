# Inventario de Arquivos para Registro

## Escopo

Inventario minimo dos grupos de arquivos recomendados para o pacote de Registro de Programa de Computador INPI do BioAvanceD.

## Codigo-Fonte

- backend Node.js/JavaScript;
- frontend React/TypeScript;
- configuracoes Docker;
- scripts de seed e migrations metodologicas;
- testes automatizados pertinentes;
- documentacao tecnica.

## Backend

Incluir arquivos de:

- controllers, routes e services;
- models/entities;
- middlewares;
- utils;
- seeders RCS-GOV;
- scripts de migracao RCS-GOV;
- testes automatizados sem dependencia obrigatoria de containers.

## Frontend

Incluir arquivos de:

- componentes React;
- views/pages;
- hooks;
- services/api;
- tipos TypeScript;
- configuracoes Vite e TypeScript.

## RCS-GOV 1.0

Preservar:

- S1: catalogo SPREC fluido;
- S2: catalogo SPREC solido;
- S3: severidades intraeixo;
- pesos dos eixos;
- thresholds A-E;
- regras de governanca;
- `calculation_trace`.

## Integridade

Preservar arquivos relacionados a:

- Merkle;
- hash de auditoria;
- trilhas de movimentacao;
- rastreabilidade de amostras;
- logs sanitizados.

## Exclusoes

Nao incluir:

- `.env` real;
- tokens;
- API keys;
- JWT secrets reais;
- senhas;
- URIs reais de banco;
- dumps de banco;
- dados pessoais reais;
- `node_modules`;
- caches, builds temporarios e logs locais.
