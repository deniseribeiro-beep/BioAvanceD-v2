# Release audit — BioAvanceD `v2.1.0`

| Campo | Valor |
|-------|--------|
| Tag | `v2.1.0` |
| Tag SHA (annotated) | `e72a3d9c` (docs W7 close); tip comercial live may advance with domain/CI follow-ups |
| Data auditoria | 2026-11-26 |
| Homolog | GCP `instance-20261029-155615` + compose.test + access-proxy |
| Domínio paliativo | `https://www.bioadvanced.dev` (IAP **disabled**; cert Google ACTIVE) |
| Apex `bioadvanced.dev` | A `@` **ausente** na resolução pública no momento da auditoria — usar `www` até corrigir Name.com |

## Scorecard G0–G13

Todos **DONE** no tip; G4 com exceção assinada Option B (G4-09 / G8-GOVBR-REAL residual pós-tag).  
Fonte: [`PENDING_FOLLOWUPS_phr_gaps.md`](../execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md).

## W7

| Critério | Status |
|----------|--------|
| RF016 tip `v2.1.0-rc` | **PASS** — [`RF016-ex-ante-v2.1.0-rc.md`](../evidencias/homologacao-runtime/RF016-ex-ante-v2.1.0-rc.md) |
| Ex ante gate | [`MANUAL_VERIFY_v2.1_ex_ante_gate.md`](MANUAL_VERIFY_v2.1_ex_ante_gate.md) |
| Tag | `v2.1.0` pushed |

## Domínio / acesso

| Check | Resultado |
|-------|-----------|
| Cert `bioavanced-dev-cert` | ACTIVE (`bioadvanced.dev`, `www.bioadvanced.dev`) |
| IAP `bioavanced-access-backend` | `enabled: false` |
| `GET https://www.bioadvanced.dev/login` | 200, título BioAvanceD (sem Google) |
| `POST .../api/auth/login` admin | success + token |
| `GET .../api/health` | 200 |
| Runbook | [`bioadvanced-iap-access.md`](../runbooks/bioadvanced-iap-access.md) |

## Rastreabilidade

Matriz consolidada: [`matriz-rastreabilidade-comercial-v2.1.md`](../compliance/matriz-rastreabilidade-comercial-v2.1.md).

## CI GitHub

| Workflow | Status nesta auditoria |
|----------|------------------------|
| `ci-pipeline.yml` (push main) | _preencher após verde_ |
| `tls-check.yml` (`bioadvanced.dev`) | _preencher após verde_ |

## Residual pós-tag

1. **G8-GOVBR-REAL** — Login Único real (ADR Option B).
2. Apex DNS A `@` se ainda não propagar.
3. Domínio com grafia “BioAvanceD” correta (futuro / Student Pack).
