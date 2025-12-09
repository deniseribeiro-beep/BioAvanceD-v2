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
      
      // API retorna { success: true, data: { patients: [...], total, ... } } ou { data: [...] }
      let patientsData: Patient[] = [];
      
      // Verifica se a resposta tem a estrutura esperada
      if (response.data) {
        // Estrutura: { success: true, data: { patients: [...], total, ... } }
        if (response.data.data && response.data.data.patients && Array.isArray(response.data.data.patients)) {
          patientsData = response.data.data.patients;
        }
        // Estrutura: { data: { patients: [...], total, ... } }
        else if (response.data.patients && Array.isArray(response.data.patients)) {
          patientsData = response.data.patients;
        }
        // Estrutura: { data: [...] } (array direto)
        else if (Array.isArray(response.data)) {
          patientsData = response.data;
        }
        // Estrutura: { data: { data: [...] } }
        else if (response.data.data && Array.isArray(response.data.data)) {
          patientsData = response.data.data;
        }
        // Se for um objeto único, converte em array
        else if (typeof response.data === 'object' && !Array.isArray(response.data)) {
          // Verifica se é um paciente único
          if (response.data.patientID || (response.data as any).id) {
            patientsData = [response.data];
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


