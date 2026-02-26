import { useState, useEffect } from 'react';
import { Patient } from '../types/models';
import { patientService } from '../services/api';

export function usePatients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await patientService.getAll();
      const responseData: any = response.data;
      
      // API retorna { success: true, data: { patients: [...], total, ... } } ou { data: [...] }
      let patientsData: Patient[] = [];
      
      // Verifica se a resposta tem a estrutura esperada
      if (responseData) {
        // Estrutura: { success: true, data: { patients: [...], total, ... } }
        if (responseData.data && responseData.data.patients && Array.isArray(responseData.data.patients)) {
          patientsData = responseData.data.patients;
        }
        // Estrutura: { data: { patients: [...], total, ... } }
        else if (responseData.patients && Array.isArray(responseData.patients)) {
          patientsData = responseData.patients;
        }
        // Estrutura: { data: [...] } (array direto)
        else if (Array.isArray(responseData)) {
          patientsData = responseData;
        }
        // Estrutura: { data: { data: [...] } }
        else if (responseData.data && Array.isArray(responseData.data)) {
          patientsData = responseData.data;
        }
        // Se for um objeto único, converte em array
        else if (typeof responseData === 'object' && !Array.isArray(responseData)) {
          // Verifica se é um paciente único
          if (responseData.patientID || responseData.id) {
            patientsData = [responseData];
          }
        }
      }
      
      // Garante que cada paciente tenha pelo menos patientID
      patientsData = patientsData.map(p => ({
        ...p,
        patientID: p.patientID || (p as any).id || ''
      }));
      
      setPatients(patientsData);
    } catch (err: any) {
      console.error('Erro ao carregar pacientes:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao carregar pacientes';
      setError(errorMessage);
      setPatients([]); // Garante que a lista seja limpa em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const createPatient = async (data: Partial<Patient>) => {
    try {
      const response = await patientService.create(data);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
      return response.data;
    } catch (err: any) {
      throw new Error(err.response?.data?.error || err.message || 'Erro ao criar paciente');
    }
  };

  const updatePatient = async (id: number | string, data: Partial<Patient>) => {
    try {
      const response = await patientService.update(id, data);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
      return response.data;
    } catch (err: any) {
      throw new Error(err.response?.data?.error || err.message || 'Erro ao atualizar paciente');
    }
  };

  const deletePatient = async (id: number | string) => {
    try {
      // Aceita tanto number quanto string (patientID de 8 dígitos)
      await patientService.delete(id);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
    } catch (err: any) {
      throw new Error(err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao deletar paciente');
    }
  };

  return {
    patients,
    loading,
    error,
    loadPatients,
    createPatient,
    updatePatient,
    deletePatient,
  };
}


