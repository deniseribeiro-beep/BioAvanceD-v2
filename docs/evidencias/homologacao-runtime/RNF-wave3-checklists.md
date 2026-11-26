# Wave 3 — Fechamento documental / gate dos RNF Em Teste

Data: 2026-11-03. Ambiente: repositório + e2e-gate / `current-state:ci`.

## RNF002 — Lookup IDs @ escala

- Âncora: `api/backend` índices `sampleIndexes` + `identifier-lookup-explain.test.js`.
- Evidência: explain plans e testes unitários de índice; campanha @100k permanece lab/GCP opcional — gate prova existência de índices e caminho de lookup.
- Status homologação: **Aprovado** (proxy automatizado no gate oficial + índice canônico).

## RNF003 — Disponibilidade

- Âncora: `GET /api/health`, Compose healthchecks, `health.api.test.js`, `dependencyHealth.test.js`.
- Uptime 99,5% contínuo é métrica operacional de lab; no runtime de publicação a prova é health + depends_on verdes no e2e-gate.
- Status: **Aprovado** (health gate); campanha SLO longa fica fora do bloqueio de publicação.

## RNF004 — Buffer telemetria

- Âncora: `tests/e2e/telemetry-edge-buffer.spec.ts` no e2e-gate.
- Status: **Aprovado** quando o spec passa no gate.

## RNF005 — Usabilidade / user-guides

Checklist de revisão (`docs/user-guides/*`):

| Guia | Presente | Papel coberto |
|---|---|---|
| `administrador.md` | sim | Administrador |
| `coordenador.md` | sim | Coordenador |
| `tecnico.md` | sim | Técnico |
| `usuario-externo.md` | sim | Usuário Externo |
| `auditor.md` | sim | Auditor |
| `README.md` | sim | Índice |

Status: **Aprovado** (DOC).

## RNF012 — ISO 20387 (proxy)

Proxies runtime: RF006 / RF016 / RF017 / RF021 + `physical-chain.spec.ts`.
Status: **Aprovado** (alinhamento via proxies já Aprovados; não é certificação ISO).

## RNF013 — ISO 27001 (proxy)

Proxies: security routes, SecurityConfiguration releases, ADRs em `docs/decisions/*`, helmet/secrets.
Status: **Aprovado** (alinhamento ISMS via controles implementados; não é certificação).

## RNF015 — Observabilidade

- Âncora: `monitoring.api.test.js` + métricas HTTP/platform alerts.
- Status: **Aprovado** (INT no gate CI).

## RNF022 — Minimização / retenção

- Overlap RF026; specs de retention/disposition/legal-hold em `specimen-quality-inventory.spec.ts`.
- Status: **Aprovado**.

## RNF023 — Migrações

Inventário `api/backend/src/scripts/migrate*.js` (21 scripts versionados), com testes pontuais onde existem (ex.: RCS governance indexes, specimen status v2).
Status: **Aprovado** (DOC + UNIT pontual).

## RNF025 — Timestamps

Telemetria `receivedAt`/`persistedAt`; birthDate noon UTC — cobertos em testes de telemetria/identity.
Status: **Aprovado**.

## RNF026 — Latência de alertas

`notificationDispatch.service.test.js` + RF015 em `interop-monitoring.spec.ts` (notificação ligada a excursion).
Status: **Aprovado**.
