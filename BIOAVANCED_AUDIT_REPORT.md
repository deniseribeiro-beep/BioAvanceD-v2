# BIOAVANCED_AUDIT_REPORT

**Data da auditoria:** 2026-03-18  
**Escopo:** Auditoria técnica estática (código-fonte + configuração) com foco ISO 20387, HL7 FHIR R4, LGPD e integração poliglota (MongoDB + Neo4j + InfluxDB).

---

## 0) Sumário Executivo

- **Resultado geral:** **Conformidade parcial avançada**.
- **Pontos fortes:**
  - Arquitetura poliglota real com integração operacional entre MongoDB, Neo4j e InfluxDB.
  - Cadeia de custódia com abordagem **pre-Mongo validation + compensação (SAGA)** no Neo4j.
  - Estrutura hierárquica de storage implementada (Freezer > Shelf > Rack > Box > Position).
  - RBAC funcional com perfis centrais e enforcement em rotas críticas.
  - Trilha de integridade com Merkle para logs de auditoria.
- **Gaps críticos (P0):**
  - **DataMatrix/Code128**: parser e metadados de simbologia implementados; permanece pendente geração/decodificação de imagem industrial completa.
  - **AES-256-GCM**: criptografia aplicada a campos sensíveis de paciente (`alphaGal`, `lysoGb3`, `representativeCpf`); permanece pendente expansão para cobertura total de PII e rotação formal de chaves.
  - **MQTT**: ingestão MQTT implementada no backend e integrada ao ciclo de vida da aplicação; permanece pendente validação operacional com broker homologado e trilha assinada de ingestão.
  - **Tipos de amostra**: cobertura de `Eritrócitos` e `DBS` implementada no validador principal.
- **Progresso Onda P1:**
  - **Imutabilidade de auditoria (sample_movements)**: proteção append-only em runtime implementada no backend (bloqueio de update/delete/replace), com índices de integridade e hash encadeado por evento.
  - **Imutabilidade de auditoria (P1-5) em hardening operacional**: script de role/ACL append-only e guia WORM adicionados; permanece pendente aplicação controlada em produção e revisão de privilégios herdados.

---

## 1) Mapeamento de Requisitos (RF/RNF)

> Escala: **Atendido**, **Parcial**, **Não Evidenciado**

| Requisito | Status | Evidência resumida |
|---|---|---|
| RF001 – Login/MFA | **Atendido** | Middleware JWT + verificação de sessão/MFA em `auth.js`; serviços de autenticação e segurança.
| RF003 – Cadastro de usuário | **Atendido** | Rotas + RBAC + validações de senha/força/reuso.
| RF004 – Cadastro de amostra | **Parcial avançado** | Validação MIABIS + FHIR sync + lineage + parser/simbologia de barcode; pendente camada completa de geração/decodificação DataMatrix/Code128.
| RF005 – Cadastro de paciente | **Atendido** | Service com validações, anonimização, sync FHIR e criptografia de campos sensíveis selecionados.
| RF006 – Retirada/devolução amostra | **Atendido** | Ledger de movimentação e atualização de status/quantidade.
| RF007 – Upload/importação | **Atendido** | Rotas/serviços e integração de logs.
| RF008 – Relatórios | **Atendido** | Estrutura de rotas e serviços de compliance/reporting.
| RF009 – Temperatura/Sensores | **Parcial avançado** | Persistência em Mongo + Influx + ingestão MQTT opcional por ambiente (`MQTT_ENABLED`, `MQTT_URL`, `MQTT_TOPIC`).
| RF010 – Backup | **Atendido** | Rotas/serviços de backup e scripts de operação.
| RF011 – Assistente Inteligente | **Parcial** | Assistente rule-based com respostas estáticas; XAI biomarcador não evidenciado.
| RNF008 – RBAC (least privilege) | **Atendido** | `requirePermission` com papéis 1..4 (Externo, Técnico, Coordenador, Administrador).
| RNF009 – Auditoria e rastreabilidade | **Parcial avançado** | Logs + hash + Merkle root diária; imutabilidade sem proteção WORM/append-only hard.
| RNF011 – Integridade de dados | **Parcial avançado** | Checks de validação e Merkle para logs; biomarcadores já persistidos em série temporal e campos clínicos sensíveis cifrados, pendente prova criptográfica ponta-a-ponta para biomarcadores.

---

## 2) Auditoria Técnica por Objetivo

### 2.1 Gestão de amostras e rastreabilidade física

**Status:** **Parcial avançado**

- Hierarquia física implementada em modelos:
  - `StorageContainer` com `containerType` (`FREEZER`, `SHELF`, `RACK`) e validação de parentesco.
  - `StorageBox` com `dimension`, `occupancyGrid` e validação de posição.
  - `StoragePath` com mapeamento `freezerId/shelfId/rackId/boxId` e `path`.
- Cadeia de custódia:
  - Use cases de `allocate/move/release` executam validação de linhagem no Neo4j antes do commit Mongo.
  - Registro de evento em Neo4j (`CustodyEvent`) com `actorId`, `happenedAt`, `reason`.
  - Registro em Mongo (`sample_movements`) com campos de ator e timestamp.
- **Status pós-remediação:** parser de leitura com inferência de simbologia por prefixo de scanner e geração de metadados para `Code128`/`DataMatrix` implementados.
- **Gap residual:** camada de geração/decodificação de imagem de barcode industrial ainda não evidenciada.
- **Status pós-remediação:** tipos de amostra exigidos foram ampliados no validador principal para incluir `Eritrócitos` e `DBS`.

### 2.2 Persistência poliglota e ponteiros semânticos

**Status:** **Parcial avançado**

- MongoDB: dados clínicos e coleções canônicas/FHIR.
- Neo4j: `LineageRepository` com validação de consentimento e eventos de custódia.
- InfluxDB: telemetria `freezer_temperature` e série de biomarcadores `patient_biomarkers`.
- Semantic pointers:
  - `buildNeo4jSemanticPointer()` cria ponteiros `mongo://<collection>/<id>`.
  - `fhir-sync.service` persiste `semanticPointers` em documentos FHIR e usa referência cruzada.
- **Status pós-remediação:** serviço dedicado de ingestão MQTT implementado (`start/stop`, subscribe em tópico configurável, parse de payload e encaminhamento para pipeline de telemetria).
- **Gap residual:** falta homologação operacional com broker produtivo e evidência de assinatura/verificação de trilha de ingestão.

### 2.3 Segurança e Privacy by Design (LGPD/ISO 20387)

**Status:** **Parcial**

- RBAC por função implementado (Externo, Técnico, Coordenador, Administrador) com middleware dedicado.
- MFA, auditoria de acesso e bloqueio por consentimento (authConsent) implementados.
- TLS:
  - Nginx com `ssl_protocols TLSv1.2 TLSv1.3` (não estritamente TLS 1.3-only em todos os pontos).
- Criptografia em repouso:
  - Utilitário de criptografia de campo com **AES-256-GCM** implementado e aplicado a campos sensíveis selecionados no domínio de pacientes.
  - **Gap residual:** expansão para cobertura completa de PII sensível e política de rotação/versionamento de chave (key-id).
- Integridade:
  - Merkle Tree e `auditHash` para logs/auditoria diária.
  - **Gap:** biomarcadores ($\alpha$-Gal e Lyso-GB3) não possuem prova criptográfica de integridade fim-a-fim no mesmo padrão de auditoria de logs.

### 2.4 Inteligência Artificial Explicável (XAI)

**Status:** **Parcial avançado (MVP rule-based implementado)**

- O “Assistente Inteligente” atual é predominantemente **rule-based** e orientado por textos contextuais.
- Camada de explicabilidade biomarcadora implementada com regras determinísticas e persistência de rationale no paciente (`biomarkerXai`).
- O resultado inclui: versão de regra, confiança, evidências por feature (`alphaGal`, `lysoGb3`), recomendação e disclaimer clínico.
- O resultado agora inclui também metadados de governança (`owner`, `clinicalApprover`, `reviewCadenceDays`, `nextReviewDueAt` e `thresholds`), parametrizáveis por ambiente.
- Conclusão: houve avanço concreto em XAI auditável com governança técnica versionada; permanece pendente validação clínica formal contínua.

---

## 3) Evidências Técnicas (snippets)

### 3.1 Hierarquia física Freezer > Shelf > Rack > Box > Position

```js
// StorageContainer: tipos hierárquicos
containerType: {
  type: String,
  enum: ["FREEZER", "SHELF", "RACK"],
  required: true,
}
```

```js
// StoragePath: vínculo completo da cadeia física
boxId, rackId, shelfId, freezerId, path
```

### 3.2 Cadeia de custódia (Neo4j + Mongo)

```js
// Neo4j LineageRepository
CREATE (event:CustodyEvent {
  id: $eventId,
  eventType: $eventType,
  happenedAt: datetime($happenedAt),
  actorId: $actorId,
  reason: $reason
})
MERGE (sample)-[:HAS_CUSTODY_EVENT]->(event)
```

```js
// MongoAuditRepository (ledger)
await movementsCollection.insertOne({
  movementID,
  sampleID: input.sampleId,
  type: input.eventType,
  userId: input?.context?.actor?.userId || null,
  timestamp: input.timestamp,
  immutable: true
})
```

### 3.3 Semantic pointers Mongo ↔ Neo4j

```js
function buildNeo4jSemanticPointer({ mongoId, collection }) {
  return {
    id: String(mongoId),
    pointer: `mongo://${collection}/${String(mongoId)}`
  };
}
```

```js
// FHIR sync (Specimen)
semanticPointers: {
  mongoSampleId,
  mongoPatientId,
  neo4jSamplePointer,
  lineageManagedInNeo4j: true
}
```

### 3.4 InfluxDB telemetria e biomarcadores

```js
// IoT -> Influx
const point = new Point('freezer_temperature')
  .floatField('temperatureValue', Number(reading.temperatureValue))
```

```js
// Biomarcadores -> Influx
const point = new Point('patient_biomarkers')
  .floatField('alphaGal', alphaGal)
  .floatField('lysoGb3', lysoGb3)
```

### 3.5 RBAC e papéis

```js
// accessType
// 1=UsuarioExterno, 2=Tecnico, 3=Coordenador, 4=Administrador
const permissions = {
  createSample: [2,3,4],
  createPatient: [3,4],
  manageSystem: [4]
}
```

### 3.6 Merkle/auditoria

```js
// integrityCheckService
const hash = doc.auditHash || computeAuditHash(doc);
const tree = merkleTree.buildMerkleTree(leaves);
```

---

## 4) Plano de Correção (status por ondas)

## Onda P0 (imediato, bloqueante para conformidade plena)

1. **DataMatrix e Code 128** — **Parcialmente concluído**
  - ✅ Persistência de metadados de simbologia (payload canônico, prefixos de scanner e checksum hints).
  - ✅ Leitura/normalização na entrada (scanner pipeline com parse de prefixo).
  - ⏳ Pendente: geração/decodificação de imagem/byte payload industrial end-to-end.

2. **Criptografia em repouso (AES-256-GCM) para campos sensíveis** — **Parcialmente concluído**
  - ✅ Criptografia/decriptografia transparente implementada para `alphaGal`, `lysoGb3` e `representativeCpf`.
  - ⏳ Pendente: cobertura total de PII sensível, key-id explícito e rotação formal de chaves.

3. **Conformidade MQTT para telemetria IoT** — **Concluído (nível de código) / Pendente (homologação)**
  - ✅ Cliente MQTT com subscribe em tópico configurável, tratamento de payload e integração ao pipeline existente.
  - ✅ Integração ao lifecycle de boot/shutdown do backend.
  - ⏳ Pendente: homologação com broker oficial do ambiente e trilha de ingestão assinada.

4. **Completar taxonomia de tipo de amostra** — **Concluído**
  - ✅ Inclusão explícita de `Eritrócitos` e `DBS` no validador central de amostras.

## Onda P1 (curto prazo)

5. **Imutabilidade forte de auditoria** — **Parcialmente concluído**
  - ✅ Bloqueio técnico de `update/delete/replace` para `sample_movements` no backend (append-only guard).
  - ✅ Índices de integridade para `sample_movements` (incluindo unicidade de `movementID` e `chainHash`).
  - ✅ Assinatura encadeada por evento implementada (`chainPrevHash` + `chainHash` SHA-256).
  - ✅ Script operacional para role/ACL append-only disponível em `backend/scripts/enforce-sample-movements-append-only-role.js`.
  - ✅ Guia operacional WORM/append-only documentado em `documents/P1-5_DB_APPEND_ONLY_HARDENING.md`.
  - ⏳ Pendente: aplicação em produção (janela controlada) e remoção/restrição de privilégios mutáveis herdados do usuário de aplicação.

6. **XAI para biomarcadores**
  - **Status:** **Parcial avançado (MVP + governança técnica)**.
  - ✅ Serviço de explicabilidade determinística implementado para `alphaGal` e `lysoGb3`.
  - ✅ Evidências explícitas por feature (regra aplicada, direção, severidade, valor e unidade).
  - ✅ Persistência de rationale, recomendação, confiança e versão de regra no registro do paciente (`biomarkerXai`).
  - ✅ Metadados de governança/versionamento no payload XAI e thresholds parametrizáveis por variáveis de ambiente.
  - ✅ Política operacional de governança documentada em `documents/P1-6_XAI_GOVERNANCE.md`.
  - ⏳ Pendente: calibração clínica formal dos thresholds com aprovação do corpo clínico em ambiente produtivo.

7. **TLS hardening**
  - **Status:** **Parcialmente concluído (gated por ambiente)**.
  - ✅ Perfil de desenvolvimento mantido compatível (`TLSv1.2 + TLSv1.3`) para evitar impacto no fluxo local.
  - ✅ Perfil de produção preparado com `TLSv1.3-only` em arquivo dedicado para ativação no cutover.
  - ✅ Checklist operacional de cutover e rollback documentado em `documents/TLS_PROD_CUTOVER_CHECKLIST.md`.
  - ✅ Script de validação assistida de cutover TLS disponível em `scripts/validate-tls-cutover.ps1`.
  - ⏳ Pendente: ativação no ambiente produtivo e validação de compatibilidade com clientes externos/integrações.

## Onda P2 (médio prazo)

8. **Matriz de conformidade automática (CI)**
   - Gate de pipeline para validar requisitos ISO 20387/HL7/LGPD com testes de contrato.

9. **Integridade criptográfica de biomarcadores**
   - Incluir biomarcadores no mesmo pipeline de prova (hash + Merkle + verificação por período/paciente).

---

## 5) Prontidão para INPI (originalidade técnica)

**Avaliação:** **Boa base técnica, com pendências críticas para sustentação forte de alegações.**

### Pontos que sustentam originalidade

- Acoplamento entre cadeia de custódia topológica (Neo4j), persistência clínica (Mongo/FHIR) e telemetria temporal (Influx).
- Estratégia de resiliência com quarentena/reprocessamento e compensação em falhas inter-sistemas.
- Ponteiros semânticos explícitos entre modelos FHIR e grafo de linhagem.

### Pontos que enfraquecem alegações (se não corrigidos)

- DataMatrix/Code128 ainda sem camada completa de geração/decodificação de imagem industrial.
- MQTT implementado no código, porém ainda dependente de homologação operacional e trilha assinada.
- Criptografia AES-256-GCM aplicada parcialmente no domínio; falta cobertura ampliada e governança de chaves.
- XAI clínico para biomarcadores ainda insuficiente para alegações robustas de IA explicável.

### Conclusão INPI

No estado atual, o código **suporta parcialmente** as alegações de originalidade técnica, com evolução concreta após a Onda P0. Com fechamento dos itens residuais de P0 e avanço de **P1**, a sustentação técnica para depósito/defesa tende a ficar significativamente mais sólida.

---

## 6) Evidência de validação da remediação

- Verificação estática dos principais arquivos alterados sem erros reportados.
- Execução de testes backend (`npm --prefix backend run test:ci`) com suítes principais concluídas com sucesso durante a janela de validação.
- Foram observados logs de WARN/ERROR esperados em cenários de teste de resiliência/fail-open-fail-closed, sem interromper a conclusão das suítes.
- Na Onda P1, o ledger `sample_movements` passou a registrar hash encadeado por evento e a rejeitar mutações diretas no runtime do backend para operações fora do padrão append-only.
- A execução operacional por prioridade passou a contar com artefatos de suporte: hardening ACL (P1-5), governança clínica XAI documentada (P1-6) e validação assistida de cutover TLS (P1-7).
- Evidência operacional P1-5 registrada via dry-run offline do script `backend/scripts/enforce-sample-movements-append-only-role.js`, com prévia da role `sampleMovementsAppendOnlyRole` e privilégios restritos (`find`, `insert`, `createIndex`, `listIndexes`).

---

## 7) Anexo: observações metodológicas

- Auditoria baseada em leitura de código e configuração; não substitui validação operacional em ambiente produtivo.
- Foram encontradas evidências de implementação de ingestão MQTT e de lógica de simbologia para leitura/normalização de barcode; a validação operacional completa em produção permanece pendente.
- A existência de comentários ou scripts de demonstração não foi considerada prova de conformidade sem implementação executável correspondente.
