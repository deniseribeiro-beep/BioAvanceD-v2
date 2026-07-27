# 08_MAIN_GAPS

BioAvanceD — Matriz main → modelo-alvo

Base: main@41995cf; usada para o próximo prompt de alinhamento do código.

| Área | Evidência no main | Lacuna | Modelo-alvo | Gate de conclusão | Fase |
|---|---|---|---|---|---|
| Participant | ParticipantModel + participantId | Identidade direta misturada | Participant + ParticipantIdentity | Sem identificador direto no registro científico/grafo | Fase 1 |
| Specimen | Sample.js amplo | RCS/SPREC/storage/clinical misturados | Entidades separadas | Schemas e referências aprovados | Fase 1 |
| Consent | Consent instance + /update legado | Dois caminhos sem semântica única | ConsentTemplate + Consent | Toda mudança possui consentId e outbox | Fase 1 |
| Graph | Outbox implementado | Payload aliases e rótulos transitórios | GraphProjectionOutboxEvent | Todo Neo4j write deriva do outbox canônico | Fase 1 |
| Security | accessType/roles estáticos | RBAC não normalizado | Role/Permission/Assignment | Middleware usa códigos estáveis | Fase 1 |
| Audit | Log aliases | Contrato inconsistente | AuditEvent | Evento append-only validado por schema | Fase 1 |
| FHIR | Converter puro | Cobertura mínima | Boundary expandida por profiles | Sem persistência ou efeitos colaterais | Fase 1 |
| Foundation Data Pipeline | Manifesto legado com três entradas reduzidas | Não cobre o dicionário integral nem controla execuções/releases | FoundationDataRun + bootstrap integral | 929 elementos verificados; job idempotente executado após healthchecks | Fase 1 |
| Reference data pipeline | Importadores ausentes ou placeholders | Sem release, staging, issues, promoção e rollback padronizados | ReferenceDatasetRelease + ReferenceImportRun + ReferenceImportIssue + TerminologyConcept + TerminologyRelation | Cada dataset possui versão, checksum, licença, relatório e release ativa | Fase 2 |
| Operational/scientific population | Modelos e superfícies legadas dispersas | Sem ingestão completa e governada dos dados reais/sintéticos | Pipelines operacionais por domínio sobre os schemas da Fase 1 | Carga validada com consentimento, proveniência, auditoria e outbox | Fase 3 |
