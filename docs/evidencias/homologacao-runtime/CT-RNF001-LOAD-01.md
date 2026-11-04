# CT-RNF001-LOAD-01 — Campanha p95 UI ≤ 2 s

| Campo | Valor |
|---|---|
| Sucessor de | CT-RNF001-PEND-01 |
| Critério | p95 do tempo até UI interativa ≤ 2000 ms nas rotas críticas |
| Rotas | `/login`, `/dashboard`, `/samples`, `/next/intake` |
| Instrumento | `scripts/rnf001-ui-p95.mjs` (Playwright navigation timing) |
| Ambiente | GCP VM `instance-20261029-155615` + `compose.test.yml` (host ports 5173/3000) |
| Data | 2026-11-04 |

## Protocolo

1. Autenticar com credenciais de bootstrap do ambiente controlado.
2. Para cada rota, repetir N=30 navegações a frio (nova página) medindo `performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd` ou, na SPA, o tempo até o seletor de prontidão:
   - `/login` → `[data-testid=login-form]`
   - `/dashboard` → heading / shell autenticado
   - `/samples` → listagem de amostras
   - `/next/intake` → wizard de intake
3. Calcular p50/p95/max; registrar em `rnf001-ui-p95-results.json`.
4. **Aprovado** se p95 ≤ 2000 ms em todas as rotas; caso contrário documentar o limite medido sem promover falso Aprovado.

## Critério de prontidão por rota

| Rota | Seletor de prontidão |
|---|---|
| `/login` | `[data-testid="login-form"]` |
| `/dashboard` | `nav.sidebar-nav` (ou título do dashboard) |
| `/samples` | texto/heading de inventário ou tabela |
| `/next/intake` | `[data-testid="wizard-full-name"]` / `.intake-wizard-page` |

## Resultado

| Rota | p50 (ms) | p95 (ms) | max (ms) | Critério ≤2000 | N |
|---|---:|---:|---:|---|---:|
| `/login` | 57 | 85 | 181 | Aprovado | 30 |
| `/dashboard` | 273 | 390 | 857 | Aprovado | 30 |
| `/samples` | 146 | 274 | 276 | Aprovado | 30 |
| `/next/intake` | 137 | 155 | 166 | Aprovado | 30 |

`overallPass=true` @ `2026-11-04T13:47:59.439Z` — ver `rnf001-ui-p95-results.json`. Homologação RNF001 no apêndice: **Aprovado**.
