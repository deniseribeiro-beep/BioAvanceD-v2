# Fase 2 full-lab — população de referência na VM GCP

**Status final:** `FINAL_FAIL=0` — Fase 2 completa (verificado 2026-11-01 ~22:15Z / BRT ~19:15)  
**Host:** GCP `instance-20261029-155615` · zona `us-central1-a` · DB `bioavanced_dev`  
**Perfil:** `REFERENCE_IMPORT_PROFILE=full-lab` (`compose.lab.yml`)  
**Assets:** `~/ref-full/<DATASET>/` · cache `~/ref-cache/`  
**Script da rodada completa:** `scripts/lab-vm-fase2-complete.sh` (nohup → `~/fase2-complete-run.log`)  
**Evidência de fila:** `~/evidencias-dsr-lab-20261030/fase2-complete-summary.txt`

> Documento para inclusão em resultados/DSR. Contagens finais na §3.0. Fontes e citações na §8.

---

## 0. Ambiente de testes (ficha)

| Item | Valor |
|---|---|
| Provedor / zona | Google Cloud Platform · `us-central1-a` |
| Instância | `instance-20261029-155615` (lab efêmero; IP público **não** é dependência de reprodução) |
| Papel | Host de laboratório para população full-lab de referências (RF028) e evidência DSR |
| Stack | Docker Compose: `compose.yml` + `compose.dev.yml` + `compose.lab.yml` (+ `compose.lab-rs.yml` quando RF006/`replSet` é necessário) |
| Persistência nomeada | MongoDB DB `bioavanced_dev`; Neo4j via outbox de projeção (não é fonte de verdade das contagens §3) |
| Perfil de import | `REFERENCE_IMPORT_PROFILE=full-lab` |
| Assets / cache | `~/ref-full/<DATASET>/` · `~/ref-cache/` |
| Acesso operacional | SSH + tunnel local para UI/API; sem exposição permanente de :5173/:3000 |
| Escopo de dados | Vocabulários de referência versionados; **sem PII de participantes reais** nesta fase |
| Reprodutibilidade | Contagens e `FINAL_FAIL=0` (§3.0); scripts e registry em §7; fontes oficiais em §8 |

---

## 1. Como foi feito

### 1.1 Empilhamento
1. **Fase 1 (foundation + essential):** stack compose + MIABIS/SPREC/RCS-GOV mínimos + admin.
2. **Fase 2 parcial (1ª onda):** HPO, ORPHA (+ intake), ATC, LOINC, tentativa ICD10/DCB.
3. **Correção de cobertura:** `DUPLICATE_CODE` em `processRecords.js` (códigos repetidos viram exclusão justificada → `coverageResult` `justified`/`complete`, permitindo `promoteRelease`).
4. **Conversores lab** (raw → JSONL RF028 `{ id, lbl, is_a[], synonyms[], obsolete }`) em `api/backend/src/reference-data/reference-imports/lab/`, ligados por `resolveSourceAsset.js` + `fullLabSources.js`.
5. **Reset ICD10/DCB** (runs/staging/manifests incompletos) e **reimport** via `lab-vm-fase2-complete.sh`.
6. **Promoção RF028 AC8:** cada import `completed`+`approved` chama `promoteRelease` — grava `terminologyConcepts` / `terminologyRelations` e emite eventos na outbox de projeção Neo4j (um a um; gargalo de tempo).

### 1.2 O que cada “item” significa no Mongo
| Artefato | Significado |
|---|---|
| `referenceDatasetReleases` | Release versionada de um dataset (`active` = vigente no lab). |
| `referenceImportRuns` | Execução do pipeline (leitura JSONL → stage → approve). |
| `referenceImportStaging` | Candidatos antes da promoção. |
| `terminologyConcepts` | Termo canônico (`code` + `systemUri` + `display` + `semanticType`). |
| `terminologyRelations` | Aresta tipicamente `is_a` (hierarquia rdfs:subClassOf) entre conceitos da mesma release. |
| `orphanet_diseases` (intake) | Crosswalk ORPHA↔OMIM↔CID-10 para autofill do wizard (**não** exige dump OMIM). |
| Graph projection outbox | Fila para Neo4j (acompanha a promoção; não é a fonte de verdade). |

### 1.3 OMIM
**Dump OMIM fora desta rodada.** Códigos OMIM no intake vêm do pack Orphadata (`ORPHA_OMIM_mapping`). `fullLabSources.OMIM` permanece opcional.

---

## 2. Estimativas de tempo (promoção)

Ritmo observado na VM (~8–15 writes/s com outbox):

| Fonte | Duração observada (aprox.) |
|---|---|
| LOINC | ~4+ h (parse+promote) |
| ICD10 (reimport) | ~7 h (13:19→20:26Z) |
| DCB (reimport) | ~1 h |
| MONDO | ~3,7 h (21:33→01:16Z) |

**ETA restante naquele momento (fila HGNC→…→NCBITAX):** ~**2–3 dias** (provável); **1–1,5 dia** otimista; **3–5 dias** se CL/UBERON/NCBITAX forem muito grandes.  
Gargalos: OWL grandes (CL, UBERON) e NCBITAX (lab filtra genus+; species completo só com `REFERENCE_NCBITAX_INCLUDE_SPECIES=1`).

---

## 3. Quantidades

### 3.0 Totais finais full-lab (`active`, 2026-11-01T22:15Z)

| Métrica | Valor |
|---|---:|
| Releases full-lab `active` | **15** (OMIM dump de fora) |
| Conceitos | **556 020** |
| Relações `is_a` | **552 436** |
| Intake `orphanet_diseases` | **11 645** |
| Resultado do script | **`FINAL_FAIL=0`** |

| Código | Conceitos | Relações | Papel / `semanticType` |
|---|---:|---:|---|
| NCBITAX | 158 680 | 158 679 | organismos (`organism`) — genus+ |
| LOINC | 112 845 | 112 405 | observações lab (`observation`) |
| ICD10 | 98 425 | 98 424 | diagnósticos CID-10 proxy CM (`disease`) |
| HGNC | 45 290 | 45 289 | genes (`gene`) |
| ICD11 | 37 081 | 37 080 | CID-11 MMS (`disease`) |
| MONDO | 36 055 | 46 732 | doenças OBO (`disease`) |
| HPO | 20 482 | 24 436 | fenótipos (`phenotype`) |
| DCB | 12 768 | 12 760 | medicamentos BR (`medication`) |
| ORPHA | 11 645 | 0 | doenças raras (`disease`) + intake crosswalk |
| UBERON | 10 193 | 4 936 | anatomia (`anatomy`) |
| ATC | 6 996 | 6 982 | ATC/DDD (`medication`) |
| EDAM | 3 537 | 3 519 | bioinformática (`bioinformatics`) |
| CL | 1 655 | 840 | tipos celulares (`cell-type`) |
| UCUM | 329 | 328 | unidades (`unit`) |
| DUO | 39 | 26 | consentimento/uso de dados (`consent`) |

Fila do script: todos PASS (ICD10→DCB→MONDO→HGNC→ICD11→UCUM→DUO→EDAM→CL→UBERON→NCBITAX). NCBITAX fechou ~10 h antes da verificação (Exited 0).

### 3.1 Snapshot intermediário (2026-10-31T01:26Z) — histórico

| Código | Nome / papel | `semanticType` | `systemUri` | Conceitos | Relações `is_a` |
|---|---|---|---|---:|---:|
| **LOINC** | Observações/lab (Logical Observation Identifiers Names and Codes) | `observation` | `http://loinc.org` | **112 845** | **112 405** |
| **ICD10** | Diagnósticos CID-10 (lab: CMS ICD-10-CM order → códigos pontilhados; proxy WHO) | `disease` | `http://hl7.org/fhir/sid/icd-10` | **98 425** | **98 424** |
| **MONDO** | Ontologia de doenças (OBO Graphs `mondo.json`) | `disease` | `http://purl.obolibrary.org/obo/mondo.owl` | **36 055** | **46 732** |
| **HPO** | Fenótipos humanos (`hp.json`) | `phenotype` | `http://purl.obolibrary.org/obo/hp.owl` | **20 482** | **24 436** |
| **DCB** | Denominação Comum Brasileira (ANVISA xlsx) | `medication` | `https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb` | **12 768** | **12 760** |
| **ORPHA** | Doenças raras (nomenclature pack) | `disease` | `http://www.orpha.net` | **11 645** | **0** * |
| **ATC** | Classificação anatômico-terapêutica (CSV WHO ATC-DDD lab) | `medication` | `http://www.whocc.no/atc` | **6 996** | **6 982** |

\* ORPHA: hierarquia `is_a` pode estar vazia neste dump; o valor operacional está no **intake** (abaixo).

**Subtotal full-lab `active` (conceitos):** 112 845 + 98 425 + 36 055 + 20 482 + 12 768 + 11 645 + 6 996 = **299 216**  
**Subtotal relações `is_a` dessas releases:** 112 405 + 98 424 + 46 732 + 24 436 + 12 760 + 0 + 6 982 = **301 739**

### 3.2 Em promoção neste snapshot
| Código | Status | Conceitos (parcial) | Notas |
|---|---|---:|---|
| **HGNC** | `approved` (promovendo) | 3 721+ / ~45 k docs no asset | Genes (`semanticType: gene`); `systemUri` `https://www.genenames.org` |

### 3.3 Fila ainda não concluída (script)
Ordem em `lab-vm-fase2-complete.sh` após HGNC:

| Código | Papel | `semanticType` | Asset / conversor |
|---|---|---|---|
| ICD11 | CID-11 MMS | `disease` | SimpleTabulation zip → `icd11-simple-tabulation` |
| UCUM | Unidades de medida | `unit` | `ucum-essence.xml` → `ucum-xml` |
| DUO | Uso/consentimento de dados (GA4GH) | `consent` | `duo.owl` → `obo-owl` |
| EDAM | Bioinformática (ops/data/format/topic) | `bioinformatics` | `EDAM.owl` → `obo-owl` |
| CL | Tipos celulares | `cell-type` | `cl.owl` → `obo-owl` |
| UBERON | Anatomia multi-espécie | `anatomy` | `uberon.owl` → `obo-owl` |
| NCBITAX | Organismos (taxonomia) | `organism` | `taxdump.tar.gz` → `ncbitax-dump` (genus+ por padrão) |

### 3.4 Essential (Fase 1 — já `active`, fora do full-lab pack)
| Código | Papel |
|---|---|
| miabis-minimal | Vocabulário estrutural MIABIS |
| sprec-minimal | SPREC (pré-analítico) |
| rcs-gov-1.0 | Governança RCS |

(Contagem por `referenceDatasetReleaseId` no probe pode ser 0 se o essential loader grava por outro caminho — releases constam `active`.)

### 3.5 Intake Orphadata (wizard)
| Coleção | Qtd | Significado |
|---|---:|---|
| `orphanet_diseases` | **11 645** | Mesmo universo ORPHA + `relacoes` ORPHA/OMIM/CID-10 para autofill de diagnóstico |

---

## 4. Significado das relações

- Tipo padrão na promoção: **`is_a`** (`relationSystem` ≈ `rdfs:subClassOf`).
- Ligam `sourceConceptId` → `targetConceptId` (filho → pai) dentro da **mesma** `referenceDatasetReleaseId`.
- Usadas para hierarquia de busca/navegação e projeção grafo; **não** substituem o crosswalk ORPHA↔OMIM↔ICD do intake.
- Diferença típica conceitos vs relações: pais/filhos 1:N, raízes sem pai, ou (ORPHA) ausência de `is_a` no JSONL gerado.

---

## 5. Correções e decisões de lab registradas

1. **ICD10/DCB `coverage_incomplete`:** 1 e 11 códigos duplicados no Map sem exclusão → fix `DUPLICATE_CODE` (warning + exclusão) → reimport com promote OK.
2. **ICD10 asset:** proxy CMS ICD-10-CM (não dump WHO completo); adequado a lab/wizard, não autoridade clínica final.
3. **ATC:** CSV scrape/lab (`WHO ATC-DDD …csv`), não Excel oficial Orders ATC/DDD pago.
4. **NCBITAX:** default sem species massivo (evita dias extras); full dump só com env explícito.
5. **OMIM dump:** skip deliberado; intake Orpha cobre autofill.

---

## 6. Fechamento (feito)

`FINAL_FAIL=0` confirmado. Contagens finais na §3.0. Script `lab-vm-fase2-complete.sh` já não estava em execução na verificação de 2026-11-01.

---

## 7. Referências de código

- Pipeline: `api/backend/src/reference-data/reference-imports/pipeline.js`
- Promoção: `api/backend/src/services/referenceRelease.service.js`
- Registry lab: `api/backend/src/reference-data/reference-imports/lab/fullLabSources.js`
- Decisão essencial vs full pack: `docs/decisions/2026-10-29-production-reference-data.md`

---

## 8. Nomenclaturas, fontes e referências bibliográficas

Catálogo alinhado ao dicionário de fontes/referências do BioAvanceD (`docs/docs-7-27-2026/extracted/dict-01_FONTES.md`, `dict-05_REFERENCIAS.md`). As contagens desta rodada estão na §3.0; abaixo, a **identidade normativa** de cada pacote carregado (ou essential da Fase 1).

### 8.1 Full-lab (`active`, 15 releases — OMIM dump fora)

| Código | Fonte (SRC) | Papel no lab | Referência / citação |
|---|---|---|---|
| **LOINC** | SRC_LOINC | Observações/lab | Regenstrief Institute. *LOINC*. https://loinc.org/ — **REF-041** |
| **ICD10** | SRC_ICD10 | Diagnósticos legados (lab: proxy CMS ICD-10-CM → `systemUri` FHIR ICD-10) | WHO. *ICD-10*. https://icd.who.int/browse10/2019/en — ver honestidade §5.2 |
| **ICD11** | SRC_ICD11 | CID-11 MMS | WHO. *ICD-11*. https://icd.who.int/en — **REF-040** |
| **MONDO** | SRC_MONDO | Mediação de doenças (OBO) | Monarch Initiative. *Mondo Disease Ontology*. https://mondo.monarchinitiative.org/ (CC BY 4.0) |
| **HPO** | SRC_HPO | Fenótipos humanos | Monarch Initiative / HPO. *Human Phenotype Ontology*. https://human-phenotype-ontology.github.io/ |
| **ORPHA** | SRC_ORPHA | Doenças raras + intake crosswalk | ORPHAcode Team. *Orphanet Nomenclature Pack*. https://www.orphacode.org/pack-nomenclature/ — **REF-043** |
| **HGNC** | SRC_HGNC | Genes humanos | Tweedie et al. Genenames.org: the HGNC and VGNC resources in 2021. *Nucleic Acids Res.* — **REF-035** / https://www.genenames.org/ |
| **ATC** | SRC_ATC | Classificação ATC/DDD | WHO Collaborating Centre for Drug Statistics Methodology. *ATC/DDD Index*. https://www.whocc.no/atc_ddd_index/ — lab: CSV ATC-DDD (§5.3) |
| **DCB** | SRC_DCB | Denominação Comum Brasileira | ANVISA. *DCB*. https://www.gov.br/anvisa/pt-br/assuntos/farmacopeia/dcb |
| **UCUM** | SRC_UCUM | Unidades de medida | UCUM Organization. *The Unified Code for Units of Measure*. https://ucum.org/ — **REF-042** |
| **DUO** | SRC_DUO | Uso/consentimento de dados | GA4GH. *Data Use Ontology (DUO)*. https://www.ga4gh.org/product/data-use-ontology-duo/ — **REF-039** |
| **EDAM** | SRC_EDAM | Dados/formatos/ops bioinformática | *EDAM Ontology*. https://edamontology.org/ |
| **CL** | SRC_CL | Tipos celulares | OBO Foundry. *Cell Ontology*. https://obofoundry.org/ontology/cl.html |
| **UBERON** | SRC_UBERON | Anatomia multi-espécie | OBO Foundry. *Uberon*. https://obofoundry.org/ontology/uberon.html |
| **NCBITAX** | SRC_NCBITAX | Organismos (genus+ nesta rodada) | NCBI. *Taxonomy*. https://www.ncbi.nlm.nih.gov/taxonomy — §5.4 |

**OMIM:** dump oficial **não** ingerido nesta rodada; códigos OMIM no wizard vêm do mapeamento Orphadata (`ORPHA_OMIM_mapping`) — §1.3.

### 8.2 Essential (Fase 1 — já `active`)

| Código | Fonte (SRC) | Papel | Referência / citação |
|---|---|---|---|
| **miabis-minimal** | SRC_MIABIS3 | Metadados estruturais de biobanco/coleção | BBMRI-ERIC. *MIABIS*. https://github.com/BBMRI-ERIC/miabis — **REF-044** |
| **sprec-minimal** | SRC_SPREC2 | Pré-analítico (baseline RCS) | ISBER Working Group. SPREC 2.0 — https://pmc.ncbi.nlm.nih.gov/articles/PMC6463986/ |
| **rcs-gov-1.0** | SRC_RCS | Governança RCS | Ribeiro et al. RCS / materiais suplementares — **REF-045** (atualizar DOI quando publicado) |

### 8.3 Como citar este memo

Junto com as fontes acima, citar o pacote de evidência ex ante (`CITATION.cff` / DOI Zenodo da tag `ex-ante-evaluation-v1.0.1`) e declarar limites de lab da §5 (proxy ICD-10-CM, ATC CSV, NCBITAX genus+, OMIM skip).
