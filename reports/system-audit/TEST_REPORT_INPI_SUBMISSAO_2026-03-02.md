# Relatório de Submissão INPI (Versão Congelada)

- Projeto: BioAvanceD
- Data de congelamento: 2026-03-02
- Finalidade: pacote de evidências técnicas para protocolo de Modelo de Utilidade
- Escopo da rodada: backend CI, integração de API de amostras (Vitest), matriz STRICT/PERMISSIVE com paridade de rota, E2E frontend (Playwright) e auditoria consolidada

## 1) Status Consolidado da Rodada

- Backend CI: **APROVADO**
- Backend integração API de amostras (Vitest): **APROVADO (3/3)**
- Backend matriz STRICT/PERMISSIVE + paridade de rota: **APROVADO (10/10)**
- Frontend E2E (Playwright): **APROVADO (11/11)**
- Auditoria completa do sistema: **PASS**

Conclusão consolidada: **APROVADO para anexação técnica**, com alerta não bloqueante de cobertura estática identificado na auditoria consolidada.

## 2) Evidência de Funcionamento Diferencial

A rodada inclui validação explícita dos comportamentos críticos para defesa técnica:

- Smart Blocking em modo `STRICT`
- Topological Quarantine com fallback controlado
- `STRICT_MODE_BLOCKED` com bloqueio esperado (HTTP 403)
- Paridade de contrato observável entre `/api/samples` e `/api/users/register-sample`

Evidência principal:

- `reports/system-audit/backend-sample-api-vitest-2026-03-02.log`

## 3) Índice Oficial de Artefatos (Anexos)

### 3.1 Relatórios de referência

- `reports/system-audit/TEST_REPORT_2026-03-02.md`
- `reports/system-audit/TEST_REPORT_EXECUTIVO_2026-03-02.md`

### 3.2 Logs de execução backend

- `reports/system-audit/backend-testci-2026-03-02.log`
- `reports/system-audit/backend-sample-api-vitest-2026-03-02.log`
- `reports/system-audit/backend-strict-permissive-matrix-2026-03-02.log`

### 3.3 Evidências E2E frontend

- `reports/system-audit/playwright/results.json`
- `reports/system-audit/playwright/html/index.html`
- `reports/system-audit/playwright/test-results/**/trace.zip`

### 3.4 Auditoria consolidada

- `reports/system-audit/audit-complete-20260302-105535.json`
- `reports/system-audit/audit-complete-20260302-105535.txt`

## 4) Checklist de Protocolo INPI

- [x] Relatório técnico da rodada emitido
- [x] Relatório executivo da rodada emitido
- [x] Execução backend CI registrada com log
- [x] Execução de integração de API crítica registrada com log
- [x] Matriz comparativa STRICT/PERMISSIVE registrada com log
- [x] Paridade de contrato entre rotas críticas validada automaticamente
- [x] Execução dessas suítes integrada à esteira `backend test:ci`
- [x] Execução E2E registrada com resultado estruturado
- [x] Evidências de trace E2E preservadas
- [x] Auditoria consolidada (JSON/TXT) anexada
- [x] Conclusão técnica consolidada da rodada documentada

## 5) Controle de Congelamento

- Arquivo de congelamento: `reports/system-audit/TEST_REPORT_INPI_SUBMISSAO_2026-03-02.md`
- Esta versão deve ser tratada como referência oficial da rodada de 2026-03-02 para anexação no dossiê.
- Novas execuções devem gerar novo arquivo de submissão com data própria, preservando histórico.

Registro de automação da esteira:

- Script atualizado: `backend/package.json` (`test:ci` com inclusão da matriz STRICT/PERMISSIVE e paridade de rota)
