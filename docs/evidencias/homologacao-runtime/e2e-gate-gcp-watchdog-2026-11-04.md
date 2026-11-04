# Resumo sanitizado — e2e-gate GCP watchdog (2026-11-04)

| Campo | Valor |
|---|---|
| VM | `instance-20261029-155615` / `us-central1-a` |
| Scripts | `scripts/e2e-gate-monitored.sh` + `scripts/gcp-watchdog-homolog.sh` |
| Branch tip (notebook) | pós-merge #1439 / #1441 em `feature/docker-e2e-backend-integration` |
| Issue | [#1440](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1440) |

## Resultado

| Tentativa | EXIT | Motivo |
|---|---|---|
| 1 | 20 | `INFRA_ABORT` — MongoDB `Exited (14)` |
| 2 | 20 | idem |
| 3 | 20 | idem |

Marcadores finais: `E2E_GATE_EXIT=20` / `STOP_REASON=exhausted` / `WATCHDOG_END=2026-11-04T04:45:02Z`.

Fail-fast cortou a cascata (antes: dezenas de minutos de Playwright após Mongo morto).

## Observação de produto pré-abort

Enquanto Mongo/backend estavam healthy, o runner avançou centenas de specs (auth, intake, physical-chain, pipeline slices). A falha dominante desta noite é **infra Mongo exit 14**, não regressão shadcn isolada.

## Impacto na publicação

Gate oficial **não** fechou verde. Binding UI↔Mongo e re-filmagem showcase na stack GCP ficam bloqueados por #1440. Evidências de fluxo existentes: `docs/e2e-showcase-2026-11-01-*.mp4`.
