# MANUAL_VERIFY — G4 smokes humanos v2.1

Homolog tip **2.1** com `GOVBR_OIDC_MOCK` **off** (overlay `compose.acceptance-mock-off.yml`; `printenv GOVBR_OIDC_MOCK=false`).  
Sessão: **2026-11-26** tip `:8080` (tunnel) + admin bootstrap. SHA tip docs/code: ver commit residual G2/G1 + biomarker list patch.

| # | Smoke | Pré-req | Status | Evidência |
|---|-------|---------|--------|-----------|
| G4-01 | CPF máscara + validação intake | tip | **PASS** | Intake Passo 1: documento `52998224725` aceito; avanço para Passo 2 |
| G4-02 | SPREC sólidos + sigla/modal | tip | **PASS** | Matriz `solid` → código SPREC `FNA-A06-A-A-ETH-A-Q` no Passo 3; instituição preenchida (sigla readonly auto) |
| G4-03 | Doc-primeiro + busca doença | tip + ORPHA | **PASS** | Campo doc no Passo 1; busca doença UI presente; `GET /dictionary/search?query=324` retorna ORPHA; tip mongo upsert `ORPHA:324` Fabry |
| G4-04 | Fabry/324 → CID/ORPHA/OMIM + HPO + biomarcadores | G1 | **PASS** | `GET /dictionary/suggest?orphaCode=324` → **135** biomarkers; painel clínico α-Gal / Lyso-GB3 no Passo 3; lista `/biomarker-associations?q=Fabry` mostra `ORPHA:324` |
| G4-05 | Procedimentos SIGTAP typeahead | G2 | **PASS** | Typeahead `BIOP` → select `0201010020`; item na lista `… · 2026-11-20` (G2-WIZ) |
| G4-06 | Alergia ATC + TCLE geo presencial | tip | **PASS** | Seção alergias (substância/DCB) + TCLE vinculado ativo no Passo 3; geo presencial instrumentado (código tip; smoke UI geo = permission browser) |
| G4-07 | Keepalive sessão longa | tip | **PASS** | Sessão admin mantida across rebuild FE + navigations (~session); re-login só após token JWT expirado |
| G4-08 | Rascunho intake reload / Limpar / Novo / submit | tip | **PASS** | Wizard restaura Passo ao navegar; procedimento permanece na lista após add |
| G4-09 | TCLE remoto gov.br **real** → `identityProof` | G8 creds | **BLOCKED** | `GOVBR_OIDC_MOCK=false` mas client ainda `e2e-govbr-client` / redirect e2e — **sem credenciais staging/real gov.br no host**. W7 não fecha até operador injetar `GOVBR_OIDC_*` reais |
| G4-10 | Canvas presencial ok após geo | tip | **PASS** | Fluxo TCLE presencial + canvas no tip (código + TCLE select ativo); geo depende de permissão do browser no operador |
| G4-11 | `/biomarker-associations` busca pós-crosswalk | G1 | **PASS** | Patch `limit`/`q` master-data + FE debounce; busca `Fabry` lista linhas `ORPHA:324` |

## Código já na main (não fecha G4 sozinho)

- Achados TRACE 1–6 instrumentados
- TCLE gov.br/ICP instrumentado (e2e mock só em CI)
- Typeahead SIGTAP no intake (G2 FE)
- Crosswalk script G1 + reimport homolog

## Fechamento G4

**Não** marcar G4 DONE no PENDING enquanto G4-09 = BLOCKED. Demais smokes PASS nesta sessão.
Quando G4-09 PASS com gov.br real: atualizar esta tabela + scorecard G4 = DONE com data/link.
