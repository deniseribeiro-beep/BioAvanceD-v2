# Rastreabilidade — Intake Wizard QA humano (2026-11-25)

| Campo | Valor |
|-------|--------|
| Data | 2026-11-25 |
| Origem do achado | **Teste humano / QA manual** (não suíte automatizada) |
| Ambiente | Homolog GCP (`:8080` / túnel SSH) — wizard `/next/intake` |
| SoT de código | `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx` + `specimen.constants` (FE/BE) |
| Commit | *pendente — lote de correções sem commit até o usuário autorizar* |

## Declaração explícita

Todas as falhas abaixo foram encontradas por **operador humano** na UI homolog.  
**Não** foram descobertas por unit/e2e/CI pré-existentes. Os testes automatizados listados foram escritos **depois**, como regressão.

---

## Achado 1 — Máscara CPF no campo Documento

### Sintoma (humano)
- `#document` / `wizard-document` sem `XXX.XXX.XXX-XX`
- Digitação parecia não reconhecida/formatada

### Causa
1. `formatCpfInput` existia, mas `onChange` usava só `formatDocumentInput` (digits-only).
2. `pattern="[0-9]*"` conflitava com máscara.

### Correção
| Arquivo | Mudança |
|---------|---------|
| `ClinicalIntakeWizard.jsx` | `formatDocumentInput` → máscara ≤11 dígitos; remove `pattern`; payload via `digitsOnly` |
| `ClinicalIntakeWizard.documentFormat.test.js` | CI máscara + validação |
| `ClinicalIntakeWizard.behaviour.test.jsx` | Formatação progressiva |
| `tests/e2e/intake-wizard.spec.ts` | `pressSequentially` → `111.444.777-35` |

---

## Achado 2 — Matriz Sólidos × MIABIS / SPREC

### Sintoma (humano)
Ao mudar Matriz SPREC para **Sólidos**, `sampleType` / `sampleOrigin` / `extractionProtocol` e eixo 1 SPREC continuavam com vocabulário de **fluidos** (ex.: Plasma, Sangue Venoso, Tubo EDTA, Urina 24h), incoerente com MIABIS/SPREC sólido e com o dicionário populado.

### Causa
1. **E1** — listas MIABIS vinham de constantes **sem filtro por matriz**.
2. **E2** — wizard não lia collections Mongo `sampleTypes|Origins|Protocols`; usava só espelho estático.
3. **E3** — troca `fluid↔solid` **não zerava** eixos SPREC / MIABIS (valores órfãos).
4. Origens/protocolos sólidos **inexistiam** nas constantes (só sangue/urina/tubos).

### Correção
| Arquivo | Mudança |
|---------|---------|
| `frontend/.../specimen.constants.js` | `matrices: ['fluid'\|'solid']`; origens/protocolos/tipos sólidos; `filterSpecimenConstantsByMatrix` |
| `api/backend/.../specimen.constants.js` | Mesmo vocabulário (SampleModel.validate) |
| `ClinicalIntakeWizard.jsx` | Options filtradas por `sprecMatrixType`; reset completo no `onChange` da matriz |
| `specimen.constants.matrix.test.js` | CI filtro fluido/sólido |
| `ClinicalIntakeWizard.behaviour.test.jsx` | Regressão filtro + reset |
| `tests/e2e/intake-wizard.spec.ts` | E2E matriz solid → opções TIS/BIOPSY/FFPE |

---

## Achado 3 — Sigla da instituição automática / read-only

### Sintoma (humano)
Campo sigla `readOnly` gerado por `generateAcronym` (1ª letra das palavras); geração frágil; sem cadastro (CNPJ, inscrição, contato).

### Causa
1. **E5** — `useEffect` sobrescrevia sigla a partir do nome.
2. **E6** — input `readOnly` / `bg-gray-100`.
3. **E7** — sem modal de cadastro de instituição.

### Correção
| Arquivo | Mudança |
|---------|---------|
| `ClinicalIntakeWizard.jsx` | Remove `generateAcronym` + effect; sigla **editável** (`wizard-institution-acronym`); modal (nome, sigla, CNPJ, inscrição, contato); zod exige sigla |
| `ClinicalIntakeWizard.behaviour.test.jsx` | Sem auto-derive; modal salva dados |
| `ClinicalIntakeWizard.clinical.test.jsx` / e2e | Preenchem sigla manualmente |
| `tests/e2e/intake-wizard.spec.ts` | E2E sigla manual `HCFMUSP` |

**Legado:** geração automática **removida por completo** (não mantida como fallback).

---

## Evidência de teste automatizado (pós-correção)

- Unit/CI local (2026-11-25):  
  `documentFormat` + `behaviour` + `clinical` + `specimen.constants.matrix` → **81 passed**.
- E2E novos em `intake-wizard.spec.ts` (CPF, matriz solid, sigla manual) — executar no gate Playwright/Docker do projeto.

## Uso deste MD

Registrar em **issue GitHub**, citando:

- Achados: **teste humano** (não auto)
- Fixes + regressões acima
- Commit/PR só quando o usuário autorizar o lote

## Achado 4 — Organização / specimenIds sem ajuda; match só por nome+nascimento

### Sintoma (humano)
- “Organização da coleta” e “Amostras de origem (specimenIds)” sem explicação; IDs crus na lista.
- Documento depois do nome; busca automática **não** usava CPF — só nome+birthDate.
- Sem picker de amostra pai para secundária vs primária.

### Correção
| Arquivo | Mudança |
|---------|---------|
| `api/.../intakeWizard.js` | `GET /patient-match` aceita `identityDocument`; retorna `samples[]` do participante |
| `ClinicalIntakeWizard.jsx` | Documento primeiro; match por CPF; autofill; `?` help; picker de origem; labels org `nome (id)` |
| `Input.tsx` / `Select.tsx` | `labelAdornment` + `helperText` no Select |
| Testes BE/FE | Match por documento + help + picker |

**Resolvido neste wave:** keepalive de sessão (`auth/keepalive` + `useActivityDetector`) + rascunho local do wizard (`bioavanced.intakeWizard.draft.v1`) até Limpar/Novo/submit.

## Achado 5 — Busca doença (ORPHA/CID) não preenche códigos nem HPO

### Sintoma (humano)
Passo 3: “Buscar doença em Orphadata” não preenchia CID-10 / ORPHA / OMIM; seções HPO/biomarcadores ficavam em “Selecione uma doença…”.

### Causa
1. Busca só em `GET /terminologies` (Mongo); label dizia Orphadata; `/dictionary/search` (Neo4j) não era usado.
2. Seed essencial não popula ORPHA em `terminologies`; sync remoto desligado por default.
3. Preenchimento só no clique do resultado; digitar zera códigos.
4. `hasSelectedDisease` incluía `diagnosisQuery` (texto solto fingia seleção parcial).
5. `/dictionary/suggest` era rígido no formato do código no nó Neo4j.

### Correção
| Arquivo | Mudança |
|---------|---------|
| `ClinicalIntakeWizard.jsx` | Busca paralela `/dictionary/search` + `/terminologies`; merge CID/OMIM; label ORPHA/CID; blur seguro; badge/toast; `hasSelectedDisease` só por códigos |
| `dictionary.js` | `suggest` aceita `324` e `ORPHA:324`; fallback local também por `codigo` numérico |
| Testes FE/BE | Merge helpers; suggest prefixado; mocks de `/dictionary/search` |

### Ops homolog
Precisa de `terminologies` com ORPHA **ou** Neo4j `Doenca_ORPHA`. Remoto: `ALLOW_EXTERNAL_TERMINOLOGY_SYNC=true` + `ORPHADATA_BASE_URL`.

## Achado 6 — Passo 3 catálogos / TCLE geo / biomarcadores (wave SIGTAP+MarkerDB)

### Sintoma (plano)
Procedimento manual sem SIGTAP; alergia DCB; sem toggle controle saudável; WASHOUT apagava medicação; TCLE presencial só texto livre; lista biomarcadores vazia / SKIP-001; sem rascunho local.

### Correção (2026-11-25)
| Área | Mudança |
|------|---------|
| SIGTAP | `convertSigtapTabelaToJsonl` + import `terminologyConcepts` + `GET /dictionary/procedures/search` (+ CRUD institucional) |
| Wizard | Typeahead ATC alergia; SIGTAP procedimentos; `wizard-healthy-control`; WASHOUT preserva meds; outcomes Curado/Alta; draft localStorage; copy Orphanet local |
| TCLE | `InPersonConsentModal` + Nominatim/`readPanelLocation`; BE `location` em evidence/consent |
| Biomarcadores | Fixture 16 importada GCP; CTA empty-state; MANUAL_VERIFY SKIP-001/SKIP-SEED-BIO → PASS |
| Neo4j outbox BiomarkerAssociation | **PHR-003 DECIDED 2026-11-26** — contrato `BIOMARKER_ASSOCIATION_UPSERTED` (ADR RF023); merge Mongo permanece como fallback |

### Decisões humanas 2026-11-26
Ver `PENDING_HUMAN_REVIEW_20261125_passo3_wave.md` (DECIDED). Git: `feature/docker-e2e-backend-integration` → `main` após gate GCP 0 failed. Zenodo pack preparado localmente; DOI manual. TCLE gov.br/ICP após verde.

### Gate GCP (evidência)
- Tip: `acf7f16f` — OUT `e2e-gate-out-phr-20261126-051234` — `E2E_GATE_EXIT=0` — **605 passed / 1 skipped / 0 failed** (14.0m)
- Inclui: axe `/facility-management`, ui-mongo-binding samples, inline-storage-movement, audit-chain-integrity, `tcle-govbr-icp`

### Dumps / Mongo (fechamento 2026-11-26)
- Docs/staging: 9 pares MarkerDB TSV+XML + JSONL 2505; Zenodo pack `docs/data/zenodo-pack/` (manifest+checksums+zip)
- Prod `bioavanced_dev`: `terminologyConcepts=556020` (full-lab HPO/ORPHA/MONDO/LOINC/…); `biomarkerAssociations=2521` (2505 MarkerDB + 16 fixture ORPHA; Fabry GLA/lyso-Gb3)
- Test stack: `biomarkerAssociations=2521`
- Fora deste fechamento (documentado stub/sample): SIGTAP full na coleção (só sample no pack), SRC_CPATH/SRC_FDA_PGX sem dump

### Critérios smoke
- `/biomarker-associations` itemCount > 0; suggest ORPHA fixture com biomarkers.length > 0 (Mongo)
- Wizard: buscar procedimento SIGTAP; alergia ATC; GPS sugere Local da coleta
- Rascunho: reload parcial restaura campos até Limpar/submit
- Pós-full: count >> 16; Neo4j `POSSUI_BIOMARCADOR` após outbox; gate e2e 0 failed

## Checklist de fechamento da issue (sugerido)

- [ ] Revisar UX no homolog após deploy do tip (CPF, sólidos MIABIS, sigla/modal, documento-primeiro, busca doença)
- [ ] Smoke: Fabry/324 → select → CID/ORPHA/OMIM + HPO + biomarcadores
- [ ] Smoke: procedimentos SIGTAP + alergia ATC + TCLE geo
- [x] MarkerDB full + outbox + gate GCP 0 failed
- [x] Commit/merge `feature/docker-e2e-backend-integration` → `main` (skip CI após evidência)
- [ ] Pack Zenodo publicado (DOI operador)
- [x] TCLE gov.br/ICP (fase pós-verde) — mock OIDC + e2e + ADR + MANUAL_VERIFY
