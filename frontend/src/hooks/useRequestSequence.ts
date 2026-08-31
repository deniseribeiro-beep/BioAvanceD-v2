import { useRef } from 'react';

/**
 * #901: shared stale-response discard guard.
 *
 * Extracted from the one correct guard already in the repo --
 * useResults.ts's loadResults (a `useRef(0)` monotonic counter stamped on
 * entry to the loader, checked after the await and in the catch, and used
 * to decide whether the trailing setLoading(false) still applies). Lifting
 * it here lets every parameter-keyed loader (sampleID, diseaseCoding, ...)
 * share the same shape instead of re-deriving it.
 *
 * This is a discard guard, not a cancel guard: it never aborts the
 * in-flight request, it only lets a loader recognize, once its await
 * resolves, that a newer call has since been made for the same hook
 * instance -- and skip writing its now-stale result into state.
 *
 * Usage inside a loader function (the stamp must live in the loader body,
 * not in the effect, so it also covers StrictMode double-invokes and
 * manual reloads):
 *
 *   const seq = requestSeq.next();
 *   try {
 *     const response = await service.get(...);
 *     if (!requestSeq.isCurrent(seq)) return;
 *     setState(response.data);
 *   } catch (err) {
 *     if (!requestSeq.isCurrent(seq)) return;
 *     setError(err.message);
 *   } finally {
 *     if (requestSeq.isCurrent(seq)) setLoading(false);
 *   }
 */
export interface RequestSequence {
  /** Advances the sequence and returns the new value to stamp this call with. */
  next(): number;
  /** True if `seq` is still the most recently issued value (i.e. no newer call has started). */
  isCurrent(seq: number): boolean;
}

export function createRequestSequence(): RequestSequence {
  const box = { current: 0 };
  return {
    next(): number {
      box.current += 1;
      return box.current;
    },
    isCurrent(seq: number): boolean {
      return seq === box.current;
    },
  };
}

/** React hook wrapper: one stable RequestSequence per component instance. */
export function useRequestSequence(): RequestSequence {
  return useRef(createRequestSequence()).current;
}
