# MANUAL_VERIFY — live pass 2026-11-06

Homolog em `0274b0f6` (`feature/homolog-consent-mail-directory`), proxy `:8080`, login `admin`.

## Passes desta sessão

| ID | Resultado | Nota |
|---|---|---|
| ROUTE-MAP | PASS | ~40 rotas de ouro abertas: um `h1` por tela autenticada, sem layout colapsado. |
| SAMPLES-GRID | PASS | `/samples` mostra a grade 9×9; poço ocupado com `data-tooltip` = código da amostra. |
| EMAIL-LOGIN | PASS | O login aceita o e-mail da conta `admin` (mapeamento `username \|\| email` em `auth.routes.js`). A caixa `e2e-admin@bioavanced.test` não é o e-mail gravado nesse usuário. |
| TABLE-ACTIONS | PASS após fix | Ações do inventário passaram a `.table-actions` em linha. |
| BOX-LABEL | PASS após fix | Seletor da grade usa o último segmento do `path` quando `boxName` falta. |

## Skips

| ID | Rota / UI | Por que skip | O que verificar manualmente | Critério de ok |
|---|---|---|---|---|
| SKIP-001 | `/biomarker-associations` | Homolog sem catálogo analito–condição (`biomarkerAssociations` = 0) | Abrir a lista após importar associações reais | Linhas do catálogo aparecem; Nova Associação só para exceção |
| SKIP-002 | `/samples/:id`, `/logs/:id`, `/reports/:id`, `/admin/tcle/edit/:id` | Precisam de id real; smoke de ouro usa `demo-id` | Abrir um id existente da lista | Página carrega sem layout colapsado |
| SKIP-003 | `/next/intake` | Wizard foundation sem `h1` de página shell | Percorrer os passos do intake | Conteúdo do wizard visível |
| SKIP-004 | Gate e2e completo (`scripts/e2e-gate.sh`) | Fora do escopo deste passe | Rodar o gate no CI ou na VM com disco livre | Gate verde |
| SKIP-005 | `/samples/withdrawal-return` no menu | Rota existe e abre; item de menu lateral ainda ausente (decisão 27/10) | Confirmar se o produto quer o item no sidebar | Decisão registrada ou item no menu |
