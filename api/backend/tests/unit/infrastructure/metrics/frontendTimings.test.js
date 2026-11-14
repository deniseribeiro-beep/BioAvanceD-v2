import { describe, it, expect } from 'vitest';

const { parseFrontendTimings, createFrontendTimings } = require('../../../../src/infrastructure/metrics/frontendTimings');

// RNF001 C4 and RNF015 C1 (#1469): the browser's request timings, checked
// whole before any is kept.

const item = (name, ms) => ({ name, ms });

describe('#1469: parseFrontendTimings', () => {
  it('accepts a valid batch', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', 120.5), item('POST /api/samples/:id', 0)] });

    expect(parsed).toEqual({ ok: true, value: [item('GET /api/patients', 120.5), item('POST /api/samples/:id', 0)] });
  });

  it('refuses a body with no timings', () => {
    const parsed = parseFrontendTimings({});

    expect(parsed).toEqual({ ok: false, reason: 'timings é obrigatório' });
  });

  it('refuses an empty timings array', () => {
    const parsed = parseFrontendTimings({ timings: [] });

    expect(parsed).toEqual({ ok: false, reason: 'timings deve ser uma lista de 1 a 50 itens' });
  });

  it('refuses 51 items', () => {
    const timings = Array.from({ length: 51 }, () => item('GET /api/patients', 10));

    const parsed = parseFrontendTimings({ timings });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings')).toBe(true);
  });

  it('refuses a body key other than timings', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', 10)], userId: 'u-1' });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('userId')).toBe(true);
  });

  it('refuses a name with a query string', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', 10), item('GET /api/patients?page=2', 10)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[1].name')).toBe(true);
  });

  it('refuses a name with a space in the path', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/pat ients', 10)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].name')).toBe(true);
  });

  it('refuses a lower-case method', () => {
    const parsed = parseFrontendTimings({ timings: [item('get /api/patients', 10)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].name')).toBe(true);
  });

  it('refuses a negative ms', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', -1)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].ms')).toBe(true);
  });

  it('refuses ms 600001', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', 600001)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].ms')).toBe(true);
  });

  it('refuses ms NaN', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', NaN)] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].ms')).toBe(true);
  });

  it('refuses ms given as the string 5', () => {
    const parsed = parseFrontendTimings({ timings: [item('GET /api/patients', '5')] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].ms')).toBe(true);
  });

  it('refuses an item with an extra key', () => {
    const parsed = parseFrontendTimings({ timings: [{ name: 'GET /api/patients', ms: 10, extra: 'x' }] });

    expect(parsed.ok).toBe(false);
    expect(parsed.reason.startsWith('timings[0].extra')).toBe(true);
  });
});

describe('#1469: createFrontendTimings', () => {
  it('counts and buckets two names, each and in the totals', () => {
    const timings = createFrontendTimings();

    timings.recordAll([item('GET /api/patients', 3), item('GET /api/patients', 700), item('POST /api/samples', 40)]);
    const snap = timings.snapshot();

    expect(snap.totals.count).toBe(3);
    expect(snap.totals.buckets).toMatchObject({ 5: 1, 50: 1, 1000: 1 });
    const patients = snap.routes.find((r) => r.name === 'GET /api/patients');
    const samples = snap.routes.find((r) => r.name === 'POST /api/samples');
    expect(patients).toMatchObject({ count: 2, maxMs: 700 });
    expect(patients.buckets).toMatchObject({ 5: 1, 1000: 1 });
    expect(samples).toMatchObject({ count: 1, maxMs: 40 });
    expect(samples.buckets).toMatchObject({ 50: 1 });
    expect(snap.routes).toHaveLength(2);
  });

  it('sends a name past maxSeries to __other__', () => {
    const timings = createFrontendTimings({ maxSeries: 2 });

    timings.recordAll([item('GET /a', 1), item('GET /b', 1), item('GET /c', 1), item('GET /a', 1)]);
    const snap = timings.snapshot();

    expect(snap.routes.map((r) => r.name).sort()).toEqual(['GET /a', 'GET /b', '__other__']);
    expect(snap.routes.find((r) => r.name === '__other__').count).toBe(1);
    expect(snap.routes.find((r) => r.name === 'GET /a').count).toBe(2);
  });

  it('reset empties the totals and the names', () => {
    const timings = createFrontendTimings();
    timings.recordAll([item('GET /a', 1)]);

    timings.reset();

    expect(timings.snapshot().totals.count).toBe(0);
    expect(timings.snapshot().routes).toEqual([]);
  });
});
