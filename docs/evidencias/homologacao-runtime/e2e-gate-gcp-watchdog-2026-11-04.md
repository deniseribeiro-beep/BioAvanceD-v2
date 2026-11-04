# Resumo sanitizado — e2e-gate GCP watchdog (2026-11-04)

| Campo | Valor |
|---|---|
| VM | `instance-20261029-155615` / `us-central1-a` |
| Scripts | `scripts/e2e-gate-monitored.sh` + `scripts/gcp-watchdog-homolog.sh` |
| Branch tip (notebook) | pós-merge #1439 / #1441 em `feature/docker-e2e-backend-integration` |
| Issue | [#1440](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1440) |

## Resultado (noite + manhã 2026-11-04)

### Primeira bateria (pré-fix) — exhausted

| Tentativa | EXIT | Motivo |
|---|---|---|
| 1–3 | 20 | `INFRA_ABORT` — MongoDB `Exited (14)` |

Causa: **EMFILE** (`Too many open files`, nofile=1024) no RF013 restore → WiredTiger panic. Secundário: WT cache default ~7 GiB em e2-highcpu-16.

### Após fix (`compose.test.yml` cache 1.5 GiB + nofile 65536 + RNF027)

| Marcador | Valor |
|---|---|
| `E2E_GATE_EXIT` | **0** |
| `STOP_REASON` | **success** |
| `ATTEMPT=1 EXIT` | **0** @ `2026-11-04T09:16:24Z` |
| Playwright | **402 passed** (8.2 m) |
| Issue | [#1440](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/1440) **closed** |

## Impacto na publicação

Gate oficial **verde** na VM GCP. Prosseguir binding focado / RNF001 / Zenodo com esta evidência.
