# Relatório de Correção de Vulnerabilidades

- Projeto: BioAvanceD
- Data: 2026-03-02
- Finalidade: evidência técnica de remediação de vulnerabilidades para anexação ao dossiê INPI

## 1) Escopo da Correção

Foi executada correção de segurança no backend para tratar vulnerabilidades de alta severidade identificadas por ferramentas de análise de dependências.

## 2) Correções Aplicadas

### 2.1 Remoção definitiva de dependência vulnerável

- Dependência removida: `xlsx` (SheetJS)
- Motivo: alerta recorrente de vulnerabilidades de alta severidade associado ao pacote
- Substituição aplicada: `exceljs@^4.4.0`

Arquivos funcionais migrados de `xlsx` para `exceljs`:

- `backend/src/services/import-lgpd.service.js`
- `backend/src/services/import-async.service.js`
- `backend/src/services/log.service.js`
- `backend/src/controllers/import-lgpd.controller.js`

### 2.2 Hardening adicional de dependências

- `multer` atualizado para `^2.1.0`
- Overrides de `minimatch` atualizados para versões corrigidas

Arquivo ajustado:

- `backend/package.json`

Lockfile atualizado:

- `backend/package-lock.json`

## 3) Validação Pós-Correção

### 3.1 Auditoria de dependências

Comandos executados:

- `npm --prefix backend install`
- `npm --prefix backend audit --json`

Resultado observado:

- `found 0 vulnerabilities`

### 3.2 Regressão funcional

Comando executado:

- `npm --prefix backend run test:ci`

Resultado observado:

- Esteira concluída com sucesso
- Suítes comparativas STRICT/PERMISSIVE e paridade de rota executadas
- Sem regressão funcional detectada

Evidência de execução:

- `reports/system-audit/backend-testci-2026-03-02.log`

## 4) Conclusão

A vulnerabilidade associada ao pacote `xlsx` foi tratada de forma **definitiva** no backend por remoção da dependência e migração funcional para `exceljs`, com validação de segurança (`0 vulnerabilities`) e validação de regressão automática (`test:ci` aprovado).
