# MANUAL_VERIFY — 2026-11-04 (QA live pass / entity forms)

Regra: o que não foi testável nesta sessão ou não está explícito em docs/código/contexto → SKIP.

## Coberto nesta sessão (não precisa revalidar só por este pass)

- Skill `.cursor/skills/qa-live-pass/SKILL.md`
- Modal→página: organizations, collections (+governance), equipment, sensors, policies, quality-descriptions, report-templates, biomarker-associations
- Unit/behaviour das listas + FormPages tocadas (incl. SystemManagement, Facility, Biomarker, rolePermissions)
- E2E specs atualizados para URLs de form page: `organization-collection-management-ui.spec.ts`, `collection-governance-ui.spec.ts`
- ui-gold DEMO_ROUTES com paths `/…/new` das novas forms

## Skips — verificação manual

| ID | Rota / UI | Por que skip | O que verificar manualmente | Critério de ok |
|----|-----------|--------------|-----------------------------|----------------|
| SKIP-001 | `http://127.0.0.1:8080` login + lista→form de org/coleção | Túnel IAP local `:8080` caiu após rebuild (reauth 4033 nesta sessão); FE **já rebuildado na VM** com `CollectionFormPage-*.js` | 1) Reabrir túnel IAP / login. 2) Sistema→Organizações→Nova Organização. 3) Salvar mín. e voltar à lista. Idem Coleções. | URL `/organizations/new` ou `/collections/new` (não modal); após salvar, volta à aba; CSS/ações ok |
| SKIP-002 | `/collections/:id/governance` live | Precisa coleção seedada + IAP/login | Abrir Governança numa coleção existente; registrar/ver painel | Página dedicada com `collection-governance-panel`; Voltar recarrega lista |
| SKIP-003 | Facility: `/equipment/new`, `/sensors/new`, `/policies/new` live | Sem browser autenticado nesta sessão | Em Facility, Novo Equipamento/Sensor/Política → preencher → salvar | Navega para form page; salva e volta à tab |
| SKIP-004 | `/quality-descriptions/new`, `/reports/templates/new`, `/biomarker-associations/new` live | Sem browser autenticado | Criar um registro mínimo em cada superfície | Form page; lista atualiza após salvar |
| SKIP-005 | Edit paths `/:id/edit` com ID real (todas entidades) | Sem seed/ID garantido na sessão | Editar uma linha existente de cada entidade migrada | Abre form preenchido; regime de coleção locked se já setado |
| SKIP-006 | Busca client-side orgs/coleções/facility | Julgamento visual + dados reais | Digitar filtro nas listas; limpar | Filtra; empty state de busca quando nada casa |
| SKIP-007 | `bash scripts/e2e-gate.sh` / job CI `e2e-tests` completo | Disco/tempo inviável nesta sessão | Rodar CI na PR ou `test:e2e:docker` com API | Specs org/coleção/governance + ui-gold paths novos verdes |
| SKIP-008 | Smoke browser pós-deploy nas form pages | Deploy VM **feito** (`DEPLOY_ACCESS_DONE=2026-11-04T21:07:36Z`, proxy 200); falta smoke via túnel local (IAP 4033) | Reabrir IAP tunnel e visitar `/collections/new`, `/organizations/new`, facility/quality/templates/biomarker `/new` | Página form carrega; sem modal legado |
| SKIP-009 | DEMO_ROUTES restantes (samples/:id, e-consent tokens, etc.) | Seed/demo-id / fluxos sem AC explícito para “clique total” | Smoke visual das rotas auth do ui-gold que você priorizar | Página carrega sem layout colapsado; sem H1 duplicado óbvio |
| SKIP-010 | Modais que **permanecem** (forgot-password, upload, print, restore, confirms) | Fora do escopo Modal→página | Confirmar que ainda abrem como modal | Continua modal; não virou página por engano |

## Nenhum skip vazio

Lista acima é o entregável de verificação manual deste pass.
