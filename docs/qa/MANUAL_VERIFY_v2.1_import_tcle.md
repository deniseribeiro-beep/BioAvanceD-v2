# MANUAL_VERIFY v2.1 — Importação (G7) + TCLE + Runbook/Legal (G13)

Ambiente: homolog `:8080` após deploy do tip **2.1.0**. Papéis: **Técnico** (import), **Coordenador** (TCLE), **Administrador** (legal publish).

## G7 — Importação

| ID | Passos | Resultado esperado | Status |
|----|--------|-------------------|--------|
| IMP-001 | Sidebar → **Importação em lote** | Abre `/patients/import-fhir`; título “Importação em lote”; subtítulo menciona redirect de `/import` | |
| IMP-002 | Acessar `/import` ou `/import/lgpd` direto | Redireciona para `/patients/import-fhir` (sem `ImportForm` no menu) | |
| IMP-003 | FHIR: etapas 1→2→3→4→5 com bundle de teste | Validar lote, revisar tabela, salvar em quarentena; mensagens legíveis em erro | |
| QUA-001 | Sidebar → **Quarentena de Importação** | Card “Passos (G7)”; lista lotes; abrir lote com rejeitadas e ver erros | |

## G7 — Construtor TCLE

| ID | Passos | Resultado esperado | Status |
|----|--------|-------------------|--------|
| TCLE-001 | `/admin/tcle/new` — ler card **Como usar (G7)** | Texto cobre rascunho vs publicado, `{{placeholders}}`, DUO, PDF teste, ≠ gov.br remoto | |
| TCLE-002 | Criar modelo → preencher corpo → **Criar versão** | Toast de publicação; redireciona para `/admin/tcle/edit/:id` | |
| TCLE-003 | Histórico → **PDF** | Abre visualização imprimível com cabeçalho e assinaturas | |

## G13 — Runbook + Termos/Privacidade

| ID | Passos | Resultado esperado | Status |
|----|--------|-------------------|--------|
| RUN-001 | Sidebar → **Runbook / Processos** (`/runbook`) | Índice com intake, inventário, TCLE, import, facility, convite | |
| RUN-002 | `/admin/dicionario` (bookmark antigo) | Redirect para `/runbook` (APIs `/dictionary/*` inalteradas) | |
| LEG-001 | Usuário novo ou após admin publicar versão 2.1.1 | Gate pós-login pede aceite; links para `/legal/terms` e `/legal/privacy` | |
| LEG-002 | Aceitar ambos documentos | Gate some; `POST /api/product-legal/accept` persiste userId, tenantId, docVersion, IP/UA | |
| LEG-003 | Admin no Runbook → publicar nova versão | Usuários existentes voltam a ver gate até reaceitar | |