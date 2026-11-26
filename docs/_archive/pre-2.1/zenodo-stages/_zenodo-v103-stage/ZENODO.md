# Zenodo — BioAvanceD ex-ante evaluation v1.0.3

| Campo | Valor |
|---|---|
| Concept DOI | [10.5281/zenodo.23890206](https://doi.org/10.5281/zenodo.23890206) |
| Versão deste pacote | **1.0.3** (aditivo a 1.0.2) |
| Artefato | `docs/evidencias/BioAvanceD-ex-ante-evaluation-v1.0.3.zip` |

## Conteúdo esperado do zip

- Apêndice de rastreabilidade homologação (`docs/mestrado/Apendice_Matriz_Rastreabilidade_Homologacao_v1.0.0.md`)
- Checklist UI↔Mongo + nota API-only ADR W8
- CT-RNF001 + `rnf001-ui-p95-results.json` (GCP 2026-11-04, overallPass)
- RNF030 exceção + RF016 sintético + checklists wave3
- Resumo gate GCP watchdog 2026-11-04 (#1440)
- Este `ZENODO.md` + checksums

Vídeos showcase grandes (`docs/e2e-showcase-2026-11-01-*.mp4`) referenciados no apêndice; anexar no Zenodo como ficheiros suplementares se o limite do zip for excedido.

## Checklist de upload (autora)

1. Abrir o concept DOI → New version.
2. Upload `BioAvanceD-ex-ante-evaluation-v1.0.3.zip` (+ vídeos se separados).
3. Version `1.0.3`; manter metadados da 1.0.2; mencionar RNF030 exceção e bloqueio gate #1440 no description.
4. Publish; guardar DOI da versão.
5. Conferir `md5`/`sha256` do zip com `*.sha256` / `*.md5` gerados no repo.

## Aditivo UI 2026-11-06 (próximo zip / patch)

Incluir após tip-deploy + captura ui-gold:

- `docs/qa/MANUAL_VERIFY_20261106_import_intake.md`
- Screenshots regenerados: `test-results/ui-gold-screenshots/` (rota `34-import-batch` = `/patients/import-fhir`)
- Apêndice atualizado (linha *UI import/intake 2026-11-06*)
