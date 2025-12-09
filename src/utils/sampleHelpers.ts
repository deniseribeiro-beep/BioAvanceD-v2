// Funções auxiliares para Sample conforme diagrama UML

import { Sample, Result } from '../types/models';

/**
 * Obtém resultados associados a uma amostra
 * Implementa: Sample.getResults(): List<Result>
 */
export function getResults(sampleID: number, allResults: Result[]): Result[] {
  return allResults.filter((result) => result.sampleID === sampleID);
}

/**
 * Vincula uma amostra a um resultado
 * Implementa: Result.linkSample(Sample)
 */
export function linkSample(result: Result, sampleID: number): Result {
  return {
    ...result,
    sampleID,
  };
}


