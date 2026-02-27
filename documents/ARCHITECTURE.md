# ARQUITETURA DO SISTEMA DE SEGURANÇA, CONFORMIDADE E RESILIÊNCIA

Implementação consolidada do BioAvanceD (backend + frontend + stack local).

# ARQUITETURA LÓGICA

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CAMADA DE REQUISIÇÕES                        │
│  POST /api/samples | POST /api/results | PUT /api/patients          │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│           MIDDLEWARE DE INTEGRAÇÃO DE SEGURANÇA                      │
│      src/middleware/integrationSecurityMiddleware.js                │
├─────────────────────────────────────────────────────────────────────┤
│ • Aplica automaticamente em rotas críticas                           │
│ • Intercepta 403 para gerar alertas                                 │
│ • Detecta padrões suspeitos (3+ tentativas)                         │
└────────┬───────────────────────────────────────────────────┬────────┘
         │                                                   │
         ▼                                                   ▼
  ┌─────────────────────────┐          ┌──────────────────────────────┐
   │ BLOQUEIO ÉTICO           │          │ ALERTAS DE SEGURANÇA          │
  │ authConsent.js           │          │ securityAlerts.service.js    │
  ├─────────────────────────┤          ├──────────────────────────────┤
  │ • Valida consentimento   │          │ • Registra eventos críticos  │
  │ • Verifica REVOKED       │          │ • Detecta atividades susp.   │
   │ • Valida escopos         │          │ • Observadores customizáveis │
   │ • 403 se bloqueado       │          │ • Integração com e-mail/Slack│
  │                          │          │                              │
   │ cobertura por testes      │          │ integração com authConsent    │
  └──────────────────────────┘          └──────────────────────────────┘
         │                                           │
         └─────────────┬──────────────────┬─────────┘
                       │                  │
                       ▼                  ▼
         ┌──────────────────────────────────────┐
         │   BANCO DE DADOS (MongoDB)           │
         ├──────────────────────────────────────┤
         │ • patient_consents (consentimentos)   │
         │ • security_alerts (alertas)          │
         │ • logs (auditoria)                   │
         └──────────────────────────────────────┘
                       ▲
                       │
         ┌─────────────┴──────────────┐
         │                            │
   ┌─────▼──────────────┐    ┌─────────▼───────────────┐
   │  RELATÓRIOS        │    │ CONFIGURAÇÃO DE ESCOPOS │
   │  complianceReport  │    │ consentScopes.js        │
   ├────────────────────┤    ├────────────────────────┤
   │ • Painel de controle│   │ • 11 escopos definidos │
   │ • Relatórios JSON  │    │ • Categorias           │
   │ • Relatórios CSV   │    │ • Níveis de risco      │
   │ • Índice 0-100     │    │ • Retenção de dados    │
   │ • Recomendações    │    │                        │
   │                    │    │ Pontos de extremidade públicos: │
   │ Implementado       │    │    /api/compliance/    │
   └────────────────────┘    │    scopes              │
                             └────────────────────────┘
                                      👇
                             ┌──────────────────────┐
                             │  ROTAS DE API        │
                             │  compliance.routes.js│
                             ├──────────────────────┤
                             │ GET  /dashboard      │
                             │ GET  /report         │
                             │ GET  /alerts         │
                             │ POST /alerts/ack     │
                             │ POST /alerts/resolve │
                             │ GET  /scopes         │
                             └──────────────────────┘
```

---

# ESTRUTURA DE PACOTES

---

# ESTRATÉGIA DE LEITURA FHIR-FIRST

- Configuração: `FHIR_READ_MODE`
   - `fhir-first` (padrão): tenta ler primeiro em `patients_fhir`, `samples_fhir`, `consents_fhir`.
   - `legacy-first`: mantém leitura primária nas coleções canônicas legadas (`patients`, `samples`, `patientConsents`).
- Retorno alternativo automático:
   - Se a coleção FHIR não estiver disponível, não tiver dados, ou ocorrer incompatibilidade de driver/mock, o serviço retorna para leitura legacy sem interrupção da API.
- Escopo atual:
   - `patient.service.js`: `getPatient`, `listPatients`, `searchPatients`.
   - `sample.service.js`: `getSample`, `listSamples`.
   - `consent.service.js`: `getPatientConsent`.

---

# RESILIÊNCIA TOPOLÓGICA E RASTREABILIDADE (2026-02-26)

## 1) Registro dinâmico de amostras (estrito/permissivo por risco)

- Caso de uso: `backend/src/core/use-cases/RegisterSample.js`
- Regras principais:
   - linha de base por `LINEAGE_MODE` (`fail-open` / `fail-closed`)
   - força modo estrito para alto risco (`isRareDisease`, `riskLevel`, `riskScore`)
   - em estrito: falha de consentimento/topologia gera rollback Mongo + `403`
   - em permissivo: falha de Neo4j não bloqueia, evento vai para quarentena Redis

## 2) Quarentena topológica com auto-recuperação (Redis)

- Implementação: `backend/src/infrastructure/queue/TopologicalQuarantine.js`
- Funções:
   - enfileirar eventos de linhagem em falhas transitórias do Neo4j
   - processo periódico de reprocessamento com controle de lote e número máximo de tentativas
   - tolerância a erro sem derrubar o processo

## 3) Invalidação em cascata por telemetria (InfluxDB → Neo4j)

- Implementação: `backend/src/infrastructure/services/TelemetryMonitor.js`
- Comportamento:
   - monitora temperatura crítica por janela temporal configurável
   - identifica amostras raiz impactadas
   - propaga status `COMPROMETIDA` no grafo de linhagem (`DERIVED_FROM`)
   - aplica cooldown por freezer para evitar alertas redundantes

## 4) Integração de runtime no servidor

- `backend/server.js`:
   - inicializa `TopologicalQuarantine` e `TelemetryMonitor`
   - expõe instâncias via `app.locals`
   - realiza encerramento gracioso de processos/cron em `SIGINT`/`SIGTERM`

## 5) Perfis operacionais de ambiente

- `backend/.env.resilience.example` (linha de base permissiva)
- `backend/.env.resilience.strict.example` (linha de base regulada, fail-closed)
- Variáveis-chave:
   - `NEO4J_RETRY_QUEUE_KEY`
   - `NEO4J_RETRY_INTERVAL_MS`
   - `NEO4J_RETRY_BATCH_SIZE`
   - `NEO4J_RETRY_MAX_ATTEMPTS`
   - `TELEMETRY_MONITOR_CRON`
   - `TELEMETRY_CRITICAL_TEMP`
   - `TELEMETRY_CRITICAL_DURATION_HOURS`
   - `TELEMETRY_LOOKBACK_HOURS`
   - `TELEMETRY_TRIGGER_COOLDOWN_MINUTES`

```

backend/
├── src/
│   ├── config/
│   │   └── consentScopes.js (11 escopos)
│   │   └── collections.js (resolução canônica de coleções)
│   │
│   ├── utils/
│   │   └── security.js (sanitização + validação CPF)
│   │   └── collectionResolver.js (retorno alternativo por aliases/canonical)
│   │
│   ├── middleware/
│   │   ├── auth.js (existente)
│   │   ├── authConsent.js (bloqueio ético)
│   │   └── integrationSecurityMiddleware.js (integração)
│   │
│   ├── core/
│   │   └── use-cases/
│   │       └── RegisterSample.js (risco dinâmico + rollback)
│   │
│   ├── infrastructure/
│   │   ├── queue/
│   │   │   └── TopologicalQuarantine.js (autorrecuperação com Redis)
│   │   └── services/
│   │       └── TelemetryMonitor.js (cascata Influx→Neo4j)
│   │
│   ├── services/
│   │   ├── sample.service.js (sem mudanças)
│   │   ├── securityAlerts.service.js (alertas)
│   │   ├── complianceReport.service.js (relatórios)
│   │   ├── consentNeo4jSync.service.js (sincronização Mongo→Neo4j)
│   │   └── fhir-sync.service.js (leitura/migração FHIR)
│   │
│   └── interface/
│       └── routes/
│           ├── sample.routes.js (atualizada: integração com RegisterSample)
│           ├── compliance.routes.js (pontos de extremidade)
│           ├── assistant.routes.js
│           └── backup.routes.js
│
├── test/
│   └── unit/
│       ├── security.test.js (18 testes)
│       └── authConsent.test.js (9 testes)
│
└── docs/
   ├── INTEGRATION_GUIDE.md
   ├── IMPLEMENTATION_CHECKLIST.md
   ├── SECURITY_IMPLEMENTATION_SUMMARY.md
   └── USAGE_EXAMPLES.md
```

---

# FLUXO DE EXECUÇÃO

```
Caso: tentativa de criação de amostra sem consentimento ativo

1. `POST /api/samples`
   ▼
2. `integrationSecurityMiddleware` intercepta
   ▼
3. Chama `authConsent({ patientID })`
   ▼
4. Busca `patient_consents` no banco
   ▼
5. Não encontra consentimento ativo
   ▼
6. Bloqueia a operação e retorna `403`
   {
     "error": "BLOQUEIO_ETICO: Consentimento ausente",
     "code": "CONSENT_REQUIRED"
   }
   ▼
7. `consentBlockAlertWrapper` captura `403`
   ▼
8. Chama `securityAlerts.alertConsentBlocked()`
   ▼
9. Insere alerta em `security_alerts`
   {
     "type": "CONSENT_BLOCKED",
     "severity": "high",
     "patientID": "xxx",
     "timestamp": "2026-02-12T18:50:00Z",
     "status": "open"
   }
   ▼
10. Administrador acessa `/api/compliance/alerts`
   ▼
11. A partir da API de alertas pode:
   • Reconhecer (acknowledge)
   • Resolver (resolve)
   • Investigar detalhes

Caso: múltiplas tentativas em janela de 5 minutos

1. Na 4ª tentativa detecta padrão suspeito
   ▼
2. Chama `detectSuspiciousActivity()`
   ▼
3. Gera alerta com `type: SUSPICIOUS_ACTIVITY`
   ▼
4. Define severidade `CRITICAL`
   ▼
5. Notifica observadores configurados (e-mail, Slack etc.)
```

---

# DIAGRAMA DE DADOS

```
BANCO: BioAvanceD

┌─ patient_consents
│  {
│    _id: ObjectId,
│    patientId: "12345",
│    templateId: "template-1",
│    status: "ACTIVE" | "REVOKED",
│    responses: {
│      "uso_pesquisa": true,
│      "uso_comercial": false,
│      "compartilhamento": true
│    },
│    signedAt: Date,
│    revokedAt: null | Date
│  }
│
├─ security_alerts
│  {
│    _id: ObjectId,
│    type: "CONSENT_BLOCKED" | "SUSPICIOUS_ACTIVITY" | ...,
│    severity: "low" | "medium" | "high" | "critical",
│    patientID: "12345",
│    userID: user id,
│    reason: "multiple attempts",
│    status: "open" | "acknowledged" | "resolved",
│    timestamp: Date,
│    details: { ... },
│    resolution: "falso positivo"
│  }
│
├─ logs (usado por complianceReport)
│  {
│    action: "sample_create" | "CONSENT_BLOCKED" | ...,
│    entity: "Sample" | "PatientConsent" | ...,
│    result: "success" | "blocked",
│    severity: "info" | "warning" | "error",
│    timestamp: Date
│  }

QUERIES:
- Encontrar alertas críticos abertos:
  db.security_alerts.find({ severity: "critical", status: "open" })
  
- Detectar padrão suspeito:
  db.security_alerts.find({
    patientID: "xxx",
    timestamp: { $gte: Date - 5min },
    type: "CONSENT_BLOCKED"
  }).count() >= 3

- Gerar painel de controle:
  db.security_alerts
    .aggregate([
      { $match: { timestamp: { $gte: Date - 30days } } },
      { $group: { _id: "$severity", count: { $sum: 1 } } }
    ])
```

---

# MATRIZ DE DECISÃO

```
┌─────────────────────┬──────────────┬────────────────┬──────────────┐
│ Cenário             │ Ação         │ Resposta HTTP  │ Alerta       │
├─────────────────────┼──────────────┼────────────────┼──────────────┤
│ Com consentimento   │ PERMITIDO    │ 201/200        │ Não          │
│ Sem consentimento   │ BLOQUEADO    │ 403            │ Sim (HIGH)   │
│ Consentimento       │ BLOQUEADO    │ 403            │ Sim (HIGH)   │
│ revogado            │              │                │              │
│ Escopo              │ BLOQUEADO    │ 403            │ Sim          │
│ insuficiente        │              │                │              │
│ 1ª tentativa        │ BLOQUEADO    │ 403            │ Sim          │
│ 2ª tentativa        │ BLOQUEADO    │ 403            │ Sim          │
│ 3ª tentativa        │ BLOQUEADO    │ 403            │ Sim          │
│ ≥ 4ª tentativa      │ BLOQUEADO    │ 403            │ Sim (CRITICAL│
│ (SUSPEITO)          │              │                │ + padrão)    │
└─────────────────────┴──────────────┴────────────────┴──────────────┘
```

---

# GARANTIAS DE SEGURANÇA

```
Input Sanitization:
   - XSS Prevention          → `sanitizeInput()` remove `<script>`
   - MongoDB Injection       → `escapeString()` escapa `$` e `.`
   - PII Redaction           → `sanitizeSensitiveData()` oculta dados
   - Size Limit (DoS)        → máximo 1000 caracteres por campo

Consent Validation:
   - Consentimento requerido → `403` sem consentimento ativo
   - Revogação respeitada    → `403` imediatamente se revogado
   - Escopo validado         → `403` se escopo insuficiente
   - CPF validado            → algoritmo de dígito verificador

Suspicious Activity:
   - Padrão detectado        → `3+` tentativas em `5` min
   - Alerta crítico gerado   → severidade `CRITICAL`
   - Auditoria               → eventos persistidos em `logs`

Compliance Monitoring:
   - Índice calculado        → `0-100` baseado em métricas
   - Recomendações           → baseadas em padrões observados
   - Exportação              → `JSON/CSV` para auditoria
```

---

# EVOLUÇÃO DOS TESTES

```
Antes (etapas iniciais):
- Testes manuais isolados
- Sem cobertura de middleware
- Sem teste de alertas

Depois (etapa atual):
- 18 testes de segurança (100% pass)
- 9 testes de consentimento (100% pass)
- Cobertura de XSS, CPF e e-mail
- Cobertura de cenários HTTP 403/400/503
- Teste de detecção de atividade suspeita
```

---

# PLANO DE EVOLUÇÃO

**Curto Prazo (Semana 1):**
- Implementar sistema (concluído)
- Integrar no `server.js` (concluído)
- Validar `backend test:ci` (concluído)
- Documentar perfis de ambiente resilientes (concluído)

**Médio Prazo (Mês 1):**
- ⏳ Notificações por e-mail/Slack
- ⏳ Painel frontend
- ⏳ Bulk export de alertas
- ⏳ Webhooks customizáveis

**Longo Prazo (3 meses):**
- ⏳ Machine learning para anomalias
- ⏳ Integração com SIEM
- ⏳ Análise de previsão
- ⏳ API de relatórios público

---

# ATUALIZAÇÃO FRONTEND (2026-02-26)

## 1) Arquitetura de componentes (Container/Presentational + Hooks)

Refatorações implementadas no frontend para reduzir acoplamento entre UI, estado assíncrono e integração com API:

- `SampleCustodyReportsPage` → container fino + `useSampleCustodyReports` + `SampleCustodyReportsView`
- `SampleMovementsPage` → container fino + `useSampleMovements` + `SampleMovementsView`
- Lógica compartilhada extraída para:
   - `hooks/samples/sampleMovements.shared.ts` (normalização e parsing de erro/compliance)
   - `components/samples/movementTypeLabel.ts` (rótulos de tipo de movimentação)

Benefícios:
- Menor duplicação de lógica de domínio
- Maior testabilidade por separação de responsabilidades
- Melhor manutenção de telas críticas de cadeia de custódia

## 2) Robustez de tipagem e contratos de API

Fortalecimento de hooks com substituição de `any` por `unknown` + funções de extração/normalização:

- `useSampleCustodyReports.ts`
- `useSampleMovements.ts`
- `useLogs.ts`
- `useTemperature.ts`
- `useSamples.ts`
- `usePatients.ts`
- `useSecurity.ts`
- `useUserSecurity.ts`

Padrão aplicado:
- `extractErrorMessage(...)` para mensagens padronizadas e seguras
- `extractResponseData(...)` para envelopes de resposta heterogêneos
- Type guards para evitar acesso inseguro a payloads dinâmicos

## 3) Performance de bundle e carregamento por rota

Otimizações aplicadas:

- `React.lazy` + `Suspense` em rotas no `App.tsx` (segmentação de código por página)
- `manualChunks` no `vite.config.ts` para separar dependências estratégicas:
   - `vendor-react`
   - `vendor-router`
   - `vendor-realtime`
   - `vendor-qr`
   - `vendor-utils`

Resultado observado na compilação de produção:

- Segmento principal (`index-*.js`) reduzido de ~565 kB para ~159 kB
- Remoção dos avisos de segmento > 500 kB
- Remoção de avisos de dependência circular após ajuste de segmentação

## 4) Status da arquitetura frontend

- Compilação de produção validada após as alterações
- Padrão arquitetural consistente nas áreas críticas de amostras/custódia
- Base preparada para evolução de visualização de lineage/telemetria e observabilidade

---

# ASSINATURA DIGITAL TCLE (2026-02-26)

## Escopo implementado (sem alterar fluxo de PDF)

- Captura de assinatura manuscrita em tela com `react-signature-canvas`:
   - `frontend/src/components/AssinaturaDigitalTCLE.jsx`
   - `frontend/src/components/AssinaturaDigitalTCLE.css`
- Integração no fluxo de consentimento existente:
   - `frontend/src/components/ConsentForm.tsx`
   - `frontend/src/views/ConsentPage.tsx`
   - `frontend/src/services/api.ts`

## Comportamento funcional

- Quadro de assinatura otimizado para tablet/desktop/mobile.
- Ações disponíveis:
   - `Limpar Assinatura`
   - `Confirmar e Assinar`
- Finalização do consentimento condicionada a:
   - permissões obrigatórias aceitas,
   - nome do signatário,
   - assinatura digital confirmada.

## Persistência e rastreabilidade no backend

Persistência adicionada no domínio de consentimento:

- `backend/src/services/consent.service.js`
   - normalização de `signatureImageBase64`, `signatureMimeType` e `signatureName`,
   - validação de formato de imagem,
   - geração de hash SHA-256 (`signatureHash`) para trilha auditável,
   - proteção de tamanho para payload de assinatura.
- `backend/src/models/PatientConsent.js`
   - validação e armazenamento de metadados da assinatura digital.

Campos persistidos no consentimento:

- `signatureName`
- `signatureImageBase64`
- `signatureMimeType`
- `signatureHash`

## Compatibilidade

- Implementação retrocompatível:
   - payloads legados sem assinatura digital continuam válidos,
   - fluxo de upload do termo em PDF permanece inalterado.

## Verificação

- Frontend build: concluído com sucesso.
- Backend `test:ci`: concluído com sucesso.

---

# STACK LOCAL COM DOCKER DESKTOP (2026-02-26)

## Serviços orquestrados no `docker-compose.yml`

- `frontend` (Nginx + compilação Vite)
- `backend` (API Node/Express)
- `worker` (fila/processamento assíncrono)
- `mongo` (MongoDB 7)
- `redis` (Redis 7 com senha)
- `neo4j` (Neo4j 5 Community)
- `influxdb` (InfluxDB 2.7)

## Configuração e subida

1. Copiar o template de ambiente:
   - `Copy-Item .env.docker.example .env.docker`
2. Ajustar segredos e senhas em `.env.docker`.
3. Execução em um comando (PowerShell):
   - `./scripts/start-local-stack.ps1 -DropTarget`
4. Subir todos os serviços manualmente:
   - `docker compose --env-file .env.docker up -d --build`
5. Ver logs:
   - `docker compose --env-file .env.docker logs -f`
6. Derrubar ambiente:
   - `docker compose --env-file .env.docker down`
7. Derrubar ambiente com script PowerShell:
   - `./scripts/stop-local-stack.ps1`
   - Com limpeza de volumes: `./scripts/stop-local-stack.ps1 -RemoveVolumes`
   - Com limpeza de volumes + imagens locais: `./scripts/stop-local-stack.ps1 -RemoveVolumes -RemoveImages -RemoveOrphans`

## Migração MongoDB online → Mongo local

Script adicionado: `backend/scripts/migrate-mongo-online-to-local.js`

Comando NPM:
- `npm --prefix backend run migrate:mongo:online-local -- --drop-target`

Variáveis relevantes (em `.env.docker` ou shell):
- `MONGO_SOURCE_URI`
- `MONGO_SOURCE_DB`
- `MONGO_TARGET_URI` (default local)
- `MONGO_TARGET_DB` (default `MONGO_DB`)
- `MONGO_MIGRATE_BATCH_SIZE` (default 1000)

Opções do script:
- `--drop-target` apaga coleção local antes de inserir
- `--collections=patients,samples` migra só coleções específicas
- `--batch-size=2000` ajusta tamanho do lote

Script PowerShell equivalente:
- `./scripts/start-local-stack.ps1 -DropTarget -Collections "patients,samples" -BatchSize 2000`

---

# RESUMO DE STATUS

| Métrica | Valor |
|---------|-------|
| Segurança e consentimento | Implementado |
| FHIR-first com retorno alternativo | Implementado |
| Quarentena topológica Redis | Implementado |
| Registro dinâmico estrito/permissivo | Implementado |
| Invalidação em cascata por telemetria | Implementado |
| Assinatura digital TCLE com hash | Implementado |
| Stack local com Docker Desktop | Implementado |
| Backend `test:ci` | Passando |

**Status atual: arquitetura consolidada e pronta para homologação/produção conforme política de implantação.**
