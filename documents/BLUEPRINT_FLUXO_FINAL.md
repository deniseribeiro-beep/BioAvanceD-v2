# Blueprint do Fluxo Final - Importação Assíncrona

## Diagrama de Fluxo

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       │ 1. POST /api/import/validate
       │    { file, dataType }
       ▼
┌─────────────────────┐
│   API Controller    │
│  (Validation)       │
└──────┬──────────────┘
       │
       │ 2. Valida formato e estrutura
       │
       ▼
┌─────────────────────┐
│  Validation Result   │
│  { valid, errors,   │
│    metadata }       │
└──────┬──────────────┘
       │
       │ 3. Se válido: POST /api/import/import
       │
       ▼
┌─────────────────────┐
│   API Controller    │
│  (Create Job)       │
└──────┬──────────────┘
       │
       │ 4. Cria job no banco
       │ 5. Adiciona job na fila
       │
       ▼
┌─────────────────────┐
│   Queue (BullMQ)    │
│   + Redis           │
└──────┬──────────────┘
       │
       │ 6. Worker consome job
       │
       ▼
┌─────────────────────┐
│   Import Worker     │
└──────┬──────────────┘
       │
       │ 7. Roteia para worker específico
       │
       ├──► Patient Worker
       ├──► Sample Worker
       ├──► Result Worker
       └──► Temperature Worker
       │
       │ 8. Processa arquivo
       │ 9. Converte para FHIR
       │ 10. Insere/Atualiza no banco
       │
       ▼
┌─────────────────────┐
│   Database          │
│   - Collections     │
│   - FHIR Resources  │
│   - Metrics         │
│   - Jobs            │
└──────┬──────────────┘
       │
       │ 11. Salva métricas
       │ 12. Registra AuditLog
       │
       ▼
┌─────────────────────┐
│  Notification       │
│  Service            │
└──────┬──────────────┘
       │
       │ 13. Envia notificação
       │
       ├──► Email (SMTP)
       └──► WebSocket (Socket.IO)
       │
       ▼
┌─────────────┐
│   Frontend  │
│  (Recebe    │
│  notificação)│
└─────────────┘
```

## Fluxo Detalhado por Etapa

### Etapa 1: Validação

**Endpoint:** `POST /api/import/validate`

**Request:**
```http
POST /api/import/validate
Content-Type: multipart/form-data
Authorization: Bearer TOKEN

file: [arquivo]
dataType: patients|samples|results|temperature
```

**Processamento:**
1. Recebe arquivo via multer
2. Valida formato (extensão, mimeType)
3. Valida tamanho (máx 100MB)
4. Valida existência do arquivo
5. Retorna metadata

**Response:**
```json
{
  "success": true,
  "message": "Arquivo validado com sucesso",
  "metadata": {
    "fileName": "patients.csv",
    "fileSize": 1024,
    "mimeType": "text/csv",
    "extension": ".csv",
    "rowCount": 0,
    "headers": []
  }
}
```

### Etapa 2: Criação de Job

**Endpoint:** `POST /api/import/import`

**Request:**
```http
POST /api/import/import
Content-Type: multipart/form-data
Authorization: Bearer TOKEN

file: [arquivo]
dataType: patients|samples|results|temperature
startLocationID: 1 (opcional, para samples)
autoIncrement: true|false (opcional, para samples)
```

**Processamento:**
1. Valida arquivo
2. Cria job no banco (collection `importJobs`)
3. Adiciona job na fila BullMQ
4. Registra no AuditLog
5. Retorna jobID

**Response:**
```json
{
  "success": true,
  "message": "Job de importação criado com sucesso",
  "data": {
    "jobID": "uuid-here",
    "status": "pending"
  }
}
```

### Etapa 3: Processamento (Worker)

**Worker:** `import-worker.js`

**Processamento:**
1. Consome job da fila
2. Atualiza status para `processing`
3. Roteia para worker específico:
   - `patient-worker.js` → Processa pacientes
   - `sample-worker.js` → Processa amostras
   - `result-worker.js` → Processa resultados
   - `temperature-worker.js` → Processa temperatura
4. Worker específico:
   - Lê arquivo
   - Valida dados
   - Converte para FHIR
   - Insere/Atualiza no banco
   - Retorna resultados
5. Atualiza status do job
6. Salva métricas
7. Registra no AuditLog
8. Envia notificação

### Etapa 4: Consulta de Status

**Endpoint:** `GET /api/import/job/:jobID`

**Response:**
```json
{
  "success": true,
  "data": {
    "jobID": "uuid-here",
    "status": "completed",
    "progress": 100,
    "totalRecords": 100,
    "successCount": 95,
    "errorCount": 5,
    "errors": [...],
    "createdAt": "2024-12-19T10:00:00Z",
    "startedAt": "2024-12-19T10:00:05Z",
    "completedAt": "2024-12-19T10:02:30Z"
  }
}
```

### Etapa 5: Notificação

**Canais:**
1. **WebSocket** (Socket.IO)
   - Evento: `import-completed`
   - Evento: `import-failed`
   - Payload: `{ jobID, status, dataType, successCount, errorCount }`

2. **Email** (SMTP)
   - Assunto: "Importação [tipo] - [status]"
   - HTML: Template formatado
   - Inclui: Estatísticas, erros, link para relatório

## Fluxo IoT Streaming (Temperature)

```
┌─────────────┐
│ IoT Device  │
└──────┬──────┘
       │
       │ 1. Conecta via WebSocket
       │    /iot
       ▼
┌─────────────────────┐
│  IoT Streaming      │
│  Service            │
└──────┬──────────────┘
       │
       │ 2. Registra dispositivo
       │    emit('register-device')
       │
       │ 3. Envia dados
       │    emit('temperature-data')
       │
       ▼
┌─────────────────────┐
│   Queue (BullMQ)    │
│   Job: temperature-iot│
└──────┬──────────────┘
       │
       │ 4. Worker processa
       │
       ▼
┌─────────────────────┐
│   Database          │
│   - temperatures    │
│   - devices         │
│   - FHIR Resources  │
└─────────────────────┘
```

## Estados do Job

```
pending → processing → completed
              │
              └──► failed
              │
              └──► cancelled
```

## Métricas Consolidadas

**Collection:** `importMetrics`

**Estrutura:**
```javascript
{
  metricsID: String,
  jobID: String | null, // null para métricas consolidadas
  dataType: String,
  date: Date,
  totalJobs: Number,
  totalRecords: Number,
  successCount: Number,
  errorCount: Number,
  averageProcessingTime: Number,
  fhirResourcesCreated: Number,
  fhirResourcesUpdated: Number,
  breakdown: {
    byStatus: Object,
    byDataType: Object,
    byHour: Object
  }
}
```

## Recursos FHIR Gerados

### Patients
- **Collection:** `pacientes`
- **Campo FHIR:** `fhir` (FHIR.Patient)
- **Identifier:** `http://bioavanced.local/patient-id`

### Samples
- **Collection:** `amostras`
- **Campo FHIR:** `fhir` (FHIR.Specimen)
- **Identifier:** `http://bioavanced.local/sample-id`

### Results
- **Collection:** `results`
- **Campo FHIR:** `fhir` (FHIR.Observation)
- **Campo FHIR:** `fhirDiagnosticReport` (FHIR.DiagnosticReport)
- **Identifier:** `http://bioavanced.local/result-id`

### Temperature
- **Collection:** `temperatures`
- **Campo FHIR:** `fhir` (FHIR.Observation)
- **Campo FHIR:** `fhirDevice` (FHIR.Device)
- **Collection:** `devices`
- **Identifier:** `http://bioavanced.local/sensor-id`

## Tratamento de Erros

### Erros de Validação
- Retornados imediatamente na resposta
- Arquivo não é processado
- Arquivo temporário é removido

### Erros de Processamento
- Registrados no job
- Job status: `failed`
- Notificação enviada
- Métricas atualizadas

### Erros de FHIR
- Logados mas não interrompem processamento
- Dados são salvos mesmo sem FHIR
- Erro registrado no job

## Performance

### Concorrência
- **Worker:** Configurável via `WORKER_CONCURRENCY`
- **Padrão:** 2 jobs simultâneos
- **Recomendado:** 2-5 dependendo do hardware

### Retry
- **Tentativas:** 3
- **Backoff:** Exponencial (2s, 4s, 8s)
- **Jobs falhos:** Mantidos por 7 dias

### Limpeza
- **Jobs completos:** Mantidos por 24 horas
- **Últimos 1000 jobs:** Sempre mantidos
- **Arquivos temporários:** Removidos após processamento

## Segurança

- **Autenticação:** Requerida em todos os endpoints
- **Autorização:** Permissão `uploadFiles` necessária
- **Validação:** Formato e tamanho de arquivo
- **Sanitização:** Dados sensíveis não expostos em logs
- **LGPD:** Conformidade mantida (anonimização)

## Monitoramento

### Logs
- **Worker:** Logs de processamento
- **API:** Logs de requisições
- **AuditLog:** Rastreabilidade completa

### Métricas
- **Tempo de processamento**
- **Taxa de sucesso/erro**
- **Recursos FHIR criados/atualizados**
- **Histórico consolidado**

---

**Versão:** 1.0  
**Data:** 2024-12-19  
**Status:** ✅ Implementado e Funcional

