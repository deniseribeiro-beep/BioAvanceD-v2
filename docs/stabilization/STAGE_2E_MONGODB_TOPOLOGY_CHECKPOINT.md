# Stage 2E — checkpoint MongoDB topology canônica v2

## Escopo

Fecha o checkpoint WIP `wip(v2): checkpoint Stage 2E MongoDB topology migration` na branch `stabilize/v2.0.0-prototype`.

Não confundir com Item 8 “Stage 2E-1” (classificação de branches de coverage) em [`ITEM_8_BRANCH_95_RECONCILIATION.md`](ITEM_8_BRANCH_95_RECONCILIATION.md).

## O que esta etapa estabelece

- Registry de **140** entidades Mongo derivadas do workbook aprovado (`canonicalEntityCollections.v2.js`).
- Migração de topologia: rename legado → canônico, create das coleções required, preflight e verify (`mongoTopologyV2.js`).
- Identidade `UserAccount`: UUID `userAccountId` + refs; **fail-closed** se `Actor` não resolvido (`userAccountIdentityMigrationV2.js`).
- Seed estável do Actor de sistema antes do apply (`systemActorSeedV2.js`).
- Ciclo de índices canônicos: **74** active / **6** deferred (`mongoIndexLifecycleV2.js` + manifesto).
- Orquestração Foundation: `F1.1a` dry-run → `F1.1b` system Actor → `F1.3a` apply → `F1.4a/b` índices.
- Gate arquitetural permanente contra `db.collection('<legado>')` fora dos módulos de migração.
- Scripts one-shot e `config/collections.js` alinhados aos nomes canônicos (sem `COLL_*` env).
- Checks de drift workbook ↔ registry ↔ manifesto no `current-state:ci`.

## Critérios numéricos

| Check | Critério |
| --- | --- |
| `verifyTopology` | 140 entidades, `missing=[]`, `remainingLegacy=[]` |
| `runIndexLifecycle` | `ready === true` (74 índices `requiredForReadiness`) |
| Architecture | inclui `mongo-canonical-topology.arch.test.js` |
| Generators | `canonical:collections:check` e `canonical:indexes:check` |

## Evidência de validação (fechamento)

Executado localmente no worktree de fechamento:

1. `npm run test:architecture` → **172/172** pass (inclui gate Stage 2E).
2. `npm run canonical:collections:check` → pass.
3. `npm run canonical:indexes:check` → pass.
4. Unitários de topologia / identidade / Actor / índices / Foundation (happy path + bloqueiostopology conflict + `CANONICAL_INDEX_NOT_READY`) → pass.
5. Scripts migrate* one-shot e `createFirstAdmin` → pass.

Foundation greenfield (DB limpo) fica coberto pelo happy path de `foundation-v2.service.coverage.test.js`, que exerce `runTopology` + `runIndexLifecycle` até readiness. Contas legadas sem `actorId` continuam bloqueadas por desenho (`DATA_MIGRATION_CONFLICT`) — remediação pré-apply, sem inventar Actor.

## Pré-requisito de cutover com dados legados

Antes de `runFoundationV2` apply em um DB com `users`/`patients`/etc.:

- Não pode haver source **e** target presentes para o mesmo rename.
- Cada `UserAccount` deve ter `actorId` UUID resolvível em `actors`.
- Identificadores canônicos (UUID onde exigido) devem ser válidos ou o preflight estrutural bloqueia.

## Regra de fechamento

Este documento encerra a **Stage 2E (topologia Mongo)**. Não encerra a Wave 2 / issue #1132 nem o marco Item 8 de coverage 95%.

HEAD deste checkpoint: `e66e2a56de21ad2291c090e76dd45fc3af2209fe` (`feat(v2): complete Stage 2E MongoDB topology migration`).
