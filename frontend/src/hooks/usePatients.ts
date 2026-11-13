import { useCallback, useState, useEffect } from 'react';
import { Patient } from '../types/models';
import { patientService } from '../services/api';
import { extractResponseItems, extractResponseTotal } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

interface ApiLikeError {
  message?: string;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

type PatientsPayload = {
  success?: boolean;
  data?: unknown;
  patients?: unknown;
  participantId?: string;
  id?: string;
};

type PatientWithOptionalId = Patient & { id?: string };

const NO_TOKEN_PROTECTED_REQUEST = 'NO_TOKEN_PROTECTED_REQUEST';

function extractErrorMessage(error: unknown, fallback: string): string {
  const typedError = error as ApiLikeError | null;
  return typedError?.response?.data?.error || typedError?.response?.data?.message || typedError?.message || fallback;
}

function isSilentAuthAbort(error: unknown): boolean {
  const typedError = error as { code?: string } | null;
  return typedError?.code === NO_TOKEN_PROTECTED_REQUEST;
}

function ensureParticipantId(items: Patient[]): Patient[] {
  return items.map((patient) => {
    const typedPatient = patient as PatientWithOptionalId;
    return {
      ...patient,
      participantId: patient.participantId || typedPatient.id || '',
    };
  });
}

function extractPatients(payload: unknown): Patient[] {
  const typedPayload = payload as PatientsPayload | null;
  const nestedData = typedPayload?.data as PatientsPayload | unknown;

  let patientsData: Patient[] = [];

  const adapterItems = extractResponseItems<Patient>(payload, ['patients']);
  if (adapterItems.length > 0) {
    patientsData = adapterItems;
  } else if (typeof nestedData === 'object' && nestedData && Array.isArray((nestedData as PatientsPayload).patients)) {
    patientsData = (nestedData as PatientsPayload).patients as Patient[];
  } else if (Array.isArray(typedPayload?.patients)) {
    patientsData = typedPayload.patients as Patient[];
  } else if (Array.isArray(payload)) {
    patientsData = payload as Patient[];
  } else if (Array.isArray(typedPayload?.data)) {
    patientsData = typedPayload.data as Patient[];
  } else if (typeof payload === 'object' && payload && ((typedPayload?.participantId || typedPayload?.id))) {
    patientsData = [payload as Patient];
  }

  return ensureParticipantId(patientsData);
}

export function usePatients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadPatients is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();
  const silentSeq = useRequestSequence();

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setPatients([]);
      setTotal(null);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadPatients = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      setError(null);
      const response = await patientService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const patientsData = extractPatients(response.data);
      setPatients(patientsData);
      setTotal(extractResponseTotal(response.data, patientsData.length));
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      if (isSilentAuthAbort(err)) {
        return;
      }
      console.error('Erro ao carregar pacientes:', err);
      setError(extractErrorMessage(err, 'Erro ao carregar pacientes'));
      setPatients([]);
      setTotal(0);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  // A signature that arrives by email must show up without hiding the table.
  // A failed refresh leaves the rows already on screen.
  const refreshPatients = useCallback(async () => {
    const seq = silentSeq.next();
    try {
      const response = await patientService.getAll();
      if (!silentSeq.isCurrent(seq)) return;
      const patientsData = extractPatients(response.data);
      setPatients(patientsData);
      setTotal(extractResponseTotal(response.data, patientsData.length));
      setError(null);
    } catch (err: unknown) {
      if (!silentSeq.isCurrent(seq) || isSilentAuthAbort(err)) return;
    }
  }, [silentSeq]);

  const createPatient = async (data: Partial<Patient>) => {
    try {
      const response = await patientService.create(data);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
      notifyDashboardDataChanged();
      return response.data;
    } catch (err: unknown) {
      const typedError = err as ApiLikeError;
      if (typedError?.response) {
        throw err;
      }
      throw new Error(extractErrorMessage(err, 'Erro ao criar paciente'));
    }
  };

  const updatePatient = async (id: number | string, data: Partial<Patient>) => {
    try {
      const response = await patientService.update(id, data);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
      notifyDashboardDataChanged();
      return response.data;
    } catch (err: unknown) {
      const typedError = err as ApiLikeError;
      if (typedError?.response) {
        throw err;
      }
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar paciente'));
    }
  };

  const deletePatient = async (id: number | string) => {
    try {
      // Aceita tanto number quanto string (participantId de 8 dígitos)
      await patientService.delete(id);
      // Recarrega a lista completa para garantir dados atualizados
      await loadPatients();
      notifyDashboardDataChanged();
    } catch (err: unknown) {
      const typedError = err as ApiLikeError;
      if (typedError?.response) {
        throw err;
      }
      throw new Error(extractErrorMessage(err, 'Erro ao deletar paciente'));
    }
  };

  return {
    patients,
    total,
    loading,
    error,
    loadPatients,
    refreshPatients,
    createPatient,
    updatePatient,
    deletePatient,
  };
}



