import { describe, expect, it } from 'vitest';
import { buildSampleUpdatePayload } from './SampleDetailsPage';

function makeForm(overrides: Partial<Parameters<typeof buildSampleUpdatePayload>[0]> = {}) {
  return {
    linkedProject: 'Project X',
    currentQuantity: '5',
    sampleOrigin: 'Origin',
    extractionProtocol: 'Protocol',
    participantId: 'participant-1',
    ...overrides,
  };
}

// #545: "Status Atual" used to be an editable <select> bound to
// form.currentStatus, sent as currentStatus on every PUT /samples/:id —
// even though sample.service.js has stripped currentStatus/status from
// persisted writes since #540 (specimenStatus is the sole source of
// truth). The dropdown is now a read-only display; the update payload
// must never carry currentStatus (or the legacy status field) again.
describe('buildSampleUpdatePayload', () => {
  it('never includes currentStatus or status, regardless of form contents', () => {
    const payload = buildSampleUpdatePayload(makeForm(), 5);

    expect('currentStatus' in payload).toBe(false);
    expect('status' in payload).toBe(false);
  });

  it('still carries the editable fields through', () => {
    const payload = buildSampleUpdatePayload(makeForm(), 5);

    expect(payload.linkedProject).toBe('Project X');
    expect(payload.sampleOrigin).toBe('Origin');
    expect(payload.extractionProtocol).toBe('Protocol');
    expect(payload.participantId).toBe('participant-1');
    expect(payload.currentQuantity).toBe(5);
  });

  it('omits currentQuantity when parsedAvailable is null', () => {
    const payload = buildSampleUpdatePayload(makeForm(), null);

    expect('currentQuantity' in payload).toBe(false);
    expect('volumeCurrent' in payload).toBe(false);
  });

  it('trims string fields and drops empty ones to undefined', () => {
    const payload = buildSampleUpdatePayload(
      makeForm({ linkedProject: '  Padded  ', sampleOrigin: '   ' }),
      null
    );

    expect(payload.linkedProject).toBe('Padded');
    expect(payload.sampleOrigin).toBeUndefined();
  });
});
