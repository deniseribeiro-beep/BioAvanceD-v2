# Lab: full reference import (opt-in)

Perfil **local/VM** para estressar as 16 fontes Fase 2 com corpora completos.
O `e2e-gate` / CI **continuam em fixtures** — só ativa com env.

## Env

```bash
export REFERENCE_IMPORT_PROFILE=full-lab
export REFERENCE_FULL_ASSET_DIR=$HOME/ref-full
export REFERENCE_FULL_CACHE_DIR=$HOME/ref-cache
```

## Layout

```
~/ref-full/HPO/hp.json          # dump oficial (já no SCP das 10 públicas)
~/ref-full/ATC/atc.xml          # você coloca após Orders ATC/DDD
~/ref-cache/HPO/data.jsonl      # gerado pelo conversor lab
```

## ATC (teste vs oficial)

O índice ATC/DDD eletrônico oficial (Excel/XML) é distribuído pelo WHOCC via
Orders ATC/DDD, com custo reportado de cerca de €200. Para o ensaio de
laboratório usamos o snapshot público `WHO ATC-DDD 2026-04-25.csv`
([fabkury/atcd](https://github.com/fabkury/atcd)), obtido por scrape do índice
web, sob CC BY-NC-SA 4.0 quanto ao empacotamento do repositório, com atribuição
à WHOCC. Esse arquivo serve **somente para teste** do pipeline de importação;
não constitui a fonte de autoridade do release de produção.

1. Lab: `~/ref-full/ATC/WHO ATC-DDD 2026-04-25.csv` (+ combinations opcional).
2. Produção: conta em Orders ATC/DDD → Excel/XML → SCP como `atc.xml`/`ATC.xlsx`.
3. Conversor ATC→JSONL ainda pendente.

## HPO (piloto)

Com `hp.json` em `ref-full/HPO/`, o acquire converte automaticamente para
`ref-cache/HPO/data.jsonl` e importa pelo mesmo `pipeline.js`.

```bash
npm --prefix api/backend run reference:import:hpo:dry-run
# ou full:
npm --prefix api/backend run reference:import:hpo
```

Conversor manual:

```bash
npm --prefix api/backend run reference:lab:convert:hpo -- \
  --in "$HOME/ref-full/HPO/hp.json" \
  --out "$HOME/ref-cache/HPO/data.jsonl"
```

## Status por fonte

| Code | Dump na VM | Conversor |
|------|------------|-----------|
| HPO | sim | sim (`hpo-json`) |
| MONDO…UCUM (9) | sim (públicas) | pendente |
| ATC, DCB, LOINC, ICD10 | operador + converters lab (`atc-csv`, `dcb-xlsx`, `loinc-csv`, `icd10-cm-order`) | JSONL em `ref-full/<CODE>/data.jsonl` |
| ORPHA | pack zip | `orpha-pack` → `data.jsonl` + `intake-records.jsonl` (ORPHA↔OMIM↔ICD-10) |
| OMIM | opcional | **Intake autofill não depende de dump OMIM** — códigos vêm do Orphadata `ORPHA_OMIM_mapping` |
| ICD11 | SimpleTabulation zip | JSONL converter ainda pendente |

### Orphadata crosswalk (intake wizard)

```bash
npm --prefix api/backend run reference:lab:convert:orpha -- \
  --in "$HOME/ref-full/ORPHA/Orphanet_Nomenclature_Pack_EN.zip" \
  --out "$HOME/ref-full/ORPHA/data.jsonl" \
  --intake-out "$HOME/ref-full/ORPHA/intake-records.jsonl"

# Carrega terminologies + orphanet_diseases.relacoes (ORPHA/OMIM/CID-10)
npm --prefix api/backend run reference:lab:load:orpha-intake -- \
  --in "$HOME/ref-full/ORPHA/intake-records.jsonl"
```

Checagem Fabry: `ORPHA:324` → `OMIM:301500` + `E75.2`.
