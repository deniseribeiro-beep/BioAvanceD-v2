# P1-5 — Hardening de Imutabilidade em Nível de Banco (sample_movements)

Data: 2026-03-18  
Escopo: reforço de imutabilidade fora da aplicação para ledger `sample_movements`.

## Objetivo

Garantir que o usuário de aplicação possua apenas capacidade de **append** (`insert`) e leitura no ledger de movimentações, reduzindo risco de mutação indevida por credencial comprometida ou uso administrativo incorreto.

## 1) Pré-requisitos

- Ambiente MongoDB com privilégios administrativos para criar/atualizar roles e usuários.
- Variáveis de ambiente configuradas no backend:
  - `MONGO_URI`
  - `MONGO_DB`
  - `MONGO_AUTH_DB` (opcional, padrão `admin`)
  - `MONGO_APP_USERNAME` (opcional para grant automático)

## 2) Execução assistida

1. Rodar em modo de simulação (`dry-run`, padrão):

```bash
node backend/scripts/enforce-sample-movements-append-only-role.js
```

2. Aplicar mudanças efetivas:

```bash
APPLY_CHANGES=1 node backend/scripts/enforce-sample-movements-append-only-role.js
```

> Em Windows PowerShell:

```powershell
$env:APPLY_CHANGES = '1'
node .\backend\scripts\enforce-sample-movements-append-only-role.js
Remove-Item Env:APPLY_CHANGES
```

## 3) Escopo da role criada

Role padrão: `sampleMovementsAppendOnlyRole`  
Privilégios no recurso `sample_movements`:

- `find`
- `insert`
- `createIndex`
- `listIndexes`

Sem privilégios de mutação destrutiva (`update`, `delete`, `findAndModify`, `dropCollection`).

## 4) Verificação recomendada

- Validar que eventos novos continuam sendo gravados em `sample_movements`.
- Confirmar que chamadas mutáveis diretas falham para o usuário de aplicação.
- Verificar consistência do hash encadeado (`chainPrevHash` / `chainHash`) após a mudança.

## 5) Complemento WORM operacional

Para fechamento total de P1-5, complementar com:

- Política de retenção/backup imutável no storage de snapshots.
- Controle de acesso administrativo com MFA e trilha de auditoria para operações de role.
- Procedimento de “break-glass” formal com aprovação dupla para qualquer exceção.

## 6) Rollback controlado

- Reatribuir temporariamente role anterior do usuário de aplicação (se houver incidente operacional).
- Registrar incidente e executar post-mortem antes de retornar para perfil permissivo.
- Reaplicar role append-only após correção.