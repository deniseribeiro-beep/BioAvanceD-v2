# Zenodo deposit — BioAvanceD ex-ante evaluation (v1.0.0)

| Field | Value |
|---|---|
| Title | BioAvanceD ex-ante evaluation evidence package (BLPP + lab evaluation artefacts) |
| Version | `ex-ante-evaluation-v1.0.1` |
| Authors | Denise Ribeiro (Universidade São Francisco — USF) |
| Contact | denise.ribeiro@mail.usf.edu.br |
| License (this package) | Same as the BioAvanceD-v2 repository license at deposit time |
| Scope | Design Science Research (DSR) **ex-ante** evaluation artefacts and lab run evidence |
| Software artefact | BioAvanceD Lab Population Pattern (BLPP) `schemaVersion` **1.0.0** |
| Privacy | **VAL-027** / synthetic lab population only — **no real PII**; LGPD Identity path for fixture patients |
| Not included | Thesis prose (`prosa-capitulo-avaliacao.md`), UI product patches, VM ops playbooks, `_tmp` probes, INPI freeze archive |

## Lab environment (metadata only)

| Item | Value |
|---|---|
| Provider / zone | Google Cloud Platform · `us-central1-a` |
| Instance name | `instance-20261029-155615` |
| Role | Ephemeral lab host for Fase 2 reference population + Fase 3 BLPP / UI evidence |
| Stack | Docker Compose: `compose.yml` + `compose.dev.yml` + `compose.lab-rs.yml` (+ `compose.lab.yml` for full-lab reference imports) |
| Mongo | Single-node replica set `rs0` with keyFile (RF006 transactions / `applyMode=service`) |
| Access pattern | Local SSH tunnel to UI/API ports; do **not** treat ephemeral public IPs as a reproducibility dependency |
| Data stores named in runs | Mongo DB `bioavanced_dev` (synthetic) |

Generate the Mongo keyFile locally as documented in `infra/mongo/README.md` — the keyfile itself is **not** deposited.

## Primary runIds (BLPP)

| Run | seed | N | applyMode | runId |
|---|---|---|---|---|
| PoC | 4242 | 100 | lab-direct | `blpp-4242-100-1793573859242` |
| Corpus | 4242 | 1000 | lab-direct | `blpp-4242-1000-1793574213768` |
| Cap (lab-direct) | 4242 | 10000 | lab-direct | `blpp-4242-10000-1793581214304` |
| Cap (service) | 9002 | 10000 | service | `blpp-9002-10000-1793583172977` |

## Package layout

- `docs/evidencias/2026-10-30-fase2-full-lab-populacao.md` — Fase 2 full-lab reference population memo  
- `docs/evidencias/2026-11-01-fase3-lab-population-ex-ante.md` — Fase 3 ex-ante index / evaluation checklist  
 
- `docs/evidencias/fase3/**` — capacity, what-if, AIR/LGPD, RIPD lab, STRIDE, TCO, walkthrough, UI screenshots, RCS/liberação, prototipagem, CI/E2E vs lab, service re-seed metrics  
- `api/backend/scripts/lab-population/**` + `seed-lab-population.js` + unit test — BLPP method (self-contained ZIP)  
- `compose.lab-rs.yml` + `infra/mongo/README.md` — replica-set overlay for RF006  

## How to cite

Prefer the Zenodo DOI assigned to tag `ex-ante-evaluation-v1.0.1` once minted. Until then, cite the GitHub tag and this file. Software citation metadata: root `CITATION.cff`.

## Limits (DSR honesty)

No real clinical prevalence; no physical biobank assay; lab RIPD does **not** replace institutional/DPO legal opinion. REF-032 / Synthea is **conceptual** only — BLPP is an original BioAvanceD artefact.
