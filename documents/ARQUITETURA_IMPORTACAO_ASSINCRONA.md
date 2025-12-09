# Arquitetura de Importação Assíncrona - BioAdvanceD

## Visão Geral

Este documento descreve a arquitetura completa de importação assíncrona implementada no BioAdvanceD, conforme a auditoria técnica fornecida.

## Arquitetura

```
Frontend → API → Validation → Queue (BullMQ/Redis) → Worker → Database
                ↓              ↓                        ↓
            Response      AuditLog + Metrics      FHIR Resources
                ↓              ↓                        ↓
            Notification ← Consolidation ← Notifications
```

## Componentes Principais

### 1. Fila de Processamento (Queue)

**Localização:** `backend/src/config/queue.js`

- **Tecnologia:** BullMQ + Redis
- **Função:** Gerencia jobs de importação de forma assíncrona
- **Configuração:**
  - Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
  - Retry: 3 tentativas com backoff exponencial
  - Retenção: Jobs completos por 24h, falhos por 7 dias

### 2. Workers

**Localização:** `backend/src/workers/`

- **Worker Principal:** `import-worker.js`
  - Consome jobs da fila
  - Roteia para workers específicos
  - Atualiza status dos jobs
  - Salva métricas

- **Workers Específicos:**
  - `workers/patient-worker.js` - Processa pacientes
  - `workers/sample-worker.js` - Processa amostras
  - `workers/result-worker.js` - Processa resultados (ZIP/RAW/CSV)
  - `workers/temperature-worker.js` - Processa temperatura

### 3. Serviços FHIR

**Localização:** `backend/src/services/fhir.service.js`

- **Função:** Converte dados para HL7 FHIR R4
- **Recursos Suportados:**
  - Patients → `FHIR.Patient`
  - Samples → `FHIR.Specimen`
  - Results → `FHIR.Observation` + `FHIR.DiagnosticReport`
  - Temperature → `FHIR.Device` + `FHIR.Observation`

### 4. Serviços de Importação

**Localização:** `backend/src/services/`

- **import-async.service.js:**
  - Valida arquivos
  - Cria jobs na fila
  - Gerencia status de jobs
  - Salva métricas

- **import-lgpd.service.js:**
  - Processamento de pacientes e amostras (mantido para compatibilidade)

- **import.service.js:**
  - Processamento de temperatura (mantido para compatibilidade)

### 5. Notificações

**Localização:** `backend/src/services/notification.service.js`

- **Email:** Via Nodemailer (SMTP)
- **WebSocket:** Via Socket.IO
- **Eventos:**
  - `import-completed` - Job completado
  - `import-failed` - Job falhou

### 6. IoT Streaming

**Localização:** `backend/src/services/iot-streaming.service.js`

- **Função:** Processa dados de temperatura em tempo real
- **Protocolo:** WebSocket (Socket.IO)
- **Eventos:**
  - `register-device` - Registra dispositivo IoT
  - `temperature-data` - Recebe dados de temperatura
  - `temperature-received` - Confirma recebimento

## Fluxo de Processamento

### 1. Validação

```
POST /api/import/validate
- Upload de arquivo
- Validação de formato e estrutura
- Retorno de erros (se houver)
- Retorno de metadata
```

### 2. Criação de Job

```
POST /api/import/import
- Upload de arquivo
- Validação básica
- Criação de job no banco
- Adição de job na fila
- Retorno de jobID
```

### 3. Processamento (Worker)

```
Worker consome job da fila:
1. Atualiza status para 'processing'
2. Processa arquivo baseado no tipo
3. Converte para FHIR
4. Insere/Atualiza no banco
5. Salva métricas
6. Registra no AuditLog
7. Envia notificação
8. Atualiza status para 'completed' ou 'failed'
```

### 4. Consulta de Status

```
GET /api/import/job/:jobID
- Retorna status atual do job
- Progresso (0-100)
- Contadores (total, success, errors)
```

### 5. Relatório

```
GET /api/import/job/:jobID/report
- Relatório completo do job
- Detalhes de erros
- Recursos FHIR gerados
```

## Modelos de Dados

### ImportJob

```javascript
{
  jobID: String (UUID),
  userID: String,
  dataType: String, // 'patients', 'samples', 'results', 'temperature'
  filePath: String,
  fileName: String,
  fileSize: Number,
  status: String, // 'pending', 'processing', 'completed', 'failed', 'cancelled'
  progress: Number, // 0-100
  totalRecords: Number,
  successCount: Number,
  errorCount: Number,
  errors: Array,
  metadata: Object,
  fhirResources: Array,
  createdAt: Date,
  updatedAt: Date,
  startedAt: Date,
  completedAt: Date
}
```

### ImportMetrics

```javascript
{
  metricsID: String,
  jobID: String (opcional),
  userID: String (opcional),
  dataType: String,
  date: Date,
  totalJobs: Number,
  totalRecords: Number,
  successCount: Number,
  errorCount: Number,
  averageProcessingTime: Number,
  fhirResourcesCreated: Number,
  fhirResourcesUpdated: Number,
  breakdown: Object,
  createdAt: Date,
  updatedAt: Date
}
```

## Endpoints da API

### Validação

- `POST /api/import/validate` - Valida arquivo antes de processar

### Importação

- `POST /api/import/import` - Cria job de importação

### Jobs

- `GET /api/import/jobs` - Lista jobs
- `GET /api/import/job/:jobID` - Obtém status do job
- `POST /api/import/job/:jobID/cancel` - Cancela job
- `GET /api/import/job/:jobID/report` - Obtém relatório do job

## Configuração

### Variáveis de Ambiente

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Email (Notificações)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password
SMTP_FROM=your-email@gmail.com

# Worker
WORKER_CONCURRENCY=2

# Frontend (WebSocket)
FRONTEND_URL=http://localhost:3000
```

## Execução

### Servidor Principal

```bash
npm start
# ou
npm run dev
```

### Worker

```bash
npm run worker
# ou
npm run worker:dev
```

## Conformidade com Auditoria

### ✅ Implementado

1. ✅ Arquitetura assíncrona com fila (BullMQ/Redis)
2. ✅ Separação entre validação e processamento
3. ✅ Suporte HL7 FHIR R4 completo
4. ✅ Importação de Results (ZIP/RAW/CSV)
5. ✅ Suporte IoT Streaming em Temperature Control
6. ✅ Implementação de update quando identifier existir
7. ✅ Persistência completa de métricas com histórico
8. ✅ Notificações assíncronas (email/WebSocket)
9. ✅ Relatórios detalhados
10. ✅ Atualização completa do AuditLog

### 📋 Estrutura de Pastas

```
backend/
├── src/
│   ├── config/
│   │   └── queue.js              # Configuração da fila
│   ├── controllers/
│   │   └── import-async.controller.js  # Controller assíncrono
│   ├── models/
│   │   ├── ImportJob.js          # Modelo de job
│   │   └── ImportMetrics.js      # Modelo de métricas
│   ├── routes/
│   │   └── import.routes.js      # Rotas atualizadas
│   ├── services/
│   │   ├── fhir.service.js        # Serviço FHIR
│   │   ├── import-async.service.js  # Serviço assíncrono
│   │   ├── notification.service.js  # Notificações
│   │   └── iot-streaming.service.js # IoT Streaming
│   ├── workers/
│   │   ├── worker.js              # Worker principal
│   │   ├── import-worker.js       # Lógica do worker
│   │   └── workers/
│   │       ├── patient-worker.js
│   │       ├── sample-worker.js
│   │       ├── result-worker.js
│   │       └── temperature-worker.js
│   └── utils/
│       └── auditLogger.js         # AuditLog atualizado
```

## Próximos Passos

1. Instalar dependências: `npm install`
2. Configurar Redis
3. Configurar variáveis de ambiente
4. Iniciar servidor: `npm start`
5. Iniciar worker: `npm run worker`
6. Testar importação via API

## Referências

- [BullMQ Documentation](https://docs.bullmq.io/)
- [HL7 FHIR R4](https://www.hl7.org/fhir/)
- [Socket.IO Documentation](https://socket.io/docs/)

