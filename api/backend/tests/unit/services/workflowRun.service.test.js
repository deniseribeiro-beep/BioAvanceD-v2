import { describe, it, expect, vi } from 'vitest';

const { validateWorkflowRunReferences } = require('../../../src/services/workflowRun.service');

// RF027 AC6 (#1322): a run that resumes a failed one names it in
// resumesWorkflowRunId, checked once on create and never editable.
function dbWith(storedRun) {
  const findOne = vi.fn().mockResolvedValue(storedRun);
  const collection = vi.fn().mockReturnValue({ findOne });
  return { db: { collection }, findOne, collection };
}

const FAILED_RUN = {
  workflowRunId: 'run-failed-001',
  workflowId: 'variant-calling-pipeline',
  workflowVersion: '2.3.1',
  runStatus: 'failed',
};

const RESUME_PAYLOAD = {
  workflowRunId: 'run-resume-002',
  workflowId: 'variant-calling-pipeline',
  workflowVersion: '2.3.1',
  runStatus: 'running',
  resumesWorkflowRunId: 'run-failed-001',
};

describe('validateWorkflowRunReferences (RF027 AC6)', () => {
  it('without resumesWorkflowRunId -> resolves without a lookup', async () => {
    const { db, collection } = dbWith(FAILED_RUN);
    await expect(validateWorkflowRunReferences(db, { workflowRunId: 'run-1', runStatus: 'failed' })).resolves.toBeUndefined();
    expect(collection).not.toHaveBeenCalled();
  });

  it.each([
    ['a value', 'run-failed-001'],
    ['null', null],
  ])('an update (no workflowRunId) naming resumesWorkflowRunId as %s -> 422, no lookup', async (_label, resumesWorkflowRunId) => {
    const { db, collection } = dbWith(FAILED_RUN);
    await expect(validateWorkflowRunReferences(db, { updatedAt: new Date(), resumesWorkflowRunId })).rejects.toMatchObject({
      statusCode: 422,
      message: 'resumesWorkflowRunId é registrado na criação da execução e não pode ser editado',
      details: ['resumesWorkflowRunId é registrado na criação da execução e não pode ser editado'],
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it('a create with resumesWorkflowRunId null -> resolves without a lookup', async () => {
    const { db, collection } = dbWith(FAILED_RUN);
    await expect(validateWorkflowRunReferences(db, { ...RESUME_PAYLOAD, resumesWorkflowRunId: null })).resolves.toBeUndefined();
    expect(collection).not.toHaveBeenCalled();
  });

  it('a run resuming itself -> 422, no lookup', async () => {
    const { db, collection } = dbWith(FAILED_RUN);
    await expect(validateWorkflowRunReferences(db, { ...RESUME_PAYLOAD, resumesWorkflowRunId: 'run-resume-002' })).rejects.toMatchObject({
      statusCode: 422,
      message: 'uma execução não retoma a si mesma',
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it('an unknown resumed run -> 404', async () => {
    const { db, findOne } = dbWith(null);
    await expect(validateWorkflowRunReferences(db, RESUME_PAYLOAD)).rejects.toMatchObject({
      statusCode: 404,
      message: 'resumesWorkflowRunId run-failed-001 não encontrado',
    });
    expect(findOne).toHaveBeenCalledWith({ workflowRunId: 'run-failed-001' });
  });

  it('a stored succeeded run -> 422', async () => {
    const { db } = dbWith({ ...FAILED_RUN, runStatus: 'succeeded' });
    await expect(validateWorkflowRunReferences(db, RESUME_PAYLOAD)).rejects.toMatchObject({
      statusCode: 422,
      message: 'resumesWorkflowRunId deve referenciar uma execução failed ou cancelled',
    });
  });

  it.each([
    ['workflowId', { workflowId: 'other-pipeline' }],
    ['workflowVersion', { workflowVersion: '2.4.0' }],
  ])('a different %s -> 422', async (_label, override) => {
    const { db } = dbWith({ ...FAILED_RUN, ...override });
    await expect(validateWorkflowRunReferences(db, RESUME_PAYLOAD)).rejects.toMatchObject({
      statusCode: 422,
      message: 'uma retomada mantém workflowId e workflowVersion da execução retomada',
    });
  });

  it.each(['failed', 'cancelled'])('a stored %s run of the same workflow and version -> resolves', async (runStatus) => {
    const { db, collection } = dbWith({ ...FAILED_RUN, runStatus });
    await expect(validateWorkflowRunReferences(db, RESUME_PAYLOAD)).resolves.toBeUndefined();
    expect(collection).toHaveBeenCalledWith('workflowRuns');
  });
});
