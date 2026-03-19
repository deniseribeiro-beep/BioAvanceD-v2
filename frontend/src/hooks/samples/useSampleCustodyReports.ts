import { useMemo, useState } from 'react';
import { sampleChainApi } from '@/services/sampleChainApi';
import { Sample } from '@/types/models';
import { useSamples } from '../useSamples';
import { normalizeMovementList, parseComplianceError, SampleMovementItem } from './sampleMovements.shared';

export type SampleMovement = SampleMovementItem;

export type SampleCustodyRow = Sample & {
  _id?: string;
  id?: string;
  patientId?: string;
  patient?: { id?: string };
  code?: string;
};

export interface SampleMovementState {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
  items: SampleMovement[];
}

type SampleRecord = SampleCustodyRow;

export function resolveSampleId(sample: SampleRecord): string {
  return String(sample?.sampleID || sample?.id || sample?._id || '—');
}

export function resolvePatientId(sample: SampleRecord): string {
  return String(sample?.patientId || sample?.patientID || sample?.patient?.id || '—');
}

export function useSampleCustodyReports() {
  const { samples, loading } = useSamples();
  const [movementBySampleId, setMovementBySampleId] = useState<Record<string, SampleMovementState>>({});

  const rows = useMemo<SampleCustodyRow[]>(() => (samples || []) as SampleCustodyRow[], [samples]);

  const toggleMovements = async (sample: SampleRecord) => {
    const sampleId = resolveSampleId(sample);
    const current = movementBySampleId[sampleId];

    if (current?.isOpen && !current.isLoading) {
      setMovementBySampleId((previous) => ({
        ...previous,
        [sampleId]: {
          ...current,
          isOpen: false,
        },
      }));
      return;
    }

    setMovementBySampleId((previous) => ({
      ...previous,
      [sampleId]: {
        isOpen: true,
        isLoading: true,
        error: null,
        errorCode: null,
        items: previous[sampleId]?.items || [],
      },
    }));

    try {
      const response = await sampleChainApi.getMovements(sampleId);
      const normalized = normalizeMovementList(response?.data);
      setMovementBySampleId((previous) => ({
        ...previous,
        [sampleId]: {
          isOpen: true,
          isLoading: false,
          error: null,
          errorCode: null,
          items: normalized,
        },
      }));
    } catch (error: unknown) {
      const parsed = parseComplianceError(error);
      setMovementBySampleId((previous) => ({
        ...previous,
        [sampleId]: {
          isOpen: true,
          isLoading: false,
          error: parsed.message,
          errorCode: parsed.code,
          items: [],
        },
      }));
    }
  };

  return {
    loading,
    rows,
    movementBySampleId,
    toggleMovements,
  };
}
