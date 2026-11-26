# Inventário G0 — sanitização pré-2.1

Data: 2026-11-26. Aprovado no tip conforme plano v2.1 (PENDING §3).

## keep (SoT 2.1)

| Path | Motivo |
|------|--------|
| `docs/execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md` | Scorecard go-live G0–G13 |
| `docs/SOT_2.1.md` | Índice SoT |
| `docs/decisions/*` (ADRs vigentes) | Decisões; não apagar |
| `docs/qa/TRACE_20261125_intake_cpf_mask_human_qa.md` | TRACE vigente |
| `docs/qa/MANUAL_VERIFY_20261106.md` | MANUAL_VERIFY tip (atualizar status, não arquivar) |
| `docs/qa/MANUAL_VERIFY_20261106_import_intake.md` | Import/intake tip |
| `docs/evidencias/homologacao-runtime/RF016-ex-ante-sintetico-v1.0.0.md` | Pack ex ante |
| `docs/evidencias/homologacao-runtime/e2e-gate-*` | Evidências de gate |
| `docs/operations/*` | Runbooks ops (alinhar tip 2.1) |
| `docs/user-guides/*` | Fonte Runbook in-app |
| `docs/architecture/*` | Contratos + ADRs 2.1 |
| `docs/mestrado/*` | Corpus acadêmico (keep; não apagar) |

## archive (movido para este tree)

| Origem | Destino |
|--------|---------|
| `docs/evidencias/_zenodo-v103-stage/` | `zenodo-stages/_zenodo-v103-stage/` |
| `docs/evidencias/_zenodo-v105-pack/` | `zenodo-stages/_zenodo-v105-pack/` |
| Cópia `docs/evidencias/homologacao-runtime/ZENODO.md` | `evidencias-zenodo-dup/ZENODO.md` |
| Cópia `docs/qa/MANUAL_VERIFY_20261104.md` | `qa-obsolete/MANUAL_VERIFY_20261104.md` |

## delete

Nenhum delete nesta wave. Preferir archive.

## Não fazer (G0)

- `git filter-repo` / rewrite de histórico
- Apagar ADRs, gates, packs RF016, corpus mestrado

## Segredos

Nenhum segredo novo detectado no tip desta sanitização. Se aparecer credencial: rotate + remover do tip.
