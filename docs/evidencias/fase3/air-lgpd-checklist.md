# Checklist AIR / LGPD — avaliação ex ante (Fase 3)

Escopo: conceito e operação sintética no lab (VAL-027: sem espécimes/PII reais de titulares).

| # | Controle | Evidência no sistema | Status F3 |
|---|---|---|---|
| L1 | Base legal / finalidade de teste | População sintética BLPP; e-mails `@example.invalid`; VAL-027 | OK |
| L2 | Minimização | Gerador só campos necessários ao fluxo (nome, DOB, sexo, email, amostra) | OK |
| L3 | Segregação de identidade | `ParticipantIdentity` via `patient.service` / encryptIdentityFields; PII não no Neo4j no desenho RF005 | OK (lab-direct pacientes) |
| L4 | Consentimento antes de uso | Template BLPP + `patientConsents` ACTIVE por participante | OK (1000+) |
| L5 | Sem prevalência clínica real | BLPP não afirma epidemiologia; clinicalSubset é placeholder | OK / limite declarado |
| L6 | Auditoria | createPatient + markers `sourceSystem`/`labPopulationRunId`; movements/outbox via applyMode `service` + RS | OK (service N=10k + withdraw/return) |
| L7 | Retenção / marcação de lote | `blppFixture`, `labPopulationRunId` permitem delete scoped | OK |
| L8 | Export / portabilidade | Gate `lgpd.allowDataExport`; superfícies Reports/Dictionary/logs export na UI | OK lab (gate documentado) |
| L9 | Acesso (RBAC/org scope) | UI admin autenticado; System Management Users/Security; rotas `requiredRole` | OK (prova visual) |
| L10 | Dados sensíveis em logs | Logs BLPP usam participantId; nomes não ecoados em chunk logs | OK observado |
| L11 | Transferência internacional | VM GCP **us-central1-a**; declarado no RIPD lab §7 | OK declarado |
| L12 | Encarregado / RIPD formal | `fase3/ripd-formal-lab.md` (tese/lab; DPO TBD institucional) | OK lab |

## Parecer AIR (conceitual)

O desenho do BioAvanceD **é aderente** aos princípios LGPD testáveis no lab (segregação, consentimento, minimização, sinteticidade). Residuais **fechados no lab** em 2026-11-02 (L8 superfície+gate, L9 UI, L11 declaração GCP, L12 RIPD lab). Produção com titulares reais continua a exigir RIPD institucional/DPO.
