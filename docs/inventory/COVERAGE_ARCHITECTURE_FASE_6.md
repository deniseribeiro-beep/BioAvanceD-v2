# Fase 6 - Cobertura e arquitetura de testes

## Status atual

- Há infraestrutura de cobertura configurada para backend e frontend.
- Ainda não existem métricas reais executadas no repositório para esta turnê.
- O E2E atual cobre apenas um fluxo de login básico.

## Gaps que ainda precisam de suíte dedicada

### Backend
- Rotas sem contrato explícito completo para sucesso, inválido, auth ausente, papel insuficiente, inexistência, conflito, indisponibilidade, auditoria, persistência e idempotência.
- Fluxos críticos sem cobertura total instrumentada.
- Serviços críticos ainda precisam de testes unitários com thresholds reais por módulo.

### Frontend
- Nem todas as páginas roteadas têm cobertura de loading, vazio, erro, permissão permitida/negada, interação principal e acessibilidade básica.

### E2E
- Falta cobrir login real, refresh de sessão, paciente, Intake Wizard, amostra, TCLE, aceite, revogação, quarentena, liberação, movimentação, cadeia de custódia, FHIR, RCS-GOV e auditoria.
- E2E real não deve usar `page.route()` para mockar backend.

## Arquitetura aplicada

- `api/backend/vitest.config.js`: threshold 100% para módulos críticos e reporter de coverage ligado.
- `frontend/vitest.config.js`: threshold geral mínimo de 90/90/90/85.
- Root `test:coverage` delega para backend e frontend.

## Próximo passo necessário

- Criar suites de contrato por rota backend.
- Completar suites de página no frontend.
- Separar E2E real de qualquer teste isolado de frontend que use interceptação/mocks.
