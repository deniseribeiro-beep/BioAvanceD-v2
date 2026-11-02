# BioAvanceD Lab Population Pattern (BLPP)

| Campo | Conteudo |
|---|---|
| Nome | BioAvanceD Lab Population Pattern (BLPP) |
| Versao | `schemaVersion` **1.0.0** |
| Objetivo | Gerar populacao operacional sintetica reprodutivel para validacao lab/tese |
| Entradas | `--n`, `--seed`, flags de subset clinico/negativos, `--chunk-size` |
| Saidas | JSON canonico; CSV; XLSX; aplicacao via `seed-lab-population.js` |
| Regras | RF029/LGPD Identity via `patient.service`; consentimento ACTIVE; catalogo MIABIS (`PLASMA`/`SERUM`/…); amostras via `sample.service` **ou** `lab-direct` se Mongo standalone |
| Apply modes | `auto` (detecta replica set), `service` (RF006 createSample+transacao), `lab-direct` (insert MIABIS-valid como seed-demo — lab compose.dev sem `--replSet`) |
| Reprodutibilidade | Mesmo seed + schemaVersion → mesmo lote logico (`sourceRecordId`) |
| Limites | Sem prevalencia clinica real; sem PII real; **sem Synthea runtime** (REF-032 so conceito) |
| Evidencia | Contagens, tempos, falhas, multi-formato, prova de `--resume` |

## Comandos

```bash
# Dry-run + writers
node scripts/seed-lab-population.js --n 2 --seed 4242 --dry-run --format json,csv,xlsx --out /tmp/blpp-dry

# PoC N=100
node scripts/seed-lab-population.js --n 100 --seed 4242 --out /data/blpp-100 --include-negatives

# Resume apos interrupcao
node scripts/seed-lab-population.js --n 100 --seed 4242 --out /data/blpp-100 --resume

# Status / ETA supervision
node scripts/seed-lab-population.js --status --out /data/blpp-100

# Parada limpa apos chunk 0 (prova de resume)
node scripts/seed-lab-population.js --n 100 --seed 4242 --out /data/blpp-100 --stop-after-chunk 0
```

## Citacao na tese

Artefato de software criado neste trabalho. Fundamentacao conceitual: Walonoski et al. 2018 (REF-032 / SRC_SYNTHEA) — geracao sintetica para teste; **implementacao propria** BioAvanceD.
