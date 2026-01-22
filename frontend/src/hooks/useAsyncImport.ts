import { useState, useCallback } from 'react';
import { importService } from '../services/api';
import { useImportJob, ImportJob } from './useImportJob';

export interface AsyncImportOptions {
  startLocationID?: number;
  autoIncrement?: boolean;
  onValidationSuccess?: (metadata: any) => void;
  onValidationError?: (errors: string[]) => void;
  onJobCreated?: (jobID: string) => void;
  onCompleted?: (job: ImportJob) => void;
  onFailed?: (job: ImportJob) => void;
  onProgress?: (job: ImportJob) => void;
}

export function useAsyncImport() {
  const [validating, setValidating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentJobID, setCurrentJobID] = useState<string | null>(null);
  const [jobCallbacks, setJobCallbacks] = useState<Pick<AsyncImportOptions, 'onCompleted' | 'onFailed' | 'onProgress'>>({});

  // Hook para monitorar job atual
  const {
    job,
    loading: jobLoading,
    error: jobError,
    isPolling,
    fetchJobStatus,
    startPolling,
    stopPolling,
    cancelJob,
    getReport,
  } = useImportJob(currentJobID, jobCallbacks);

  // Valida arquivo
  const validateFile = useCallback(async (file: File, dataType: string) => {
    setValidating(true);
    setValidationError(null);

    try {
      const response = await importService.validateFile(file, dataType);
      const data = response.data;

      if (!data.success) {
        const errors = data.errors || ['Validação falhou'];
        setValidationError(errors.join(', '));
        return { valid: false, errors, metadata: data.metadata };
      }

      return {
        valid: true,
        errors: [],
        metadata: data.metadata,
      };
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao validar arquivo';
      const errors = err.response?.data?.errors || [errorMessage];
      setValidationError(errorMessage);
      return {
        valid: false,
        errors,
        metadata: null,
      };
    } finally {
      setValidating(false);
    }
  }, []);

  // Cria job de importação
  const createImportJob = useCallback(async (
    file: File,
    dataType: string,
    options: AsyncImportOptions = {}
  ) => {
    setCreating(true);
    setValidationError(null);

    try {
      const response = await importService.createImportJob(file, dataType, {
        startLocationID: options.startLocationID,
        autoIncrement: options.autoIncrement,
      });

      const jobID = response.data.data?.jobID || response.data.jobID;
      if (!jobID) {
        throw new Error('JobID não retornado na resposta');
      }

      setCurrentJobID(jobID);
      startPolling();

      if (options.onJobCreated) {
        options.onJobCreated(jobID);
      }

      return { jobID, success: true };
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao criar job de importação';
      setValidationError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setCreating(false);
    }
  }, [startPolling]);

  // Importação completa (valida + cria job)
  const importFile = useCallback(async (
    file: File,
    dataType: string,
    options: AsyncImportOptions = {}
  ) => {
    // Atualiza callbacks que serão disparados pelo monitoramento do job
    setJobCallbacks({
      onCompleted: options.onCompleted,
      onFailed: options.onFailed,
      onProgress: options.onProgress,
    });

    // 1. Valida arquivo
    const validation = await validateFile(file, dataType);
    
    if (!validation.valid) {
      if (options.onValidationError) {
        options.onValidationError(validation.errors);
      }
      return { success: false, jobID: null, validation };
    }

    if (options.onValidationSuccess) {
      options.onValidationSuccess(validation.metadata);
    }

    // 2. Cria job
    try {
      const result = await createImportJob(file, dataType, options);
      return { ...result, validation };
    } catch (err: any) {
      return {
        success: false,
        jobID: null,
        validation,
        error: err.message,
      };
    }
  }, [validateFile, createImportJob]);

  // Reseta estado
  const reset = useCallback(() => {
    setCurrentJobID(null);
    setValidationError(null);
    stopPolling();
  }, [stopPolling]);

  return {
    // Estados
    validating,
    creating,
    validationError,
    currentJobID,
    job,
    jobLoading,
    jobError,
    isPolling,

    // Métodos
    validateFile,
    createImportJob,
    importFile,
    fetchJobStatus,
    cancelJob,
    getReport,
    reset,
  };
}

