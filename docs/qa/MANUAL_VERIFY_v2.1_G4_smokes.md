# MANUAL_VERIFY — G4 smokes humanos v2.1

Homolog tip **2.1** com `GOVBR_OIDC_MOCK` **off** (ver `docs/operations/runtime-mock-hygiene-v2.1.md`).  
Marque PASS só com evidência (screenshot path, evidence JSON, log).

| # | Smoke | Pré-req | Status | Evidência |
|---|-------|---------|--------|-----------|
| G4-01 | CPF máscara + validação intake | tip | PENDING_HUMAN | |
| G4-02 | SPREC sólidos + sigla/modal | tip | PENDING_HUMAN | |
| G4-03 | Doc-primeiro + busca doença | tip + ORPHA | PENDING_HUMAN | |
| G4-04 | Fabry/324 → CID/ORPHA/OMIM + HPO + biomarcadores | G1 crosswalk+reimport | PENDING_HUMAN | |
| G4-05 | Procedimentos SIGTAP typeahead | G2 import full | PENDING_HUMAN | |
| G4-06 | Alergia ATC + TCLE geo presencial | tip | PENDING_HUMAN | |
| G4-07 | Keepalive sessão longa | tip | PENDING_HUMAN | |
| G4-08 | Rascunho intake reload / Limpar / Novo / submit | tip | PENDING_HUMAN | |
| G4-09 | TCLE remoto gov.br **real** → `identityProof` | G8 creds | PENDING_HUMAN | |
| G4-10 | Canvas presencial ok após geo | tip | PENDING_HUMAN | |
| G4-11 | `/biomarker-associations` busca pós-crosswalk | G1 | PENDING_HUMAN | |

## Código já na main (não fecha G4 sozinho)

- Achados TRACE 1–6 instrumentados
- TCLE gov.br/ICP instrumentado (e2e mock só em CI)
- Typeahead SIGTAP no intake (G2 FE)
- Crosswalk script G1 pronto para reimport

## Fechamento G4

Quando todas as linhas PASS: marcar G4 no [PENDING](../execution_plan_26112026/PENDING_FOLLOWUPS_phr_gaps.md) com link para este arquivo + data da sessão.
