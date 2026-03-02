# Relatório de Testes Automatizados

- Projeto: BioAvanceD
- Data: 2026-03-02
- Responsável técnico: GitHub Copilot (GPT-5.3-Codex)
- Escopo da rodada: execução reprodutível de backend CI, suíte E2E frontend, auditoria consolidada e expansão de cobertura comparativa STRICT/PERMISSIVE

## 1) Objetivo

Consolidar evidências desta rodada para anexação no dossiê técnico do INPI, com foco em:

- Reprodutibilidade da execução automatizada
- Rastreabilidade de artefatos (logs e relatórios)
- Validação funcional ponta a ponta da interface
- Transparência de riscos/lacunas operacionais

## 2) Execuções Realizadas

### 2.1 Backend (CI)

Comando executado:

- `npm --prefix backend run test:ci`

Resultado observado:

- Status geral: APROVADO
- Subsuíte `merkleTree`: aprovado
- Subsuíte `integrityCheckService.mock`: placeholder (skip esperado)
- Subsuíte `auditRoot.service mock`: aprovado
- Suítes Vitest de integração comparativa (`sample.api`, `sample.mode.contract`, `users.register-sample`): aprovadas na esteira
- Suíte unitária de segurança: 18/18 aprovados
- Suíte `authConsent`: 9/9 aprovados

Evidência gerada:

- `reports/system-audit/backend-testci-2026-03-02.log`

### 2.2 Frontend E2E (Playwright)

Comando executado:

- `npm --prefix frontend exec playwright test`

Resultado observado:

- 11 testes executados
- 11 testes aprovados
- 0 falhas
- Duração total aproximada: 42.2s

Evidências geradas:

- `reports/system-audit/playwright/results.json`
- `reports/system-audit/playwright/html/index.html`
- traces em `reports/system-audit/playwright/test-results/**/trace.zip`

### 2.3 Auditoria Consolidada do Sistema

Comando executado:

- `node scripts/audit-complete-system.js`

Resultado observado:

- Status geral: PASS
- PASS para estrutura mínima, scripts de auditoria, backend test:ci, frontend typecheck e frontend build
- WARN para cobertura de funções por testes (análise estática)

Evidências geradas:

- `reports/system-audit/audit-complete-20260302-105535.json`
- `reports/system-audit/audit-complete-20260302-105535.txt`

### 2.4 Backend Integração de Amostras (Vitest)

Comando executado:

- `Push-Location backend; npx vitest run test/integration/sample.api.test.js; Pop-Location`

Resultado observado:

- 1 arquivo de teste executado
- 3 testes executados
- 3 testes aprovados

Cenários validados:

- Smart Blocking com modo `STRICT`
- Topological Quarantine com fallback e sucesso parcial
- `STRICT_MODE_BLOCKED` com HTTP 403 em condição de Doença Rara + Neo4j offline

Evidência gerada:

- `reports/system-audit/backend-sample-api-vitest-2026-03-02.log`

### 2.5 Backend Integração — Matriz STRICT/PERMISSIVE e Paridade de Rota

Comando executado:

- `Push-Location backend; npx vitest run test/integration/sample.mode.contract.api.test.js test/integration/users.register-sample.api.test.js test/integration/sample.api.test.js; Pop-Location`

Resultado observado:

- 3 arquivos de teste executados
- 10 testes executados
- 10 testes aprovados

Cobertura adicional validada:

- Matriz de decisão com `isRareDisease`, `riskScore` e `LINEAGE_MODE` (`fail-open`/`fail-closed`)
- Contrato de resposta em `/api/samples` (campos `operationMode`, `topology`, `partialSuccess`)
- Paridade de comportamento na rota alternativa `/api/users/register-sample`
- Cenário permissivo degradado sem quarentena (sem falso sucesso parcial)

Evidência gerada:

- `reports/system-audit/backend-strict-permissive-matrix-2026-03-02.log`

## 3) Verificação de Cenários Críticos para INPI

### Cenários cobertos nesta rodada

- Robustez de testes backend em esteira CI
- Fluxos E2E principais de autenticação e cadastro
- Rastreabilidade de execução com artefatos estruturados

### Regularização de execução Vitest

Foi aplicado ajuste de compatibilidade no include do Vitest para contemplar `test/**` e `tests/**`, viabilizando execução reprodutível da suíte de integração de amostras nesta mesma rodada.

Arquivo ajustado:

- `backend/vitest.config.js`

### Automação na esteira CI

As suítes comparativas STRICT/PERMISSIVE e de paridade de rota foram incorporadas ao script padrão `test:ci`, eliminando execução manual como pré-requisito para as próximas rodadas.

Arquivo ajustado:

- `backend/package.json`

### Regularização de contrato na rota alternativa

Foi corrigida inconsistência funcional em `POST /api/users/register-sample`, que anteriormente retornava payload sem os campos observáveis de modo operacional. A rota passou a expor `operationMode`, `topology`, `partialSuccess` e status HTTP `202` em sucesso parcial, alinhada ao comportamento de `/api/samples`.

Arquivo ajustado:

- `backend/src/interface/routes/user.routes.js`

## 4) Rastreabilidade de Evidências

### Artefatos gerados nesta data

- `reports/system-audit/backend-testci-2026-03-02.log`
- `reports/system-audit/playwright/results.json`
- `reports/system-audit/playwright/html/index.html`
- `reports/system-audit/playwright/test-results/**/trace.zip`
- `reports/system-audit/audit-complete-20260302-105535.json`
- `reports/system-audit/audit-complete-20260302-105535.txt`
- `reports/system-audit/backend-sample-api-vitest-2026-03-02.log`
- `reports/system-audit/backend-strict-permissive-matrix-2026-03-02.log`

## 5) Conclusão da Rodada

- Backend CI: APROVADO
- Frontend E2E: APROVADO (11/11)
- Backend integração de amostras (Vitest): APROVADO (3/3)
- Backend matriz STRICT/PERMISSIVE + paridade de rota: APROVADO (10/10)
- Auditoria consolidada: PASS (com 1 alerta de cobertura estática)
- Resultado consolidado da rodada: APROVADO

## 6) Próximos Passos Recomendados (INPI)

- Manter publicação de artefatos JSON/TXT/Playwright em `reports/system-audit` a cada rodada
- Monitorar tendência do alerta de cobertura estática da auditoria consolidada para evolução incremental da defesa técnica
