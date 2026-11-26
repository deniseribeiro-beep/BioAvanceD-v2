# Checklist — Binding UI ↔ API/Mongo (Fase B)

| Campo | Valor |
|---|---|
| Data | 2026-11-04 |
| Instrumento | `tests/e2e/ui-mongo-binding.spec.ts` (+ specs UI existentes no e2e-gate) |
| Objetivo | Provar que a SPA exibe valores vindos da API/Mongo, não apenas que a tela carrega |

## Jornadas cobertas

| Tela | Assert | Spec / evidência |
|---|---|---|
| `/samples` lista | `specimenId` e tipo da API aparecem na linha | `ui-mongo-binding.spec.ts` |
| `/samples/:id` detalhe | título/corpo contêm `specimenId` da API | `ui-mongo-binding.spec.ts` |
| `/patients` | linha do participante criado via API | `ui-mongo-binding.spec.ts` |
| `/access-requests` | fluxo UI completo AC1–AC6 | `access-requests-ui.spec.ts` |
| `/facility-management` sensores/políticas | CRUD UI ↔ API | `sensor-registration.spec.ts`, `temperature-policies-ui.spec.ts` |
| `/results` import job | botão Ver / Relatório ↔ job API | `results-import-job-view.spec.ts` |
| `/next/intake` | wizard ↔ persistência | `intake-wizard.spec.ts` |

## Fora de evidência visual de fluxo (API-only)

Conforme ADR `docs/decisions/2026-10-23-w8-showcase-scope.md`:

- Disposition actions (`/api/disposition-actions`) — sem UI
- Physical-chain labels/scan (`/api/physical-chain`) — sem UI de cadeia completa
- Custody assignment — sem UI dedicada

Esses fluxos permanecem cobertos no e2e-gate por specs API (`physical-chain.spec.ts`, retention/disposition em `specimen-quality-inventory.spec.ts`).

## Critério de aceite

- Specs da coluna “Spec” passam no e2e-gate (ou run Playwright focado pós-gate).
- Screenshots estáticos **não** substituem este checklist.

## Status 2026-11-04

Instrumentos commitados (`tests/e2e/ui-mongo-binding.spec.ts`). Gate GCP **verde** (`E2E_GATE_EXIT=0`, 402 passed) após fix #1440 (nofile + WT cache). Jornadas UI do gate (samples, patients, intake, access-requests, facility, results) cobrem o contrato de binding nas specs correlatas; este spec permanece para regressão focada.
