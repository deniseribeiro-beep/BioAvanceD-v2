# Suporte e SLA — BioAvanceD v2.1

## Canal

| Canal | Uso |
|-------|-----|
| E-mail suporte | Definido pelo tenant no onboarding (`ALERT_EMAIL_TO` / contato comercial) |
| Runbook in-app | `/runbook` — processos diários |
| Ops lab (não cliente) | IAP/SSH conforme `docs/runbooks/bioadvanced-iap-access.md` (ops-only) |

## Severidade e resposta-alvo (comercial 2.1)

| Severidade | Exemplos | Resposta inicial | Mitigação |
|------------|----------|------------------|-----------|
| S1 | Indisponibilidade total login/intake; perda de dados | 4h úteis | Restore runbook + hotfix |
| S2 | Fluxo crítico degradado (TCLE, inventário, import) | 1 dia útil | Workaround + patch |
| S3 | UX / documentação / não-bloqueante | 3 dias úteis | Próxima manutenção |
| S4 | Enhancement | Backlog | Release planejada |

## Onboarding tenant

1. Install: `docs/operations/install-runbook.md`
2. Configuration + mock hygiene: `configuration-runbook.md` + `runtime-mock-hygiene-v2.1.md`
3. `createFirstAdmin` → convites (`/users/new` → Convidar) → aceite Termos/Privacidade
4. SIGTAP/MarkerDB: runbooks de import (G1/G2)

## Fora do SLA 2.1

- DOI Zenodo / packs acadêmicos
- Certificação ANVISA (trilha paralela)
- TLS hardening in-app (#1465 — ADR defer)
