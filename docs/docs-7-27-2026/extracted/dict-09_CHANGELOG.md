# 09_CHANGELOG

BioAvanceD — Changelog do dicionário

Histórico das alterações do dicionário consolidado, com versão, data, mudança realizada e impacto no modelo.

| Versão | Data | Mudança | Impacto |
|---|---|---|---|
| 1.2.0 | 2026-07-21 | Análise da branch main@41995cf e atualização do modelo-alvo. | Base para diagramas e próximo alinhamento Codex. |
| 1.2.0 | 2026-07-21 | Donor/donorId substituídos canonicamente por Participant/participantId, com rastreabilidade do baseline. | Unifica documentação e código. |
| 1.2.0 | 2026-07-21 | Adicionada ParticipantIdentity com 17 variáveis protegidas. | Segregação de identidade. |
| 1.2.0 | 2026-07-21 | Adicionados 6 campos de ConsentTemplate e 5 de Consent. | Alinha eConsent alvo ao main. |
| 1.2.0 | 2026-07-21 | Adicionado GraphProjectionOutboxEvent com 19 variáveis. | Formaliza a projeção Neo4j. |
| 1.2.0 | 2026-07-21 | Separadas condições MIABIS, DUO e texto local em Collection. | Evita mistura semântica. |
| 1.2.0 | 2026-07-21 | RetentionDisposition resolvido semanticamente: RetentionPolicy na Fase 1 e DispositionAction na Fase 2. | Separa a regra de retenção da ação efetivamente executada. |
| 1.2.0 | 2026-07-21 | Corrigida persistência: FHIR é boundary, não banco operacional. | Alinhamento arquitetural. |
| 1.2.0 | 2026-07-21 | Total atualizado para 817 elementos; Fase 1 para 643. | 50 novas extensões P1-Target. |
| 1.3.0 | 2026-07-22 | Foundation Data Pipeline adotado como preparação estrutural integral da Fase 1. | Fases 2 e 3 passam a representar população de dados, não expansão do dicionário. |
| 1.3.0 | 2026-07-22 | Adicionadas seis entidades técnicas com 112 variáveis: FoundationDataRun, ReferenceDatasetRelease, ReferenceImportRun, ReferenceImportIssue, TerminologyConcept e TerminologyRelation. | Total canônico atualizado de 817 para 929 elementos. |
| 1.3.0 | 2026-07-22 | Todos os 929 elementos foram classificados estruturalmente como Fase 1. | Schemas, validators, índices e contratos devem existir antes das cargas posteriores. |
| 1.3.0 | 2026-07-22 | Removidos MIABIS mínimo e SPREC mínimo como conceitos do modelo-alvo; o manifesto reduzido da main foi marcado como evidência legada. | O levantamento integral do XLSX prevalece sobre seeds reduzidos. |
| 1.3.0 | 2026-07-22 | Atualizados escopo, fontes, interoperabilidade, priorização, dashboard, alinhamento de código e gaps da main. | Planilha coerente com o plano integrado Foundation Data Pipeline v2.0.0. |
