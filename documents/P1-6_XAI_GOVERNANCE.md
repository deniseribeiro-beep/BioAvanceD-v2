# P1-6 — Governança Clínica de Regras XAI (Biomarcadores)

Data: 2026-03-18  
Escopo: governança do mecanismo explicável rule-based para `alphaGal` e `lysoGb3`.

## Objetivo

Estabelecer processo formal para aprovação clínica, versionamento e revisão periódica das regras XAI persistidas em `biomarkerXai` no cadastro do paciente.

## 1) Papéis mínimos

- **Owner técnico do modelo/regra:** responsável por implementação, versionamento e rastreabilidade.
- **Aprovador clínico:** responsável por validar thresholds e interpretação assistencial.
- **Responsável de compliance:** responsável por trilha de decisão e evidências para auditoria.

## 2) Variáveis de governança (backend)

- `BIOMARKER_XAI_RULE_VERSION`
- `BIOMARKER_XAI_OWNER`
- `BIOMARKER_XAI_CLINICAL_APPROVER`
- `BIOMARKER_XAI_REVIEW_CADENCE_DAYS`
- `BIOMARKER_XAI_LAST_APPROVED_AT`
- `BIOMARKER_XAI_ALPHA_GAL_HIGH_MAX`
- `BIOMARKER_XAI_ALPHA_GAL_MEDIUM_MAX`
- `BIOMARKER_XAI_LYSO_GB3_MEDIUM_MIN`
- `BIOMARKER_XAI_LYSO_GB3_HIGH_MIN`

## 3) Ciclo de mudança

1. Propor alteração de threshold com justificativa clínica e evidência bibliográfica.
2. Executar validação em base de teste/sandbox e registrar impacto.
3. Aprovação clínica formal com data (`LAST_APPROVED_AT`) e novo `RULE_VERSION`.
4. Publicar alteração em ambiente alvo e monitorar indicadores por janela definida.
5. Registrar decisão e resultado no relatório de auditoria.

## 4) Cadência de revisão

- Recomendado: revisão a cada 90 dias (ou valor definido em `BIOMARKER_XAI_REVIEW_CADENCE_DAYS`).
- Revisão extraordinária quando houver:
  - atualização de protocolo clínico,
  - mudança de metodologia laboratorial,
  - desvio relevante entre sinal XAI e conduta clínica final.

## 5) Evidências obrigatórias para auditoria

- Versão da regra aplicada (`version`).
- Data de geração do racional (`generatedAt`).
- Evidências por feature (valor, severidade, regra aplicada).
- Governança embutida (`owner`, `clinicalApprover`, `nextReviewDueAt`, `thresholds`).

## 6) Limite de escopo

- O mecanismo atual é **suporte explicável rule-based**, não diagnóstico automático.
- Qualquer decisão clínica permanece sob responsabilidade do profissional habilitado.