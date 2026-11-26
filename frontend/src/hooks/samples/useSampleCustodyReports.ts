import { useRef, useState } from 'react';
import { sampleChainApi } from '@/services/sampleChainApi';
import { Sample } from '@/types/models';
import { useSamples } from '../useSamples';
import { normalizeMovementList, parseComplianceError, SampleMovementItem } from './sampleMovements.shared';
import { createRequestSequence, RequestSequence } from '../useRequestSequence';

export type SampleMovement = SampleMovementItem;

export type SampleCustodyRow = Sample & {
  _id?: string;
  id?: string;
  participantId?: string;
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
  return String(sample?.specimenId || sample?.id || sample?._id || '—');
}

export function resolveParticipantId(sample: SampleRecord): string {
  return String(sample?.participantId || sample?.patient?.id || '—');
}

export function useSampleCustodyReports() {
  const { samples, loading } = useSamples();
  const [movementBySampleId, setMovementBySampleId] = useState<Record<string, SampleMovementState>>({});
  // #901: state here is keyed by sampleId, so cross-row writes are already
  // safe -- but two toggles for the *same* row can still race. Keep one
  // RequestSequence per sampleId (rather than a single shared sequence)
  // so a same-row race is caught without one row's calls staling another
  // row's in-flight request.
  const sequencesRef = useRef<Map<string, RequestSequence>>(new Map());

  const getSequenceFor = (sampleId: string): RequestSequence => {
    let seq = sequencesRef.current.get(sampleId);
    if (!seq) {
      seq = createRequestSequence();
      sequencesRef.current.set(sampleId, seq);
    }
    return seq;
  };

  const rows = samples as SampleCustodyRow[];

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

    const seq = getSequenceFor(sampleId);
    const stamp = seq.next();

    try {
      const response = await sampleChainApi.getMovements(sampleId);
      if (!seq.isCurrent(stamp)) return;
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
      if (!seq.isCurrent(stamp)) return;
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

