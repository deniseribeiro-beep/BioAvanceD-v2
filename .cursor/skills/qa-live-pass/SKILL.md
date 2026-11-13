---
name: qa-live-pass
description: >-
  Live QA pass for BioAvanceD UI: map routes, browser audit, fix declared UX
  defects, add unit/e2e, deploy GCP homolog :8080. Skip anything untestable or
  not explicit in docs/context and deliver a MANUAL_VERIFY list. Use when doing
  a quality live-pass, Modal→page migrations, UI checklist audits, or homolog
  verify after FE changes.
---

# QA live pass (browser → testes → GCP + skips manuais)

## When to use

Apply this skill whenever the user asks for a live quality pass, UI audit against
the agreed checklist, entity Modal→page work under that playbook, or deploy +
verify on the GCP access overlay (`:8080`).

## Golden rule (verbatim)

Se o agente **não conseguir testar** ou o comportamento **não estiver declarado
explicitamente** em documentação / código / contexto da sessão:

1. **SKIP** (não inventar requisito nem “adivinhar” o fluxo)
2. Registrar na **lista de verificação manual** entregue a você
3. Seguir para o próximo item do mapa

Nada de bloqueio eterno: skip documentado > especulação.

## Loop

1. **Map** — Build/refresh inventory from `tests/e2e/ui-gold-screenshots.spec.ts`
   (`DEMO_ROUTES` / `ROUTES`) + `frontend/src/App.tsx`. Visit order: auth →
   principal → lab → facility → sistema.
2. **Live** — Browser MCP on authenticated `http://127.0.0.1:8080` (or local
   stack if declared). Snapshot each path in scope.
3. **Declared?** — Only act on defects/requirements explicit in docs, code
   comments/AC, or this session. Else SKIP.
4. **Can test?** — Need seed/ID/IAP/human gate? SKIP + list. Else audit.
5. **Audit** — UI checklist (when applicable):
   - CSS vivo (sem layout colapsado; classes in `frontend/src/index.css`)
   - Ações de tabela horizontais (`.table-actions` nowrap)
   - Cadastro denso em **página** (`page-shell` + `card-surface`), not modal
   - Busca client-side em listas longas + CTA Novo
   - Tabs a11y / sem H1 duplicado em embedded
   - Forms: label acima + gap
6. **Fix** — Minimal code change; keep `*Service` HTTP contracts.
7. **Unit** — `npm --prefix frontend run test:unit` (CI job `frontend-unit-tests`).
8. **E2E** — Playwright smoke for new routes + update ui-gold paths. Full
   `bash scripts/e2e-gate.sh` only if feasible; else SKIP with CI reminder.
9. **Deploy** — Rebuild FE on GCP access overlay; confirm `:8080` 200 for
   covered paths. Skips do not block deploy of green work.
10. **Deliver** — Fixes + tests + always a MANUAL_VERIFY file (even if empty).

## Modal vs page

**Become pages** (dense entity CRUD): organizations, collections (+ governance),
sensors, policies, equipment, quality-descriptions, report templates,
biomarker-associations. Pattern: list `navigate` → FormPage; reference
`NewUserPage` + `/users/new`.

**Stay modal:** forgot-password, print, storage picker, upload, signature,
report import, restore backup, short confirms.

## MANUAL_VERIFY deliverable

Write `docs/qa/MANUAL_VERIFY_<YYYYMMDD>.md` every pass.

| Field | Content |
|-------|---------|
| ID | `SKIP-001` |
| Rota / UI | path or approximate DOM |
| Por que skip | no seed / no doc / IAP / flaky / out of context |
| O que verificar manualmente | 1–3 objective steps |
| Critério de ok | what “good” looks like |

Typical skip categories: missing seed/ID; IAP/human login; flow without AC in
docs; full e2e-gate not runnable this session; product judgment.

If nothing skipped, write: `Nenhum skip neste pass.`

## Gates (covered work only)

| Gate | Evidence |
|------|----------|
| Unit | `npm --prefix frontend run test:unit` |
| E2E smoke | new-route specs + ui-gold paths covered |
| Live | screenshot/snapshot of visited routes |
| Deploy | overlay rebuild; `:8080` 200 |
| Manual | SKIP list delivered |

## Limits

- Route smoke ≠ click every button.
- Do not invent product requirements.
- Deploy only after unit green for changed areas.
