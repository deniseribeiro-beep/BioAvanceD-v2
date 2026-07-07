# Inventario Tematico - Fase 0

## Objetivo

Registrar os pontos de busca exigidos pelo congelamento de referencia e destacar onde existem sinais de bootstrap, seeds, legacy e configuracoes duplicadas.

## Achados principais

### seed / seeder / bootstrap

- Os scripts `seed:*` do backend foram removidos.
- O diretório `src/seeders/` foi substituído por `src/reference-data/`.
- O bootstrap automático no startup foi removido; restam apenas migrations estruturais e testes explícitos.

### fixtures / legacy / aliases / wrappers

- `fixtures` aparece sobretudo como termo de teste ou suporte historico, não como fluxo principal de runtime.
- `legacy` e `aliases` aparecem em adaptadores, compatibilidade e normalização de payload.
- `wrappers` surge mais como padrao arquitetural do que como diretório dedicado.

### configuracoes duplicadas

- Existem arquivos de configuração paralelos no nivel raiz, frontend e backend:
  - `compose.yml`
  - `compose.dev.yml`
  - `compose.test.yml`
  - `compose.prod.yml`
  - `.env.docker.example`
  - `.env.test.example`
  - `.env.production.example`
  - `frontend/vite.config.js`
  - `frontend/vitest.config.js`
  - `frontend/playwright.config.ts`
  - `api/backend/vitest.config.js`
- A duplicidade aqui não implica erro por si só, mas exige registro unico na matriz de decisão.

## Referencias documentais

- `docs/inventory/BIOAVANCED_INVENTORY.md`
- `docs/inventory/BIOAVANCED_INVENTORY_CHECKLIST.md`
- `docs/inventory/FREEZE_SNAPSHOT_FASE_0.md`
- `docs/inventory/DECISION_MATRIX_FASE_0.md`

## Observacao

Este inventario é descritivo e não executa limpeza. Qualquer remocao posterior deve ocorrer em novo ciclo, mantendo este snapshot como referencia historica.
