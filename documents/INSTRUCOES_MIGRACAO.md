# Instruções de Migração - Fluxo de Importação Assíncrona

## Pré-requisitos

### 1. Instalar Dependências

```bash
cd backend
npm install
```

Dependências adicionadas:
- `bullmq` - Fila de processamento
- `ioredis` - Cliente Redis
- `nodemailer` - Notificações por email
- `socket.io` - WebSocket para notificações e IoT
- `yauzl` - Processamento de arquivos ZIP

### 2. Instalar e Configurar Redis

#### Windows

```bash
# Opção 1: Usar WSL2
wsl
sudo apt-get update
sudo apt-get install redis-server
redis-server

# Opção 2: Usar Docker
docker run -d -p 6379:6379 redis:latest

# Opção 3: Baixar Redis para Windows
# https://github.com/microsoftarchive/redis/releases
```

#### Linux/Mac

```bash
# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis-server

# Mac (Homebrew)
brew install redis
brew services start redis
```

### 3. Configurar Variáveis de Ambiente

Adicione ao arquivo `.env`:

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Email (Opcional - para notificações)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

# Worker
WORKER_CONCURRENCY=2

# Frontend (para WebSocket CORS)
FRONTEND_URL=http://localhost:3000
```

## Migração do Fluxo Síncrono para Assíncrono

### Passo 1: Instalar Dependências do Frontend

```bash
cd src  # ou raiz do projeto frontend
npm install socket.io-client
```

### Passo 2: Atualizar Frontend

O frontend precisa ser atualizado para usar os novos endpoints. **Hooks prontos foram criados** para facilitar o uso:

#### Opção 1: Usar Hook `useAsyncImport` (Recomendado)

```typescript
import { useAsyncImport } from '../hooks/useAsyncImport';

function ImportComponent() {
  const [file, setFile] = useState<File | null>(null);
  
  const {
    validating,
    creating,
    job,
    isPolling,
    importFile,
  } = useAsyncImport();

  const handleImport = async () => {
    if (!file) return;

    await importFile(file, 'patients', {
      onCompleted: (job) => {
        console.log('Importação concluída!', job);
      },
      onFailed: (job) => {
        console.error('Importação falhou:', job);
      },
    });
  };

  return (
    <div>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={handleImport} disabled={!file || validating || creating}>
        {validating && 'Validando...'}
        {creating && 'Criando job...'}
        {job && isPolling && `Processando... ${job.progress}%`}
        {!validating && !creating && !job && 'Importar'}
      </button>
      
      {job && (
        <div>
          <p>Status: {job.status}</p>
          <p>Progresso: {job.progress}%</p>
          <p>Sucesso: {job.successCount} / {job.totalRecords}</p>
        </div>
      )}
    </div>
  );
}
```

#### Opção 2: Uso Manual (Passo a Passo)

```typescript
import { importService } from '../services/api';
import { useImportJob } from '../hooks/useImportJob';

// 1. Validar arquivo
const validation = await importService.validateFile(file, dataType);
if (!validation.data.success) {
  // Mostrar erros
  return;
}

// 2. Criar job
const jobResponse = await importService.createImportJob(file, dataType);
const { jobID } = jobResponse.data.data;

// 3. Monitorar status (hook faz polling automático)
const { job, isPolling } = useImportJob(jobID, {
  onCompleted: (job) => {
    // Mostrar resultados
  },
  onFailed: (job) => {
    // Mostrar erros
  },
});
```

#### Antes (Síncrono - Mantido para Compatibilidade)

```typescript
const response = await importService.uploadFile(file, dataType);
// Resposta imediata com resultados
```

**Nota:** O endpoint síncrono `/api/import/upload` ainda está disponível para compatibilidade, mas recomenda-se usar o fluxo assíncrono.

### Passo 2: Iniciar Worker

O worker deve ser executado em um processo separado:

```bash
# Terminal 1: Servidor
npm start

# Terminal 2: Worker
npm run worker
```

Ou em produção, use PM2:

```bash
pm2 start npm --name "bioavanced-api" -- start
pm2 start npm --name "bioavanced-worker" -- run worker
```

### Passo 3: Migrar Dados Existentes (Opcional)

Se você tem dados existentes que precisam ser convertidos para FHIR:

```javascript
// Script de migração
const fhirService = require('./src/services/fhir.service');
const db = require('./src/database/mongo').connectDB();

async function migrateToFHIR() {
  const db = await connectDB();
  
  // Migrar pacientes
  const patients = await db.collection('pacientes').find({ fhir: { $exists: false } }).toArray();
  for (const patient of patients) {
    const fhirPatient = fhirService.patientToFHIR(patient);
    await db.collection('pacientes').updateOne(
      { _id: patient._id },
      { $set: { fhir: fhirPatient } }
    );
  }
  
  // Repetir para samples, results, temperatures...
}
```

## Hooks Disponíveis

### `useAsyncImport`

Hook completo que gerencia todo o fluxo de importação assíncrona:

- Validação de arquivo
- Criação de job
- Monitoramento automático
- Notificações WebSocket
- Callbacks para eventos

**Localização:** `src/hooks/useAsyncImport.ts`

### `useImportJob`

Hook para monitorar um job específico:

- Polling automático
- Notificações WebSocket
- Cancelamento de job
- Obtenção de relatório

**Localização:** `src/hooks/useImportJob.ts`

**Documentação completa:** Veja `EXEMPLO_USO_IMPORTACAO_ASSINCRONA.md`

## Testando a Implementação

### 1. Testar Validação

```bash
curl -X POST http://localhost:3000/api/import/validate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@patients.csv" \
  -F "dataType=patients"
```

### 2. Testar Importação

```bash
curl -X POST http://localhost:3000/api/import/import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@patients.csv" \
  -F "dataType=patients"
```

Resposta:
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

### 3. Verificar Status

```bash
curl -X GET http://localhost:3000/api/import/job/JOB_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Testar IoT Streaming

```javascript
// Cliente WebSocket
const io = require('socket.io-client');
const socket = io('http://localhost:3000/iot');

socket.on('connect', () => {
  // Registrar dispositivo
  socket.emit('register-device', {
    deviceId: 'sensor-001',
    sensorId: 'TEMP-001',
    locationId: 1,
    facility: 'Lab A',
    zone: 'Freezer 1'
  });
  
  // Enviar dados de temperatura
  socket.emit('temperature-data', {
    deviceId: 'sensor-001',
    temperature: 4.5,
    timestamp: new Date().toISOString(),
    batteryLevel: 85,
    signalQuality: 'excellent'
  });
});
```

## Troubleshooting

### Redis não conecta

```bash
# Verificar se Redis está rodando
redis-cli ping
# Deve retornar: PONG

# Verificar logs
redis-cli monitor
```

### Worker não processa jobs

1. Verificar se Redis está acessível
2. Verificar logs do worker
3. Verificar se há jobs na fila:
   ```bash
   redis-cli
   > KEYS bull:import-queue:*
   ```

### Erros de FHIR

Verificar se os dados estão no formato correto antes da conversão. Use o método `validateFHIRResource` para validar.

## Rollback

Se precisar voltar ao fluxo síncrono:

1. Use o endpoint `/api/import/upload` (mantido para compatibilidade)
2. Desabilite o worker
3. Os endpoints assíncronos continuarão funcionando, mas sem processamento

## Suporte

Para problemas ou dúvidas, consulte:
- `ARQUITETURA_IMPORTACAO_ASSINCRONA.md` - Documentação completa
- `AUDITORIA_FLUXO_IMPORTACAO.md` - Requisitos originais

