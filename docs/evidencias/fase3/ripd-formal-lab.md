# RIPD formal — Laboratório BioAvanceD (tese / ambiente controlado)

**Tipo:** Relatório de Impacto à Proteção de Dados para o **lab de avaliação**  
**Versão:** 1.0 — 2026-11-02  
**Escopo:** operação sintética VAL-027; sem titulares reais de pesquisa clínica  
**Disclaimer:** documento técnico-metodológico da tese; **não** substitui parecer jurídico institucional nem DPO nomeado.

## 1. Controlador / Operador (hipótese lab)

| Papel | Identificação |
|---|---|
| Controlador (hipótese) | Projeto de pesquisa BioAvanceD / autor da tese |
| Operador técnico | Stack lab GCP (`us-central1-a`) + agentes de engenharia |
| Encarregado (DPO) | A definir pela instituição — **TBD institucional** |

## 2. Finalidades do tratamento

1. Validar arquitetura e operação do biobanco digital (PoC / N=1000 / N=10000).  
2. Gerar evidências de avaliação ex ante (UI, LGPD, RCS, liberação).  
3. Reproducibilidade científica (seed BLPP) sem dados de pacientes reais.

## 3. Dados tratados

| Categoria | Exemplos | Natureza |
|---|---|---|
| Identidade civil sintética | nome, DOB, email `@example.invalid` | Sintética (BLPP) |
| Identificadores internos | participantId 8 dígitos, specimenId | Pseudônimo operacional |
| Consentimento | template + status ACTIVE | Necessário ao fluxo |
| Amostra / qualidade | tipo MIABIS, RCS, storage | Operacional |
| Logs / audit | actor, timestamps | Segurança |

**Não tratados neste lab:** dados genômicos reais, biometria real, dados de menores reais, PII de titulares clínicos.

## 4. Bases legais (lab/tese)

- Execução de estudo técnico / interesse legítimo de pesquisa metodológica com **dados sintéticos**;  
- Consentimento modelado no sistema apenas como **prova de mecanismo** (não como consentimento de titular real).

## 5. Avaliação de riscos

| Risco | Prob. | Impacto | Medida |
|---|---|---|---|
| Exposição de UI/API na internet | Média | Alto | Tunnel SSH; firewall deny-by-default |
| PII no Neo4j | Baixa | Alto | Segregação ParticipantIdentity; probe sem hits |
| Credenciais admin | Média | Alto | Bootstrap local; MFA first-login |
| Backup/restore indevido | Baixa | Alto | mongodump com acesso SSH restrito |
| Confusão dado sintético × real | Média | Médio | Markers `blppFixture`, VAL-027 |

## 6. Medidas de conformidade (implementadas / evidenciadas)

- Minimização BLPP; Identity encryption path; consentimento ACTIVE;  
- Export sob `lgpd.allowDataExport` / gates;  
- Trilha CI/E2E ≠ corpus lab;  
- RIPD este documento (L12).

## 7. Transferências

Hospedagem GCP **us-central1-a** (EUA). Declarar na tese como transferência internacional hipotética do lab; mitigação: ambiente fechado, sem titulares reais.

## 8. Direitos dos titulares

Não aplicáveis a personas sintéticas; para produção futura: portabilidade/export, exclusão scoped por `labPopulationRunId` / processo institucional.

## 9. Conclusão RIPD lab

O tratamento no lab é **aceitável sob premissa de dados sintéticos**, com riscos residuais operacionais mapeados. Produção com titulares reais exige RIPD institucional revisado por DPO/jurídico.
