import { useMemo, useRef, useState } from 'react';
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

export function resolveSpecimenId(sample: SampleRecord): string {
  return String(sample?.specimenId || '—');
}

export function resolveParticipantId(sample: SampleRecord): string {
  return String(sample?.participantId || '—');
}

export function useSampleCustodyReports() {
  const { samples, loading } = useSamples();
  const [movementBySpecimenId, setMovementBySampleId] = useState<Record<string, SampleMovementState>>({});
  // #901: state here is keyed by specimenId, so cross-row writes are already
  // safe -- but two toggles for the *same* row can still race. Keep one
  // RequestSequence per specimenId (rather than a single shared sequence)
  // so a same-row race is caught without one row's calls staling another
  // row's in-flight request.
  const sequencesRef = useRef<Map<string, RequestSequence>>(new Map());

  const getSequenceFor = (specimenId: string): RequestSequence => {
    let seq = sequencesRef.current.get(specimenId);
    if (!seq) {
      seq = createRequestSequence();
      sequencesRef.current.set(specimenId, seq);
    }
    return seq;
  };

  const rows = useMemo<SampleCustodyRow[]>(() => (samples || []) as SampleCustodyRow[], [samples]);

  const toggleMovements = async (sample: SampleRecord) => {
    const specimenId = resolveSpecimenId(sample);
    const current = movementBySpecimenId[specimenId];

    if (current?.isOpen && !current.isLoading) {
      setMovementBySampleId((previous) => ({
        ...previous,
        [specimenId]: {
          ...current,
          isOpen: false,
        },
      }));
      return;
    }

    setMovementBySampleId((previous) => ({
      ...previous,
      [specimenId]: {
        isOpen: true,
        isLoading: true,
        error: null,
        errorCode: null,
        items: previous[specimenId]?.items || [],
      },
    }));

    const seq = getSequenceFor(specimenId);
    const stamp = seq.next();

    try {
      const response = await sampleChainApi.getMovements(specimenId);
      if (!seq.isCurrent(stamp)) return;
      const normalized = normalizeMovementList(response?.data);
      setMovementBySampleId((previous) => ({
        ...previous,
        [specimenId]: {
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
        [specimenId]: {
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
    movementBySpecimenId,
    toggleMovements,
  };
}

