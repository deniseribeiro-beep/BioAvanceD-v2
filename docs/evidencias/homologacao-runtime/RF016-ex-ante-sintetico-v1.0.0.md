# RF016 / RULE-037 — Execução sintética do Protocolo Ex Ante v1.0.0

| Campo | Valor |
|---|---|
| Protocolo | `BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0` |
| Data de execução | 2026-11-03 |
| Ambiente | Stack Compose de teste (`compose.test.yml`) + `tests/e2e/physical-chain.spec.ts` |
| Espécimes reais | **Proibidos** (VAL-027); apenas fixtures `BVA2:synthetic:*` |
| Resultado | **PASS** (sintético) |

## Escopo executado

O ensaio operacional ex ante foi realizado **sem material biológico**, usando o contrato `/api/physical-chain` e o seed de custódia sintético já empregado pelo gate E2E.

Instrumento primário: `tests/e2e/physical-chain.spec.ts` (CT-RF016-E2E-01), incluso no `scripts/e2e-gate.sh`.

## Mapeamento IDF → evidência automatizada

| ID | Critério resumido | Evidência no spec |
|---|---|---|
| IDF-001 | Identidade canônica ≠ simbologia | Labels com `encodedValue` opaco; specimenId permanece canônico |
| IDF-002 | Label versionado / unicidade | POST label + resolução por scan |
| IDF-003 | Tubo vazio = Container | Empty-tube path (`emptyTubeCode`) sem specimen |
| IDF-004 | Leitor unificado | Scan resolve tipo/alvo ou erro controlado |
| IDF-005–007 | Cadeia container/rack/posição | Custody + place/load no freezer/rack sintéticos |
| IDF-008 | Scanner lifecycle | `scannerId` registrado e usado no scan |
| IDF-009 | Escopo de custódia | Org A vs Org B; approval out-of-force bloqueia |
| IDF-010 | Sem PII na etiqueta | RULE-012: CPF em `encodedValue` → rejeição |

## Artefatos anexáveis

- Log do gate: `e2e-gate-out-wave0/e2e.txt` (trechos `physical-chain.spec.ts`)
- Código do protocolo documental: `docs/BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0.docx`
- Manifesto: `docs/RELEASE_MANIFEST.json` → `executionStatus: executed_synthetic`, `result: pass`

## Declaração

A execução sintética **não** homologa laboratório clínico com material real. Constitui evidência de runtime do protocolo v1.0.0 para publicação do artefato de software, separada da aprovação documental do modelo (2026-09-12).
