import { useState } from 'react';
import { SampleFile } from '../types/models';
import { sampleService } from '../services/api';
import { useRequestSequence } from './useRequestSequence';

export function useSampleFiles(specimenId: string | null) {
  const [files, setFiles] = useState<SampleFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when specimenId changes before the
  // in-flight request for the previous specimenId resolves.
  const requestSeq = useRequestSequence();

  const loadFiles = async () => {
    const seq = requestSeq.next();
    if (!specimenId) {
      setFiles([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await sampleService.listFiles(specimenId);
      if (!requestSeq.isCurrent(seq)) return;
      // Backend retorna { success: true, data: [...] }
      const responseData = response.data as any;
      const filesData = Array.isArray(responseData)
        ? responseData
        : (Array.isArray(responseData?.data)
          ? responseData.data
          : []);
      setFiles(filesData);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.response?.data?.error || err.message || 'Erro ao carregar arquivos');
      setFiles([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const uploadFile = async (file: File): Promise<SampleFile> => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await sampleService.uploadFile(specimenId, formData);
      const responseData = response.data as any;
      const newFile = responseData?.data || responseData;
      
      // Recarrega a lista após upload
      await loadFiles();
      
      return newFile;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao fazer upload do arquivo';
      throw new Error(errorMessage);
    }
  };

  const downloadFile = async (fileID: string, fileName: string) => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      const response = await sampleService.downloadFile(specimenId, fileID);
      
      // Cria URL temporária para download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      
      // Limpa
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao fazer download do arquivo';
      throw new Error(errorMessage);
    }
  };

  const deleteFile = async (fileID: string) => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      await sampleService.deleteFile(specimenId, fileID);
      // Recarrega a lista após exclusão
      await loadFiles();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao excluir arquivo';
      throw new Error(errorMessage);
    }
  };

  const exportHL7v2 = async (fileID: string) => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      const response = await sampleService.exportHL7v2(specimenId, fileID);
      // HL7 v2.x retorna como texto
      const blob = new Blob([response.data], { type: 'text/plain; charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `hl7_${fileID}.hl7`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao exportar arquivo em HL7 v2.x';
      throw new Error(errorMessage);
    }
  };

  const exportFHIR = async (fileID: string) => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      const response = await sampleService.exportFHIR(specimenId, fileID);
      // FHIR retorna como JSON
      const jsonData = response.data;
      const jsonString = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json; charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `fhir_${fileID}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao exportar arquivo em FHIR';
      throw new Error(errorMessage);
    }
  };

  const exportCDA = async (fileID: string) => {
    if (!specimenId) {
      throw new Error('ID da amostra não fornecido');
    }

    try {
      const response = await sampleService.exportCDA(specimenId, fileID);
      // CDA retorna como XML (texto)
      const blob = new Blob([response.data], { type: 'application/xml; charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `cda_${fileID}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao exportar arquivo em CDA';
      throw new Error(errorMessage);
    }
  };

  return {
    files,
    loading,
    error,
    loadFiles,
    uploadFile,
    downloadFile,
    deleteFile,
    exportHL7v2,
    exportFHIR,
    exportCDA,
  };
}

