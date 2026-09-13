# 07_ALINHAMENTO_CODIGO

BioAvanceD — Alinhamento do modelo-alvo com a branch main

Snapshot: main HEAD 41995cfaff5f11f0636358ad66d63876eed7d10d; code baseline 653dead6f1182110b6050170b1a951c7f27c4116. Revisão do modelo-alvo: 2026-07-22.

1. Estado por domínio

| Domínio | Main atual | Modelo-alvo | Status | Prioridade | Evidência | Próxima ação |
|---|---|---|---|---|---|---|
| Participant | participantId canonicalizado; dados civis e científicos misturados | Participant + ParticipantIdentity | Parcial | Crítica | Patient.js; patient.service.js | Segregar identidade e proibir projeção direta |
| Specimen | specimenId/participantId; documento amplo e Mixed | Specimen + SPREC + RCS + storage/custody separados | Parcial | Crítica | Sample.js; frontend types | Canonicalizar espécime, custódia e storage |
| eConsent | instância create/revoke + outbox; /update legado | ConsentTemplate + Consent versionado por consentId | Parcial | Crítica | eConsent.js; consent.service.js | Retirar fluxo legado e unificar template/policy |
| FHIR | serialização pura | Boundary de interoperabilidade | Concluído | Manter | fhir.service.js | Preservar testes sem efeitos colaterais |
| Neo4j outbox | outbox durável implementado | GraphProjectionOutboxEvent explícito | Parcial | Crítica | neo4jOutbox.service.js | Alinhar payloads e rótulos canônicos |
| RBAC | accessType + roleName estático | Role/Permission/UserRoleAssignment | Parcial | Alta | roles.min.json; User.js | Normalizar após congelar modelo |
| MFA/Sessão | funcional | UserAccount/Session/RecoveryCodeSet protegidos | Parcial | Alta | auth/session/user-security | Alinhar nomes, hashes e segredos |
| Auditoria | logs, hash e Merkle presentes | AuditEvent canônico append-only | Parcial | Alta | Log.js/audit services | Remover aliases e aplicar retenção |
| Foundation Data Pipeline | Manifesto legado reduzido; execução manual | Bootstrap integral de 929 elementos e seis entidades técnicas | Gap crítico | Crítica | essential/manifest.js; dicionário v1.3.0 | Substituir o seed legado por job one-shot idempotente acoplado à build após healthchecks |
| Fase 2 — referências | Importadores extensos ausentes ou placeholders | Cargas versionadas de HPO, MONDO, ORPHA, CID, OMIM, HGNC, LOINC, UCUM, ATC, DCB e demais fontes | Planejado | Crítica | scripts/importers; 01_FONTES | Implementar aquisição, staging, validação, promoção, rollback e outbox |
| Fase 3 — dados operacionais | Superfícies legadas e modelos incompletos | População controlada de participantes, consentimentos, amostras, clínica, telemetria, ensaios, arquivos, workflows e ômicas | Planejado | Alta | models/services atuais | Implementar somente após Foundation e referências estarem verificadas |

## 2. Papéis observados no main

| roleCode alvo | Rótulo atual | accessType legado | Permissões observadas | Status | Decisão | Fonte |
|---|---|---|---|---|---|---|
| external_user | Usuário Externo | 1 | viewReports | Legado funcional | Persistir roleCode estável; accessType apenas migração | roles.min.json |
| technician | Técnico | 2 | createSample; withdrawSample; viewTemperature; uploadFiles; viewReports | Legado funcional | Persistir roleCode estável; backend autoritativo | roles.min.json |
| coordinator | Coordenador | 3 | createUser; createSample; editSample; createPatient; withdrawSample; arquivos; temperatura; relatórios | Legado funcional | Separar Permission e assignment | roles.min.json |
| administrator | Administrador | 4 | Permissões amplas + deleteSample; manageBackup; manageSystem; resetMFA | Legado funcional | Separar Permission e assignment | roles.min.json |

## 3. Migrações prioritárias

| Campo/superfície atual | Destino canônico | Status main | Regra | Entidade | Prioridade | Observação |
|---|---|---|---|---|---|---|
| Donor/donorId em documentos | Participant/participantId | Documental | Renomear no modelo e novos contratos; preservar apenas histórico | Participant | Crítica | MIABIS Sample Donor é mapeamento semântico |
| patientName/birthDate/identityDocument no registro científico | ParticipantIdentity | Não implementado | Segregar, cifrar e não projetar ao grafo | ParticipantIdentity | Crítica | Nome e data exata não pertencem ao grafo científico |
| Sample.RCS/SPREC/storage Mixed | Entidades separadas | Não implementado | Usar referências e snapshots versionados | Specimen | Crítica | Não duplicar fonte canônica |
| ConsentPolicy + ConsentTemplate | ConsentTemplate | Parcial | Unificar versões e permissões do termo | ConsentTemplate | Crítica | Consent permanece decisão do participante |
| eConsent /update | Consent por consentId | Legado ativo | Criar/revogar versão e emitir outbox | Consent | Crítica | Remover side effects sem evidência canônica |
| donorKey/sampleId no outbox | participantId/specimenId | Parcial | Atualizar produtor e consumidor na mesma versão de schema | GraphProjectionOutboxEvent | Crítica | Sem dual-write |
| accessType/roleName | Role/UserRoleAssignment | Legado ativo | Migrar tokens e persistência progressivamente | Administração | Alta | Frontend guard não substitui backend |
| frontend src/types/models.ts | Contratos gerados por domínio | Legado ativo | Eliminar aliases, snake_case e interfaces monolíticas | Frontend | Crítica | Depois dos diagramas aprovados |
