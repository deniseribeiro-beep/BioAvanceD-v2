# Registro de Testes Automatizados - BioAvanceD

Data: 2026-06-22  
Branch: `deploy/google-vm-post-inpi`  
Base: `main`

## Objetivo

Registrar a correção e a execução das suítes automatizadas do BioAvanceD, com ênfase na certificação metodológica RCS-GOV 1.0, no build estrito do frontend e nos fluxos E2E sem dependência de VM pública ou containers.

## Resultado Consolidado

As verificações previstas foram concluídas com sucesso:

- backend `test:ci` executado pelo Vitest, seguido dos scripts autônomos de segurança, consentimento e evidência de compliance;
- contrato RCS-GOV validado contra os catálogos S1/S2 e os 75 registros da S3;
- frontend integralmente aprovado pelo TypeScript em modo `strict` e pelo build Vite;
- Playwright aprovado em Chromium e Firefox, com 154 testes;
- smoke tests dependentes de VM externa removidos conforme decisão de escopo;
- testes unitários e de integração executados sem MongoDB, Neo4j ou InfluxDB reais.

## Execuções

| Suíte | Comando | Resultado | Evidência principal |
|---|---|---|---|
| RCS-GOV focal | `npx vitest run tests/unit/rcs-certification.service.test.js tests/integration/quality.preview.api.test.js` em `api/backend` | Aprovado | 2 arquivos e 26 testes aprovados. |
| Backend CI | `npm --prefix api/backend run test:ci` | Aprovado | Suíte Vitest integral, scripts autônomos e geração de `COMPLIANCE_EVIDENCE.json` concluídos com exit code 0. |
| Frontend Typecheck | `npm --prefix frontend run typecheck:full` | Aprovado | `tsc --noEmit` concluído sem erros com todo o diretório `src` sob `strict`. |
| Frontend Build | `npm --prefix frontend run build` | Aprovado | Vite processou 1.732 módulos e gerou o bundle de produção. |
| Frontend E2E | `npm --prefix frontend run test:e2e` | Aprovado | 154 testes aprovados em Chromium e Firefox. |

## Evidência RCS-GOV 1.0

O teste contratual `api/backend/tests/unit/rcs-reference-contract.test.js` valida de forma exaustiva:

- códigos dos catálogos SPREC fluidos S1 e sólidos S2;
- os 75 mapeamentos de severidade da S3;
- pesos dos eixos totalizando 100 por matriz;
- thresholds A-E;
- `RCS = 100 - Pbio` e `penalty = weight x severity`;
- gate de governança não compensável e rotas distintas de Grade E;
- valores `Unknown`, `Other`, inválidos e `Not scored` sem conversão para severidade zero;
- exigência de workflow para regras condicionais;
- idempotência dos seeds com banco falso em memória.

O serviço inclui os `rule_code` versionados das falhas de governança no `calculation_trace`. O resultado canônico e os campos sólidos são persistidos, e Grade E permanece bloqueada mesmo quando o gate de governança é aprovado.

## Correções Confirmadas

- `test:ci` deixou de executar specs Vitest diretamente com Node.
- O commit FHIR aceita apenas registros `READY_TO_COMMIT`; `TCLE_SENT`, `NEEDS_REVIEW` e consentimento pendente permanecem bloqueados.
- A importação, o intake e os relatórios usam os campos canônicos `rcs_score`, `final_grade`, `governance_status` e `grade_route`.
- Compatibilidade antiga permanece somente estrutural em `legacy_compat`, sem decisão operacional.
- A espera E2E de sugestões ORPHA foi vinculada à resposta real de `/dictionary/suggest`, eliminando a instabilidade no Firefox sem ampliar timeouts.

## Conclusão

O estado verificado nesta data atende ao plano de correção: RCS-GOV 1.0 permanece como fonte ativa de decisão de qualidade, o gate de governança e a política de release estão cobertos, e backend, typecheck, build e E2E passam sem serviços reais de infraestrutura nos testes automatizados.
