# Evidência Fase 3 — Avaliação ex ante completa (BLPP)

**Data:** 2026-11-01 (pacote fechado na mesma linha de execução)  
**VM (metadados):** GCP `us-central1-a` · instância `instance-20261029-155615` (IP efêmero não é dependência de reprodução — ver [fase3/ZENODO.md](fase3/ZENODO.md))  
**Artefato:** [`api/backend/scripts/lab-population/`](../../api/backend/scripts/lab-population/) + [`seed-lab-population.js`](../../api/backend/scripts/seed-lab-population.js)  
**schemaVersion:** 1.0.0  
**Fundamento:** REF-032 / SRC_SYNTHEA — conceito apenas; **sem** Synthea runtime.

## Pacote de anexos (avaliação ex ante)

| Anexo | Arquivo |
|---|---|
| Modelo capacidade | [fase3/modelo-capacidade.md](fase3/modelo-capacidade.md) |
| What-if | [fase3/what-if.md](fase3/what-if.md) |
| AIR/LGPD | [fase3/air-lgpd-checklist.md](fase3/air-lgpd-checklist.md) |
| RIPD formal lab (L12) | [fase3/ripd-formal-lab.md](fase3/ripd-formal-lab.md) |
| STRIDE lite | [fase3/stride-lite.md](fase3/stride-lite.md) |
| TCO/ROI/payback | [fase3/tco-roi-payback.md](fase3/tco-roi-payback.md) |
| Walkthrough cognitivo | [fase3/walkthrough-cognitivo.md](fase3/walkthrough-cognitivo.md) |
| UI 100% + figuras | [fase3/ui/README.md](fase3/ui/README.md) |
| RCS + liberação | [fase3/ui-rcs-liberacao.md](fase3/ui-rcs-liberacao.md) |
| Prototipagem pré-código | [fase3/prototipagem/README.md](fase3/prototipagem/README.md) |
| Re-seed service 10k | [fase3/service-reseed-metrics.md](fase3/service-reseed-metrics.md) |
| CI / E2E / Lab | [fase3/ci-e2e-lab.md](fase3/ci-e2e-lab.md) |
| Deposit Zenodo | [fase3/ZENODO.md](fase3/ZENODO.md) + `CITATION.cff` |
| Catálogo BLPP | [api/backend/scripts/lab-population/README.md](../../api/backend/scripts/lab-population/README.md) |

---

## Decisões

1. Validação primaria: **N=1.000**; teto **N=10.000** executado (lab-direct + re-seed `service`).  
2. Prototipagem pré-código: pacote reconstruído em `fase3/prototipagem/` (honestidade DSR).  
3. CI/E2E ≠ corpus lab.  
4. Travamentos: resume por chunk, sem wipe.  
5. Mongo lab promovido a **replica set** (`compose.lab-rs.yml`) para RF006/`applyMode=service`.

---

## Resultados operacionais (F3.0–F3.3)

### F3.0 Sanidade
- Conceitos **556.020**; relações **552.436**.  
- UI `:5173` → 200; API health → 200; stack healthy.  
- Mongo lab inicialmente **standalone**; promovido a **replSet `rs0` + keyFile** em 2026-11-02.

### F3.1 BLPP
- Gerador + writers + seed + progress/resume + README.  
- Unit: `lab-population.test.js` — 4 passed.

### F3.2 PoC N=100
| Métrica | Valor |
|---|---|
| seed / runId | 4242 / `blpp-4242-100-1793573859242` |
| patients / samples / consents | **100 / 100 / 100** |
| applyMode | lab-direct |

### Resume
- seed 99, N=4: stop chunk 0 → resume → 100%, sem duplicar.

### F3.3 Corpus N=1.000
| Métrica | Valor |
|---|---|
| runId | `blpp-4242-1000-1793574213768` |
| chunks | **10/10 done**, 0 failed |
| elapsedSec | **41** |
| ETA anunciada vs real | 5–15 min vs **~0,7 min** |
| Totais BLPP (com prova resume) | **1004** patients / samples / consents |
| Novos no corpus | 900 (100 idempotentes do PoC) |

### Probe Neo4j PII
- Query por keys email/patientName/phone: **nenhum hit** (probe 2026-11-01).

### F3.4 Teto N=10.000 (executado)

| Métrica | Valor |
|---|---|
| seed / runId | 4242 / `blpp-4242-10000-1793581214304` |
| chunks | **100/100 done**, 0 failed |
| elapsedSec | **505** (~8,4 min) |
| ETA anunciada | 8–15 min |
| applyMode | lab-direct |
| Totais BLPP na VM | **10004** patients / samples / consents (10000 + 4 resume-proof) |

---

## Checklist de avaliação ex ante — status final

| # | Item | Status | Onde |
|---|---|---|---|
| 1.1 | PoC | **Feito** | § F3.2 |
| 1.2 | Viabilidade técnica | **Feito** | § F3.3–F3.4 + RS + service 10k |
| 1.3 | TCO/ROI/payback | **Feito** | tco-roi-payback.md |
| 2.1 | Prototipagem pré-código | **Feito (reconstrução)** | prototipagem/ |
| 2.2 | Walkthrough cognitivo | **Feito** | walkthrough + ui/ |
| 3.1 | Modelagem + simulação | **Feito** | modelo-capacidade.md |
| 3.2 | What-if | **Feito** | what-if.md |
| 4.1 | AIR/LGPD | **Feito** | air-lgpd-checklist.md (L8–L12 fechados lab) |
| 4.2 | STRIDE lite | **Feito** | stride-lite.md |
| U | UI 100% + RCS/liberação | **Feito** | ui/ + ui-rcs-liberacao.md |
| U | Mongo RS + re-seed service | **Feito** | service-reseed-metrics.md |

### Fecho 2026-11-02 (sem residuals lab)

- UI autenticada 100% (inventário `fase3/ui/`); RCS + withdraw/return em `BR-2026-10107`.  
- RIPD lab L12 versionado; prototipagem reconstruída.  
- Re-seed **N=10000** `applyMode=service` runId `blpp-9002-10000-1793583172977` (1882 s, 0 failed).  
- Correções de produto no lab: rotas estáticas `/samples/*` antes de `:id`; detalhe com fallback `GET /samples/:id`.

---

## Como citar

1. Preferir o DOI Zenodo da tag `ex-ante-evaluation-v1.0.1` (metadados em [fase3/ZENODO.md](fase3/ZENODO.md) e `CITATION.cff`).  
2. Anexar tabelas dos arquivos `fase3/*.md` e figuras `fase3/ui/`.  
3. Declarar BLPP como artefato criado; REF-032 só fundamento conceitual.  
4. Declarar evolução `lab-direct` → `replSet` + `service` ([ci-e2e-lab.md](fase3/ci-e2e-lab.md), [service-reseed-metrics.md](fase3/service-reseed-metrics.md)).

## Limites (permanecem — honestidade DSR)

Sem prevalência clínica real; sem ensaio físico de biobanco; RIPD **institucional/DPO** continua fora do escopo técnico (RIPD lab não substitui parecer jurídico).
