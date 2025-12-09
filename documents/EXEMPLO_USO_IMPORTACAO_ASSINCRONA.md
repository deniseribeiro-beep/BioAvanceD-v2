# Exemplo de Uso - Importação Assíncrona no Frontend

Este documento mostra como usar os novos hooks e serviços para importação assíncrona no frontend.

## Instalação

Primeiro, instale a dependência do Socket.IO:

```bash
npm install socket.io-client
```

## Exemplo 1: Uso Básico com Hook

```typescript
import { useAsyncImport } from '../hooks/useAsyncImport';
import { useState } from 'react';

function ImportComponent() {
  const [file, setFile] = useState<File | null>(null);
  const [dataType, setDataType] = useState<'patients' | 'samples'>('patients');

  const {
    validating,
    creating,
    validationError,
    job,
    jobLoading,
    isPolling,
    importFile,
    reset,
  } = useAsyncImport();

  const handleImport = async () => {
    if (!file) return;

    try {
      const result = await importFile(file, dataType, {
        onValidationSuccess: (metadata) => {
          console.log('Arquivo validado:', metadata);
        },
        onValidationError: (errors) => {
          console.error('Erros de validação:', errors);
        },
        onJobCreated: (jobID) => {
          console.log('Job criado:', jobID);
        },
        onCompleted: (job) => {
          console.log('Importação concluída:', job);
          alert(`Importação concluída! ${job.successCount} registros importados.`);
        },
        onFailed: (job) => {
          console.error('Importação falhou:', job);
          alert(`Importação falhou: ${job.errors[0]?.error || 'Erro desconhecido'}`);
        },
        onProgress: (job) => {
          console.log(`Progresso: ${job.progress}%`);
        },
      });

      if (result.success) {
        console.log('Job criado com sucesso:', result.jobID);
      }
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        accept=".csv,.xlsx"
      />
      
      <select value={dataType} onChange={(e) => setDataType(e.target.value as any)}>
        <option value="patients">Pacientes</option>
        <option value="samples">Amostras</option>
      </select>

      <button
        onClick={handleImport}
        disabled={!file || validating || creating}
      >
        {validating && 'Validando...'}
        {creating && 'Criando job...'}
        {!validating && !creating && 'Importar'}
      </button>

      {validationError && (
        <div style={{ color: 'red' }}>
          Erro de validação: {validationError}
        </div>
      )}

      {job && (
        <div>
          <h3>Status do Job: {job.status}</h3>
          <p>Progresso: {job.progress}%</p>
          <p>Total: {job.totalRecords}</p>
          <p>Sucesso: {job.successCount}</p>
          <p>Erros: {job.errorCount}</p>
          
          {isPolling && <p>Monitorando...</p>}
          
          {job.status === 'completed' && (
            <div style={{ color: 'green' }}>
              Importação concluída com sucesso!
            </div>
          )}
          
          {job.status === 'failed' && (
            <div style={{ color: 'red' }}>
              Importação falhou. Verifique os erros.
            </div>
          )}
        </div>
      )}

      <button onClick={reset}>Resetar</button>
    </div>
  );
}
```

## Exemplo 2: Uso Manual (Passo a Passo)

```typescript
import { importService } from '../services/api';
import { useImportJob } from '../hooks/useImportJob';
import { useState } from 'react';

function ManualImportComponent() {
  const [file, setFile] = useState<File | null>(null);
  const [jobID, setJobID] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null);

  const {
    job,
    loading: jobLoading,
    error: jobError,
    fetchJobStatus,
  } = useImportJob(jobID);

  // Passo 1: Validar arquivo
  const handleValidate = async () => {
    if (!file) return;

    try {
      const response = await importService.validateFile(file, 'patients');
      setValidationResult(response.data);
      
      if (response.data.success) {
        console.log('Arquivo válido:', response.data.metadata);
      } else {
        console.error('Erros de validação:', response.data.errors);
      }
    } catch (error) {
      console.error('Erro ao validar:', error);
    }
  };

  // Passo 2: Criar job
  const handleCreateJob = async () => {
    if (!file || !validationResult?.success) return;

    try {
      const response = await importService.createImportJob(file, 'patients');
      const newJobID = response.data.data?.jobID || response.data.jobID;
      setJobID(newJobID);
      console.log('Job criado:', newJobID);
    } catch (error) {
      console.error('Erro ao criar job:', error);
    }
  };

  // Passo 3: Monitorar status (manual)
  const handleCheckStatus = async () => {
    if (!jobID) return;
    await fetchJobStatus();
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <button onClick={handleValidate} disabled={!file}>
        1. Validar Arquivo
      </button>

      {validationResult && (
        <div>
          {validationResult.success ? (
            <div style={{ color: 'green' }}>
              Arquivo válido! Pode prosseguir.
            </div>
          ) : (
            <div style={{ color: 'red' }}>
              Erros: {validationResult.errors?.join(', ')}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleCreateJob}
        disabled={!validationResult?.success}
      >
        2. Criar Job de Importação
      </button>

      {jobID && (
        <div>
          <p>Job ID: {jobID}</p>
          <button onClick={handleCheckStatus} disabled={jobLoading}>
            3. Verificar Status
          </button>

          {job && (
            <div>
              <p>Status: {job.status}</p>
              <p>Progresso: {job.progress}%</p>
              <p>Sucesso: {job.successCount} / {job.totalRecords}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## Exemplo 3: Atualização do ImportPage.tsx

```typescript
import { useState } from 'react';
import { useAsyncImport } from '../hooks/useAsyncImport';
import { Clock, CheckCircle, XCircle } from 'lucide-react';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<'patients' | 'samples' | null>(null);

  const {
    validating,
    creating,
    validationError,
    job,
    jobLoading,
    isPolling,
    importFile,
    reset,
  } = useAsyncImport();

  const handleImport = async (type: 'patients' | 'samples') => {
    if (!file) return;

    setImportType(type);
    reset(); // Reseta estado anterior

    try {
      await importFile(file, type, {
        onCompleted: (job) => {
          // Notificação de sucesso já é tratada pelo hook
          console.log('Importação concluída:', job);
        },
        onFailed: (job) => {
          console.error('Importação falhou:', job);
        },
      });
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const getStatusIcon = () => {
    if (!job) return null;
    
    switch (job.status) {
      case 'completed':
        return <CheckCircle className="status-icon completed" />;
      case 'failed':
        return <XCircle className="status-icon failed" />;
      case 'processing':
      case 'pending':
        return <Clock className="status-icon processing" />;
      default:
        return null;
    }
  };

  return (
    <div className="page">
      {/* ... resto do componente ... */}

      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        accept=".csv,.xlsx"
      />

      <button
        onClick={() => handleImport('patients')}
        disabled={!file || validating || creating}
      >
        {validating && 'Validando...'}
        {creating && 'Criando job...'}
        {job && isPolling && `Processando... ${job.progress}%`}
        {!validating && !creating && !job && 'Importar Pacientes'}
      </button>

      {validationError && (
        <div className="error">
          Erro de validação: {validationError}
        </div>
      )}

      {job && (
        <div className="job-status">
          {getStatusIcon()}
          <h3>Status: {job.status}</h3>
          <div className="progress-bar">
            <div
              style={{ width: `${job.progress}%` }}
              className="progress-fill"
            />
          </div>
          <p>Total: {job.totalRecords} | Sucesso: {job.successCount} | Erros: {job.errorCount}</p>

          {job.status === 'completed' && (
            <div className="success-message">
              Importação concluída com sucesso!
            </div>
          )}

          {job.errors && job.errors.length > 0 && (
            <div className="errors">
              <h4>Erros:</h4>
              {job.errors.map((err, idx) => (
                <div key={idx}>
                  {err.row && `Linha ${err.row}: `}
                  {err.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## Exemplo 4: Com WebSocket (Notificações em Tempo Real)

```typescript
import { useEffect } from 'react';
import { useAsyncImport } from '../hooks/useAsyncImport';
import { io } from 'socket.io-client';

function ImportWithWebSocket() {
  const { importFile, job } = useAsyncImport();

  useEffect(() => {
    // Conecta ao WebSocket para receber notificações
    const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
    const socket = io(API_URL);

    socket.on('import-completed', (data) => {
      if (data.jobID === job?.jobID) {
        console.log('Notificação recebida: Importação concluída!');
        // Atualizar UI, mostrar notificação, etc.
      }
    });

    socket.on('import-failed', (data) => {
      if (data.jobID === job?.jobID) {
        console.error('Notificação recebida: Importação falhou!');
        // Atualizar UI, mostrar erro, etc.
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [job?.jobID]);

  // ... resto do componente
}
```

## Notas Importantes

1. **Validação Separada**: A validação é opcional, mas recomendada para melhor UX
2. **Polling Automático**: O hook `useImportJob` faz polling automático quando um jobID é fornecido
3. **WebSocket**: Notificações em tempo real são habilitadas por padrão
4. **Cleanup**: Sempre chame `reset()` quando necessário limpar o estado
5. **Error Handling**: Trate erros tanto na validação quanto na criação do job

## Variáveis de Ambiente

Certifique-se de configurar no `.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Ou o hook detectará automaticamente a URL base.

