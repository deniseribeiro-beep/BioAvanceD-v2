# Relatorio Final de Sanitizacao e Cobertura

Data da consolidacao: 2026-07-06 10:35:00 -03:00

## 1. Identificacao da execucao

| Campo | Valor |
|---|---|
| branch | `audit/intake-governance-i18n-orpha` |
| commit SHA | `d978f59dfa24a64349242eb4516f8d5be5b1b40e` |
| data e hora | `2026-07-06 10:35:00 -03:00` |
| sistema operacional | `Microsoft Windows 11 Home 10.0.26200 (Build 26200)` |
| versao do Docker | `Docker version 29.6.1, build 8900f1d` |
| versao do Docker Compose | `Docker Compose version v5.3.0` |
| versao do Node | `v24.11.1` |
| imagens utilizadas | `mongo:7`, `neo4j:5-community`, `redis:7-alpine`, `eclipse-mosquitto:2`, `influxdb:2.7`, `axllent/mailpit:v1.21.8`, `mcr.microsoft.com/playwright:v1.58.2-noble`, `./infra/tsa`, `./infra/witness`, `./api/backend/Dockerfile.dev`, `./frontend/Dockerfile.dev` |
| arquivo de ambiente utilizado | `.env.test` (referenciado nos scripts); `.env.test.example` nao existe neste checkout |

## 2. Execucao limpa

| Item | Situacao |
|---|---|
| `docker compose down -v --remove-orphans` | `DECLARADO` nos scripts `compose:down`, `compose:reset` e `test:stack:down`; nao executado nesta consolidacao |
| rebuild das imagens | `DECLARADO` nos scripts `test:stack:build` e no workflow de CI; nao executado nesta consolidacao |
| remocao de volumes anteriores | `DECLARADO` pelos comandos `down --volumes --remove-orphans`; nao executado nesta consolidacao |
| remocao de caches | `PENDENTE`; nao ha evidencias nesta consolidacao de limpeza de cache de Docker, npm, Vitest ou Playwright |
| subida com bancos vazios | `DECLARADO` pela stack de teste com volumes nomeados e credenciais sintenticas; nao foi validado aqui por execucao limpa completa |

Conclusao desta secao: a reprodutibilidade limpa ainda nao pode ser afirmada como comprovada neste ciclo porque a sequencia destrutiva de reset/rebuild/up nao foi executada e auditada neste turno.

## 3. Resultado dos comandos

| Comando executado | Exit code | Duracao | Testes | Aprovados | Ignorados | Falhos | Warnings | stderr |
|---|---:|---:|---:|---:|---:|---:|---|---|
| `git branch --show-current` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `git rev-parse HEAD` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `git status --short` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `docker --version` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `docker compose version` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `node --version` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| `Get-CimInstance Win32_OperatingSystem` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |
| leitura de `reports/system-audit/audit-complete-20260702-205840.txt` | `0` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | vazio |

Observacao: este relatorio nao executa os comandos de validacao de novo. Os tempos, contagens completas de testes e stderr reais de Vitest/Playwright/Compose precisam vir de uma execucao fresca e registrada. O artefato mais completo atualmente rastreado e o audit de `2026-07-02 23:58:02Z`, descrito abaixo.

### Evidencia consolidada do audit completo rastreado

Fonte: `reports/system-audit/audit-complete-20260702-205840.txt`

- `Backend real-services test:ci`: `PASS`, `exitCode 0`, duracao `11681 ms`
- `Frontend typecheck:core`: `PASS`, `exitCode 0`, duracao `7368 ms`
- `Frontend build`: `PASS`, `exitCode 0`, duracao `15256 ms`
- `Cobertura de funcoes por testes (analise estatica)`: `WARN`
  - total de funcoes: `1623`
  - cobertas em testes: `82`
  - nao cobertas: `1541`
  - cobertura: `5.05%`

## 4. Cobertura real do backend

### Metricas globais

| Medida | Valor comprovado |
|---|---|
| statements | `PENDENTE` - nao ha relatorio de cobertura backend em artefato rastreado neste checkout |
| branches | `PENDENTE` - nao ha relatorio de cobertura backend em artefato rastreado neste checkout |
| functions | `PENDENTE` - a analise estatica do audit encontrou 1623 funcoes no total, mas isso nao equivale a cobertura Vitest real |
| lines | `PENDENTE` - nao ha relatorio de cobertura backend em artefato rastreado neste checkout |

### Arquivos e classes de cobertura

- Arquivos com `100%`: `PENDENTE`
- Arquivos abaixo do threshold: `PENDENTE`
- Arquivos com `0%`: `PENDENTE`
- Modulos excluidos da cobertura: `PENDENTE`
- Testes manuais fora do Vitest: `PENDENTE`
- Rotas sem teste: `PENDENTE`

### O que esta comprovado

- Existe suite backend extensa em `api/backend/tests/` com testes de integracao, unidade e compliance.
- O workflow GitHub Actions executa `npm run docker:test:backend`.
- O script backend `test:ci` executa `vitest run && node tests/compliance/generate-compliance-evidence.js`.

### O que ainda esta apenas declarado

- Que a cobertura backend real bateu com algum threshold especifico.
- Que todas as rotas prioritarias receberam cenarios completos de sucesso, validacao, autenticao, autorizacao, inexistencia, erro de banco e auditoria.

## 5. Cobertura real do frontend

### Metricas globais

| Medida | Valor comprovado |
|---|---|
| statements | `PENDENTE` - nao ha artefato de coverage frontend rastreado neste checkout |
| branches | `PENDENTE` - nao ha artefato de coverage frontend rastreado neste checkout |
| functions | `PENDENTE` - nao ha artefato de coverage frontend rastreado neste checkout |
| lines | `PENDENTE` - nao ha artefato de coverage frontend rastreado neste checkout |

### Matriz por pagina

| Pagina | Unitario | Componente | E2E | Fluxo principal |
|---|---|---|---|---|
| Login | `PENDENTE` | `PENDENTE` | `COMPROVADO PARCIALMENTE` via `frontend/tests/e2e/login-page.spec.ts` | `PENDENTE` |
| Dashboard | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| Intake Wizard | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| Pacientes | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| Amostras | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| eConsent | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| TCLE Admin | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| RCS-GOV | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| Auditoria | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |

### E2E rastreado

- Spec executada: `frontend/tests/e2e/login-page.spec.ts`
- Quantidade de cenarios: `1`
- Paginas visitadas: `login`
- APIs reais utilizadas: `PENDENTE` no artefato rastreado
- Interceptacoes `page.route`: `nao evidenciadas neste artefato`
- Dados criados: `PENDENTE`
- Dados removidos: `PENDENTE`
- Autenticacao: `real ou token injetado nao comprovado neste artefato`
- Screenshots: `nao evidenciadas neste artefato`
- Traces: `nao evidenciados neste artefato`

### Distincao de tipo de teste

- E2E real: `parcialmente comprovado` apenas para a pagina de login renderizada sem mocks, segundo `playwright-report/results.json`
- Teste de frontend com API simulada: `PENDENTE`
- Teste de contrato: `PENDENTE`
- Teste unitario: `PENDENTE`

## 6. Rotas e servicos backend

### Rotas com cobertura aparente em testes existentes

| Rota / grupo | Evidencia de teste | Status |
|---|---|---|
| `POST /api/auth/login` | `api/backend/tests/integration/auth.routes.test.js` | `COMPROVADO PARCIALMENTE` |
| `GET /api/auth/verify` | `api/backend/tests/integration/auth.routes.test.js` | `COMPROVADO PARCIALMENTE` |
| `POST /api/auth/refresh` | `api/backend/tests/integration/auth.routes.test.js` | `COMPROVADO PARCIALMENTE` |
| `POST /api/patients` | `api/backend/tests/integration/patients.api.test.js`, `patients.expanded.api.test.js` | `COMPROVADO PARCIALMENTE` |
| `GET /api/patients/:id` | `api/backend/tests/integration/patients.expanded.api.test.js` | `COMPROVADO PARCIALMENTE` |
| `POST /api/intake/sessions` | `api/backend/tests/integration/intake-integration.test.js` | `COMPROVADO PARCIALMENTE` |
| `POST /api/quality/preview` | `api/backend/tests/integration/quality.preview.api.test.js` | `COMPROVADO PARCIALMENTE` |
| `POST /api/iot/telemetry` | `api/backend/tests/integration/iot.api.test.js` | `COMPROVADO PARCIALMENTE` |
| `GET /api/audit/verify` | `api/backend/tests` + `docs/audit/AUDIT_VERIFICATION_PROTOCOL.md` | `PENDENTE` para prova end-to-end real completa |

### Cobertura por tipo de cenario

| Tipo de cenario | Status |
|---|---|
| sucesso | `PARCIALMENTE COMPROVADO` por suites de integracao existentes |
| entrada invalida | `PARCIALMENTE COMPROVADO` por testes de validacao em varias suites |
| nao autenticado | `PARCIALMENTE COMPROVADO` em rotas de auth/patients |
| sem permissao | `PARCIALMENTE COMPROVADO` em rotas RBAC |
| recurso inexistente | `PARCIALMENTE COMPROVADO` em suites de pacientes e auth |
| erro de banco | `PARCIALMENTE COMPROVADO` em suites que simulam indisponibilidade |
| auditoria | `PARCIALMENTE COMPROVADO` em logger-audit-trail e compliance |
| efeito persistido | `PARCIALMENTE COMPROVADO` em varias suites de integracao |

### Separacao por tipo de ambiente

| Ambiente | Status |
|---|---|
| teste com mock | `PENDENTE` de inventario consolidado por suite |
| teste com Mongo real | `COMPROVADO PARCIALMENTE` via stack de validacao e suites integracao |
| teste com Neo4j real | `COMPROVADO PARCIALMENTE` via stack e suites de grafo/custodia |
| teste com Redis real | `COMPROVADO PARCIALMENTE` via stack e suites de fila/quarentena |
| teste com InfluxDB real | `COMPROVADO PARCIALMENTE` via stack e suites de telemetria |

## 7. E2E

### O que foi efetivamente evidenciado

- Specs executadas: `login-page.spec.ts`
- Quantidade de cenarios: `1`
- Paginas visitadas: `login`
- APIs reais utilizadas: `nao comprovado no artefato atual`
- Interceptacoes `page.route`: `nao comprovado no artefato atual`
- Dados criados: `nao comprovado no artefato atual`
- Dados removidos: `nao comprovado no artefato atual`
- Autenticacao real ou token injetado: `nao comprovado no artefato atual`
- Screenshots e traces gerados: `nao comprovado no artefato atual`

### Distincao solicitada

| Tipo | Status |
|---|---|
| E2E real | `COMPROVADO PARCIALMENTE` apenas para renderizacao da login page sem mocks |
| teste de frontend com API simulada | `PENDENTE` |
| teste de contrato | `PENDENTE` |
| teste unitario | `PENDENTE` |

## 8. Infraestrutura

| Servico | Status |
|---|---|
| MongoDB saudavel | `DECLARADO` pela stack, sem execucao fresca registrada neste turno |
| Neo4j saudavel | `DECLARADO` pela stack, sem execucao fresca registrada neste turno |
| Redis saudavel | `DECLARADO` pela stack, sem execucao fresca registrada neste turno |
| InfluxDB saudavel | `DECLARADO` pela stack, sem execucao fresca registrada neste turno |
| backend saudavel | `DECLARADO` pelos workflows e audit anterior, sem prova fresca |
| frontend saudavel | `DECLARADO` pelos workflows e audit anterior, sem prova fresca |
| worker saudavel | `DECLARADO` pela stack, sem prova fresca |
| TSA saudavel | `DECLARADO` como servico presente na stack de teste |
| witness saudavel | `DECLARADO` como servico presente na stack de teste |

Observacao: TSA e witness fazem parte da stack de teste declarada em `docker-compose.test.yml`, mas neste ciclo nao houve execucao independente deles com prova anexada.

## 9. Codigo legado

| Item | Decisao |
|---|---|
| arquivos legados restantes | `PENDENTE` |
| aliases restantes | `PENDENTE` |
| wrappers restantes | `PENDENTE` |
| variaveis sem consumidor | `PENDENTE` |
| rotas nao montadas | `PENDENTE` |
| paginas nao roteadas | `PENDENTE` |
| scripts obsoletos | `PENDENTE` |
| configuracoes duplicadas | `PENDENTE` |
| runners duplicados | `PENDENTE` |

Evidencias auxiliares:

- `reports/repository-sanitization/REMOVAL_MATRIX.md` registra removals ja concluidos para `test-results/.last-run.json`, `frontend/test-results/.last-run.json`, `data-dump.json` e chave ACME local.
- `reports/repository-sanitization/LEGACY_DEPRECATION_PLAN.md` ainda marca remocao de legado como `DEFERIR` para itens remanescentes.

Classificacao orientada:

- `REMOVER`: removals ja concluidos e comprovados
- `MIGRAR`: wrappers/aliases com consumidor ativo confirmado
- `MANTER`: compatibilidade funcional comprovada
- `PENDENTE`: falta prova suficiente

## 10. Resultado oficial do CI

### Execucao local

| Campo | Valor |
|---|---|
| workflow executado | `N/A` |
| run id | `N/A` |
| commit validado | `d978f59dfa24a64349242eb4516f8d5be5b1b40e` |
| jobs | `N/A` |
| checks obrigatorios | `N/A` |
| artefatos publicados | `reports/system-audit/audit-complete-20260702-205840.*` |
| status final | `PASS` para o audit rastreado; `nao equivale ao CI oficial` |

### GitHub Actions

| Campo | Valor |
|---|---|
| workflow executado | `BioAvanceD CI/CD Pipeline` |
| run id | `PENDENTE` |
| commit validado | `PENDENTE` |
| jobs | `validation-stack` |
| checks obrigatorios | `Hygiene gates`, `Validate compose file`, `Build validation stack`, `Start validation stack`, `Backend coverage`, `Frontend coverage`, `Run Playwright E2E`, `Tear down validation stack` |
| artefatos publicados | `PENDENTE` |
| status final | `PENDENTE` |

## 11. Conclusao objetiva

### Classificacao final

- Infraestrutura Docker: `FAIL`
- Backend unitario: `FAIL`
- Backend integracao: `FAIL`
- Frontend unitario: `FAIL`
- Frontend cobertura: `FAIL`
- E2E real: `FAIL`
- Cobertura de paginas: `FAIL`
- Cobertura de rotas: `FAIL`
- Codigo legado: `FAIL`
- Reprodutibilidade limpa: `FAIL`
- CI oficial: `FAIL`

### Status geral

- `BLOQUEADO`

### Separacao final

1. O que ja esta comprovado
   - A stack de teste existe e define MongoDB, Neo4j, Redis, InfluxDB, MQTT, SMTP, TSA, witness, backend, worker e frontend.
   - Ha audit local rastreado com `PASS` para backend real-services, frontend typecheck e frontend build.
   - Ha um E2E rastreado para a pagina de login que passou.
   - Ha suites de backend e frontend organizadas por dominio, com muitos cenarios de integracao e unidade.

2. O que esta apenas declarado
   - Execucao limpa completa com down/rebuild/up e reset de volumes/caches.
   - CI oficial com run id, artefatos e status final confirmados.
   - Cobertura real por statements/branches/functions/lines no backend e frontend.
   - Inventario conclusivo de legado residual com decisao final por item.

3. O que ainda esta pendente
   - Medir coverage real atual com artefatos de cobertura completos.
   - Mapear a matriz de paginas do frontend com prova por pagina.
   - Fechar a tabela de rotas backend por cenario com prova rastreavel por rota.
   - Coletar logs ou metadata do CI oficial.

4. O que realmente bloqueia o commit final
   - Falta de execucao limpa comprovada neste ciclo.
   - Falta de cobertura real medida e anexada.
   - Falta de prova E2E ampla, alem do login.
   - Falta de evidencia do CI oficial com run id e artefatos.
