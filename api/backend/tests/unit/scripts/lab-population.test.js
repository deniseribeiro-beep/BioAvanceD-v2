import { describe, it, expect } from 'vitest';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generateLabPopulation } = require('../../../scripts/lab-population/generateLabPopulation');
const { toPatientsCsv, toSamplesCsv, writePopulationFormats } = require('../../../scripts/lab-population/writers');
const {
  createProgress,
  markChunk,
  summarizeProgress,
} = require('../../../scripts/lab-population/progress');

describe('BLPP generateLabPopulation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateLabPopulation({ seed: 4242, n: 5, runId: 't1' });
    const b = generateLabPopulation({ seed: 4242, n: 5, runId: 't1' });
    expect(a.participants.map((p) => p.sourceRecordId)).toEqual(
      b.participants.map((p) => p.sourceRecordId)
    );
    expect(a.specimens.map((s) => s.sampleType)).toEqual(
      b.specimens.map((s) => s.sampleType)
    );
  });

  it('builds chunk plan for resume', () => {
    const pop = generateLabPopulation({ seed: 1, n: 250, chunkSize: 100, runId: 't2' });
    expect(pop.chunks).toHaveLength(3);
    expect(pop.chunks[0]).toMatchObject({ i: 0, start: 0, end: 100 });
    expect(pop.chunks[2]).toMatchObject({ i: 2, start: 200, end: 250 });
  });

  it('writes csv/json formats', async () => {
    const pop = generateLabPopulation({ seed: 7, n: 2, runId: 't3', includeNegatives: true });
    expect(pop.negatives.length).toBeGreaterThan(0);
    const csv = toPatientsCsv(pop);
    expect(csv).toContain('patientName,birthDate,sex,email');
    expect(toSamplesCsv(pop)).toContain('sampleType');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blpp-'));
    const written = await writePopulationFormats(pop, dir, ['json', 'csv']);
    expect(written.length).toBe(3);
    expect(fs.existsSync(path.join(dir, 'population.v1.json'))).toBe(true);
  });

  it('progress resume skips done chunks in summary', () => {
    const pop = generateLabPopulation({ seed: 3, n: 200, chunkSize: 100, runId: 't4' });
    const progress = createProgress({
      runId: pop.runId,
      seed: pop.seed,
      schemaVersion: pop.schemaVersion,
      nTarget: pop.nTarget,
      chunkSize: pop.chunkSize,
      chunks: pop.chunks,
    });
    markChunk(progress, 0, {
      status: 'done',
      counts: { participants: 100, specimens: 100, errors: 0 },
    });
    const summary = summarizeProgress(progress);
    expect(summary.by.done).toBe(1);
    expect(summary.by.pending).toBe(1);
    expect(summary.doneParticipants).toBe(100);
  });
});
