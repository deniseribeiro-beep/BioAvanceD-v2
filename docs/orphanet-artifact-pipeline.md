# Orphanet Initial Seed Pipeline

## Decisao

A populacao inicial ORPHA do BioAvanceD usa a estrategia `pack-first + api-enrichment`.

- `pack-first`: gera o seed inicial completo a partir dos arquivos oficiais locais do Orphanet Nomenclature Pack e do XLSX complementar ORPHA-SNOMEDCT.
- `api-enrichment`: mantem a ORPHAcodes API apenas para validacao pontual, redundancia, enriquecimento incremental, atualizacao diferencial e OMIM.

Nao usamos a ORPHAcodes API endpoint-a-endpoint para full load inicial porque isso cria coleta longa, dependente de rede, dificil de encaixar em janelas curtas de MongoDB no CENAPAD. O CENAPAD deve receber um artefato pronto, validado e resumivel por upsert.

## Fontes da carga inicial

- Orphanet Nomenclature Pack PT July 2025: `Orphanet_Nomenclature_Pack_PT.zip`
- Orphanet Nomenclature Pack EN July 2025: `Orphanet_Nomenclature_Pack_EN.zip`
- ORPHA-SNOMEDCT Mapping File July 2025: `ORPHA-SNOMEDCT_Mapping_File_production.xlsx`

O seed inicial final deve conter ORPHA canonico, CID-10 / ICD-10, CID-11 / ICD-11, SNOMED-CT e OMIM. OMIM nao esta confirmado nos packs PT/EN nem no XLSX SNOMED, entao entra por enriquecimento controlado da ORPHAcodes API ou por arquivo local `*OMIM*` se houver.

## Contrato semantico

- ORPHA representa doencas raras: `system: "ORPHA"`, `code: "ORPHA:<codigo>"`, `canonicalCode: "<codigo>"`, `domain: "rare_disease"`.
- CID-10 / ICD-10 e CID-11 / ICD-11 vem do Orphanet Nomenclature Pack PT/EN July 2025 e sao mapeamentos externos em `terminology_mappings`.
- SNOMED-CT vem do XLSX complementar e usa `targetSystem: "SNOMED_CT"`.
- OMIM vem de `api-enrichment` controlado da ORPHAcodes API e usa `targetSystem: "OMIM"`.
- HPO nao faz parte desta carga ORPHA e deve permanecer em `hpo_terms`.
- Biomarcadores nao fazem parte desta carga ORPHA e devem permanecer em suas colecoes proprias.
- `terminologies` e multi-sistema. Para esta carga, sempre filtre `system="ORPHA"`; nao compare a contagem total da colecao com a contagem ORPHA.

## Layout do artefato

```text
artifacts/orphanet-2025-07-initial-seed/
  manifest.json
  normalized/
    orphanet_entities.jsonl
    cids_projection.jsonl
    terminology_mappings.jsonl
    orphanet_classifications.jsonl
    terminologies_orpha.jsonl
  validation/
    source_counts.json
    normalized_counts.json
    checksums.json
    validation_report.json
```

## Gerar no Windows

Auto-deteccao a partir de `orpha-data-raw/`:

```powershell
node api/backend/scripts/orphanet-build-initial-seed-from-raw.js `
  --input ./orpha-data-raw `
  --release 2025-07 `
  --out ./artifacts/orphanet-2025-07-initial-seed
```

Com paths explicitos:

```powershell
node api/backend/scripts/orphanet-build-initial-seed-from-raw.js `
  --pt ./orpha-data-raw/Orphanet_Nomenclature_Pack_PT.zip `
  --en ./orpha-data-raw/Orphanet_Nomenclature_Pack_EN.zip `
  --snomed ./orpha-data-raw/ORPHA-SNOMEDCT_Mapping_File_production.xlsx `
  --release 2025-07 `
  --out ./artifacts/orphanet-2025-07-initial-seed
```

## Validar no Windows

```powershell
node api/backend/scripts/orphanet-validate-initial-seed.js `
  --artifact ./artifacts/orphanet-2025-07-initial-seed
```

## Enriquecer OMIM

Se existir um arquivo local OMIM em `orpha-data-raw/`, o enriquecedor prefere o arquivo local antes da API. Nomes aceitos:

- `*OMIM*.xlsx`
- `*OMIM*.csv`
- `*OMIM*.tsv`
- `*OMIM*.json`
- `*OMIM*.jsonl`

Sem arquivo local, ele consulta somente o endpoint OMIM da ORPHAcodes API:

```text
/EN/ClinicalEntity/orphacode/<codigo>/OMIM
```

Nao consulta Name, Synonym, ICD10, ICD11, SNOMED, Classification ou outros endpoints, e nao faz full load endpoint-a-endpoint.

```powershell
$env:ORPHACODE_API_KEY="denise-ribeiro-bioavanced"

node api/backend/scripts/orphanet-enrich-initial-seed-omim.js `
  --artifact ./artifacts/orphanet-2025-07-initial-seed `
  --release 2025-07 `
  --lang EN `
  --concurrency 3 `
  --delayMs 150 `
  --checkpoint
```

Depois do enriquecimento, valide o seed:

```powershell
node api/backend/scripts/orphanet-validate-initial-seed.js `
  --artifact ./artifacts/orphanet-2025-07-initial-seed
```

O validador confere presenca das fontes, SHA256, contagens PT/EN/uniao, duplicados, JSONL, campos obrigatorios, mapeamentos ICD-10/ICD-11/SNOMED_CT/OMIM e ausencia de HPO/biomarcadores tratados como ORPHA.

## Compactar artefato

```powershell
Compress-Archive `
  -Path ".\artifacts\orphanet-2025-07-initial-seed\*" `
  -DestinationPath ".\artifacts\orphanet-2025-07-initial-seed.zip" `
  -Force
```

## API complementar

O cliente ORPHAcodes API permanece disponivel com header `apiKey`, idiomas em uppercase e retry somente para 429, 5xx e timeout. `404` em endpoints complementares e tratado como ausencia de dado, sem retry. O script `orphanet-fetch-api-once.js` pode ser usado para validacao/enriquecimento pequeno, nunca para full load inicial:

```powershell
node api/backend/scripts/orphanet-fetch-api-once.js `
  --release 2025-07 `
  --langs pt,en `
  --out ./artifacts/orphanet-2025-07-api-enrichment `
  --limit 3
```

## Enviar para CENAPAD

Envie o ZIP ou o diretorio do artefato validado para a area de cache do projeto. Exemplo:

```powershell
scp .\artifacts\orphanet-2025-07-initial-seed.zip usuario@cenapad:/home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/
```

No CENAPAD, descompacte para:

```bash
/home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed
```

## Importar no CENAPAD

O importador faz upsert idempotente, nao apaga colecoes inteiras por padrao, respeita `--maxSeconds` e pode ser retomado por checkpoint de arquivo/lote. Use `--checkpoint` nas janelas curtas do CENAPAD; por padrao o checkpoint fica em:

```text
<artifact>/validation/import_checkpoint.json
```

O checkpoint registra quantas linhas de cada JSONL ja tiveram `bulkWrite` concluido com sucesso. Em uma queda durante um lote, a proxima execucao pode reprocessar no maximo o ultimo lote incompleto; isso e seguro porque os writes sao upserts idempotentes.

```bash
MAX_SECONDS=240 ./with-mongo-window.sh node api/backend/scripts/orphanet-import-initial-seed.js \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed \
  --batch 500 \
  --maxSeconds 220 \
  --checkpoint
```

Se a janela estiver perto de expirar, o importador termina o lote atual, salva checkpoint, fecha a conexao Mongo e sai com exit code `2`. Isso significa parada segura por tempo: basta repetir o mesmo comando para continuar do checkpoint.

Para usar um checkpoint fora do artefato:

```bash
MAX_SECONDS=240 ./with-mongo-window.sh node api/backend/scripts/orphanet-import-initial-seed.js \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed \
  --batch 500 \
  --maxSeconds 220 \
  --checkpointFile /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-import-checkpoint.json
```

Para resetar somente o checkpoint de importacao, sem tocar no Mongo:

```bash
node api/backend/scripts/orphanet-import-initial-seed.js \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed \
  --checkpoint \
  --resetImportCheckpoint
```

`--replaceRelease` nao e o fluxo padrao para janelas curtas. Se for realmente necessario substituir uma release ORPHA ja importada, use explicitamente `--replaceRelease --confirmReplaceRelease`. Esse modo remove apenas documentos ORPHA daquela release nas colecoes da carga, reseta o checkpoint de importacao e entao reimporta por upsert:

```bash
MAX_SECONDS=240 ./with-mongo-window.sh node api/backend/scripts/orphanet-import-initial-seed.js \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed \
  --batch 500 \
  --maxSeconds 220 \
  --checkpoint \
  --replaceRelease \
  --confirmReplaceRelease
```

## Validar pos-importacao no CENAPAD

```bash
MAX_SECONDS=180 ./with-mongo-window.sh node api/backend/scripts/orphanet-validate-imported-seed.js \
  --release 2025-07 \
  --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed
```

Essa validacao compara contagens ORPHA em `orphanet_diseases`, `cids`, `terminologies`, `terminology_mappings`, faz uma amostra de busca por ORPHA e checa ausencia de HPO/biomarcador tratado como ORPHA.

## Scripts npm

Dentro de `api/backend`:

```powershell
npm run orphanet:build-initial-seed -- --input ../../orpha-data-raw --release 2025-07 --out ../../artifacts/orphanet-2025-07-initial-seed
npm run orphanet:enrich-omim -- --artifact ../../artifacts/orphanet-2025-07-initial-seed --release 2025-07 --lang EN --concurrency 3 --delayMs 150 --checkpoint
npm run orphanet:validate-initial-seed -- --artifact ../../artifacts/orphanet-2025-07-initial-seed
```

No CENAPAD:

```bash
npm run orphanet:import-initial-seed -- --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed --batch 500 --maxSeconds 220 --checkpoint
npm run orphanet:validate-imported-seed -- --release 2025-07 --artifact /home/lovelace/proj/proj1091/deniser/bioavanced-validation/cache/orphanet-2025-07-initial-seed
```
