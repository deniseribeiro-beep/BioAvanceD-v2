# Status dos itens solicitados por Denise

**Pergunta original (2026-07-27):** já temos algum resultado prévio de algum
item abaixo?

Este arquivo é o rastreador vivo dessa pergunta — atualizar o status de cada
item conforme houver progresso, em vez de reabrir a investigação do zero.
Cada item tem: **Status**, **Evidência atual** (arquivos concretos) e
**Próximo passo** (o que falta para fechar).

Legenda de status: `EXISTE` (evidência real e verificável) / `PARCIAL`
(existe mas mockado/incompleto/não roda contra stack real) / `AUSENTE`
(nada encontrado).

---

## 1. Aprovação dos testes automatizados

**Status:** EXISTE

~324 arquivos de teste (unit/integration/architecture/compliance) no
backend via Vitest. Último reconcile de cobertura (2026-07-24, commit
`a636b37a`): Statements 94.01%, Branches 88.2%, Functions 92.33%, Lines
94.29%. Meta fixada por Dennis em 2026-07-22: 90% nas quatro dimensões.

**Próximo passo:** nenhum — item fechado, só manter atualizado a cada
reconcile de cobertura.

---

## 2. Execução de fluxos com dados sintéticos

**Status:** PARCIAL

Testes e2e Playwright cobrem fluxos como cadastro de amostra e intake
wizard (`tests/e2e/cadastro-amostra.spec.ts`, `tests/e2e/intake-wizard.spec.ts`),
mas rodam contra backend mockado. Só `tests/e2e/backend-integration.spec.ts`
fala com API/DB real, e é **pulado por padrão** (`test.skip(!apiBaseURL, ...)`)
— só roda via `npm run test:e2e:docker` contra o stack Docker Compose real.

**Próximo passo:** rodar `npm run test:e2e:docker` e registrar o resultado
real aqui (hoje não temos essa execução documentada, só a existência do
teste).

---

## 3. Integração entre serviços e persistências

**Status:** EXISTE

Testes de integração cobrem Mongo/Neo4j (`MongoStorageRepository.test.js`,
`LineageRepository.test.js`, `Neo4jQuarantineService.test.js`) e há suíte
e2e via Docker Compose dedicada a isso.

**Próximo passo:** nenhum — item fechado.

---

## 4. Publicação, consumo e rastreamento de eventos

**Status:** AUSENTE (como mensageria assíncrona)

Não há Kafka/RabbitMQ/pubsub no código. O que existe é uma fila topológica
interna (`api/backend/src/infrastructure/queue/TopologicalQuarantine.js`)
com testes unitários — não é o mesmo conceito de "rastreamento de eventos"
em barramento de mensagens.

**Próximo passo:** confirmar com Denise o que ela quer dizer por "eventos"
— pode ser que se refira aos eventos de linhagem/auditoria (itens 5 e 7,
já cobertos) em vez de mensageria. Não avançar implementação até
esclarecer (design-call).

---

## 5. Reconstrução da linhagem donor–sample–event

**Status:** EXISTE

`api/backend/src/infrastructure/database/neo4j/LineageRepository.js`,
`ILineageRepository`, `graphProjection.service.js`, com testes unitários
(`LineageRepository.test.js`) e uso em `AllocateSampleUseCase`/
`ReleaseSampleUseCase` (registro de custódia com actorId/reason).

**Próximo passo:** nenhum — item fechado.

---

## 6. Aplicação de consentimento e bloqueio de operações incompatíveis

**Status:** EXISTE

`authConsent.js` (middleware), com testes: `consent.service.unit.test.js`,
`authConsent.test.js`, `consent-integration.test.js`,
`fhir-import-staging-consent.service.test.js`.

**Próximo passo:** nenhum — item fechado.

---

## 7. Registro de eventos de auditoria

**Status:** EXISTE

`audit-logger.unit.test.js`, `logger-audit-trail.test.js`,
`audit.api.test.js`. Citado como evidência formal de compliance
(`appendImmutableAudit`) em `COMPLIANCE_EVIDENCE.json`.

**Próximo passo:** nenhum — item fechado.

---

## 8. Detecção de excursões de temperatura

**Status:** EXISTE (correção de 2026-07-27 — o levantamento inicial estava
errado)

O levantamento original buscou pela palavra literal "excursion/excursão" e
não achou nada; a lógica real vive em
`api/backend/src/services/temperature.service.js` (`checkPolicyAndAlert`)
com teste dedicado em
`api/backend/tests/unit/temperature.service.test.js` — caso explícito
"inserts an alert and notifies when the reading is outside policy
thresholds", cobrindo leitura fora da política → alerta criado → 
notificação disparada. Modelo (`TemperatureModel.shouldGenerateAlert`) e
`TemperatureIncidentModel` também têm cobertura em
`sensor-temperature-policy-incident.models.test.js`. Confirmado rodando
`npx vitest run tests/unit/temperature.service.test.js
tests/unit/sensor-temperature-policy-incident.models.test.js` — 34/34
testes passando (2026-07-27).

**Próximo passo:** nenhum — item fechado.

---

## 9. Acionamento de quarentena

**Status:** EXISTE, bem coberto

`cold-chain-quarantine.service.test.js`,
`equipment-sensor-quarantine.service.test.js`,
`Neo4jQuarantineService.test.js`, `topologicalQuarantine.lifecycle.test.js`,
`topologicalQuarantine.observability.test.js`.

**Próximo passo:** nenhum — item fechado.

---

## 10. Integração do RCS ao fluxo de qualificação

**Status:** EXISTE

`api/backend/src/services/rcs-certification.service.js`,
`rcs-reference-data.js`, com testes:
`rcs-certification.service.test.js`,
`rcs-certification.service.unit.test.js`,
`rcs-reference-contract.test.js`.

**Próximo passo:** nenhum — item fechado.

---

## 11. Validação estrutural de recursos FHIR

**Status:** EXISTE

`fhir-validator.service.test.js`, `fhir.service.unit.test.js`,
`fhir-import.test.js`, mais teste de arquitetura dedicado
(`fhir-boundary.arch.test.js`). Citado em `COMPLIANCE_EVIDENCE.json`
como GAP8-HL7-FHIR-R4, status PASSED.

**Próximo passo:** nenhum — item fechado.

---

## 12. Medições exploratórias de latência e tempo de processamento

**Status:** AUSENTE

Nenhum arquivo de benchmark/latência encontrado no repositório.

**Próximo passo:** decidir com Denise/Dennis se vale a pena investir
nisso agora (design-call) — se sim, definir escopo mínimo (quais
endpoints/fluxos medir) antes de implementar.

---

## Resumo executivo

| # | Item | Status |
|---|------|--------|
| 1 | Testes automatizados | EXISTE |
| 2 | Fluxos com dados sintéticos | PARCIAL |
| 3 | Integração serviços/persistências | EXISTE |
| 4 | Publicação/consumo/rastreamento de eventos | AUSENTE (mensageria) |
| 5 | Linhagem donor–sample–event | EXISTE |
| 6 | Consentimento / bloqueio incompatível | EXISTE |
| 7 | Auditoria | EXISTE |
| 8 | Excursão de temperatura | EXISTE |
| 9 | Quarentena | EXISTE |
| 10 | RCS na qualificação | EXISTE |
| 11 | Validação estrutural FHIR | EXISTE |
| 12 | Latência/tempo de processamento | AUSENTE |

**Itens abertos que precisam de decisão de Denise/Dennis antes de avançar:**
item 4 (esclarecer definição de "eventos") e item 12 (definir se e o que
medir).

**Itens abertos que só precisam de trabalho técnico (sem design-call):**
item 2 (rodar e documentar a suíte Docker real).

*Última atualização: 2026-07-27 — item 8 corrigido para EXISTE após
verificação direta do código de serviço (o levantamento inicial só
buscou pela palavra literal "excursion" e não achou a lógica real).*
