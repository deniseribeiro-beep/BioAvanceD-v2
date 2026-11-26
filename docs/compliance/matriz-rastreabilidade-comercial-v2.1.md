# Matriz rastreabilidade — escopo comercial BioAvanceD 2.1

Regra: requisito → implementação → teste → evidência. Escopo = PENDING G0–G13.

| Req (G*) | Implementação | Teste | Evidência |
|----------|---------------|-------|-----------|
| G0 Sanitização docs | `docs/_archive/pre-2.1/`, `SOT_2.1.md` | Revisão inventário | `INVENTORY.md` |
| G1 Crosswalk MarkerDB | `markerDbConditionCrosswalkLib.js` | unit crosswalk | test + unmatched queue |
| G2 SIGTAP | convert/import + intake typeahead | unit + MANUAL_VERIFY G2 | `sigtap-full-import-v2.1.md` |
| G3 CPATH/FDA_PGX | ADR N/A | n/a | `2026-11-26-cpath-fda-pgx-na-v2.1.md` |
| G4 Smokes humanos | tip 2.1 | MANUAL_VERIFY G4 | `MANUAL_VERIFY_v2.1_G4_smokes.md` |
| G5 Busca única | SamplesPage + SampleLocator | unit SamplesPage | MANUAL_VERIFY labels |
| G6 Etiquetas | SampleLabelPage Code128/DataMatrix | unit + manual | `MANUAL_VERIFY_v2.1_labels.md` |
| G7 TCLE+import | TcleBuilder + FHIR/quarantine | MANUAL_VERIFY import_tcle | idem |
| G8 TCLE gov.br | govbrOidc + mock hygiene | unit govbr + human | `MANUAL_VERIFY_v2.1_identity.md` |
| G9 Tenant-only | tenantInvite + invite UI | unit tenantInvite | idem |
| G10 ADR acesso | `2026-11-26-access-tenant-only-identity.md` | review | ADR |
| G11 Empacote | install/config/SLA/changelog | doc review | `support-sla-v2.1.md` |
| G12 Issues | ADR outs + closes | `gh issue list` | `2026-11-26-issues-out-of-v2.1.md` |
| G13 Runbook+legal | productLegal + RunbookPage | unit productLegal | MANUAL_VERIFY import_tcle |
| W7 Ex ante | RF016 protocol | ensaio tip RC | `MANUAL_VERIFY_v2.1_ex_ante_gate.md` |
