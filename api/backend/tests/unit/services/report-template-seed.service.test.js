import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedReportTemplates, SYSTEM_REPORT_TEMPLATES } = require('../../../src/services/report-template-seed.service');

/**
 * Real query-matching fake (findOne exact-match on `code`, insertOne,
 * updateOne) — same shape as rbac-catalog-seed.service.test.js's fixture —
 * proves the seed's upsert-by-code idempotency actually depends on querying
 * by `code`, per build-loop's native-only "real backend" proof bar.
 * `calls.updateOne` counts real invocations so a test can assert the #1064
 * no-op-reseed contract (no write at all when nothing changed) without
 * relying on vitest's `vi.fn()` spies.
 */
function createFakeCollection() {
  const docs = [];
  const calls = { updateOne: 0 };
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    calls,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      calls.updateOne += 1;
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function createFakeDb() {
  const collections = { reportTemplates: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('report-template-seed.service', () => {
  it('seeds one ReportTemplate row per migrated legacy report type', async () => {
    const db = createFakeDb();

    const { templates } = await seedReportTemplates(db);

    expect(templates).toHaveLength(SYSTEM_REPORT_TEMPLATES.length);
    expect(templates.every((t) => t.isSystemDefined === true)).toBe(true);
    expect(templates.map((t) => t.code)).toContain('samples_by_patient');
    expect(templates.map((t) => t.code)).toContain('access_logs');
  });

  it('seeds both temperature rows against the shared "temperature" handlerKey, distinguished by handlerOptions.mode', async () => {
    const db = createFakeDb();

    const { templates } = await seedReportTemplates(db);

    const control = templates.find((t) => t.code === 'temperature_control');
    const report = templates.find((t) => t.code === 'temperature');
    expect(control.handlerKey).toBe('temperature');
    expect(control.handlerOptions).toEqual({ mode: 'control' });
    expect(report.handlerKey).toBe('temperature');
    expect(report.handlerOptions).toEqual({ mode: 'report' });
  });

  it('every seeded row passes ReportTemplateModel.validate', async () => {
    const ReportTemplateModel = require('../../../src/models/ReportTemplate');
    const db = createFakeDb();

    const { templates } = await seedReportTemplates(db);

    for (const template of templates) {
      const { isValid, errors } = ReportTemplateModel.validate(template);
      expect(isValid, `${template.code}: ${errors.join(', ')}`).toBe(true);
    }
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    const db = createFakeDb();

    await seedReportTemplates(db);
    await seedReportTemplates(db);

    expect(db.collections.reportTemplates.docs).toHaveLength(SYSTEM_REPORT_TEMPLATES.length);
  });

  it('preserves a later hand-edit to a seeded row on re-seed (does not overwrite by code)', async () => {
    const db = createFakeDb();

    await seedReportTemplates(db);
    const seededDoc = db.collections.reportTemplates.docs.find((t) => t.code === 'samples');
    seededDoc.name = 'Amostras (renomeado pelo Coordenador)';

    await seedReportTemplates(db);

    const stillEdited = db.collections.reportTemplates.docs.find((t) => t.code === 'samples');
    expect(stillEdited.name).toBe('Amostras (renomeado pelo Coordenador)');
  });

  // #1064: a bare "already exists? skip" upsert froze handlerKey/handlerOptions
  // /isSystemDefined at whatever they were the first time a code was seeded —
  // indistinguishable from an operator edit, so a later SYSTEM_REPORT_TEMPLATES
  // fix (e.g. a corrected handlerOptions.mode) never reached an
  // already-seeded database. This is the bug itself: a stale system-owned
  // field gets reconciled on re-seed, while the same row's operator-owned
  // name/description survive untouched in the same assertion.
  it('reconciles a stale handlerOptions on an already-seeded row while leaving its operator-edited name/description untouched', async () => {
    const db = createFakeDb();

    await seedReportTemplates(db);
    const stale = db.collections.reportTemplates.docs.find((t) => t.code === 'temperature_control');
    stale.handlerOptions = { mode: 'legacy' };
    stale.name = 'Controle de Temperatura (renomeado pelo Coordenador)';
    stale.description = 'Descrição customizada pelo Coordenador';

    await seedReportTemplates(db);

    const reconciled = db.collections.reportTemplates.docs.find((t) => t.code === 'temperature_control');
    expect(reconciled.handlerOptions).toEqual({ mode: 'control' });
    expect(reconciled.name).toBe('Controle de Temperatura (renomeado pelo Coordenador)');
    expect(reconciled.description).toBe('Descrição customizada pelo Coordenador');
  });

  it('reconciles a stale handlerKey/isSystemDefined on an already-seeded row while leaving templateStatus (a Coordenador-retired row) untouched', async () => {
    const db = createFakeDb();

    await seedReportTemplates(db);
    const stale = db.collections.reportTemplates.docs.find((t) => t.code === 'patients');
    stale.handlerKey = 'stalePatientHandler';
    stale.isSystemDefined = false;
    stale.templateStatus = 'retired';

    await seedReportTemplates(db);

    const reconciled = db.collections.reportTemplates.docs.find((t) => t.code === 'patients');
    expect(reconciled.handlerKey).toBe('patient');
    expect(reconciled.isSystemDefined).toBe(true);
    expect(reconciled.templateStatus).toBe('retired');
  });

  // Mirrors upsertRole's early-return contract: a re-seed that changes
  // nothing must not issue any updateOne, not merely leave values unchanged.
  // `handlerOptions` defaults to a fresh `{}` object on every
  // buildSystemTemplateDocs() call (ReportTemplateModel.fieldsOf), so this
  // also proves the comparison is by value, not by reference — an
  // object-identity comparison would call updateOne on every single re-seed.
  it('issues no updateOne calls when a re-seed changes nothing (mirrors upsertRole\'s early-return contract; also proves handlerOptions is compared by value, not reference)', async () => {
    const db = createFakeDb();

    await seedReportTemplates(db);
    await seedReportTemplates(db);

    expect(db.collections.reportTemplates.calls.updateOne).toBe(0);
  });

  // Fake timers force the two seed runs onto distinct millisecond ticks --
  // on a real clock they can land in the same millisecond, making a
  // not-equal assertion on `updatedAt` flaky by coincidence rather than
  // meaningful.
  describe('updatedAt', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is set only when a system-owned field actually changed', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const db = createFakeDb();

      await seedReportTemplates(db);
      const originalUpdatedAt = db.collections.reportTemplates.docs.find((t) => t.code === 'patients').updatedAt;

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      await seedReportTemplates(db);
      expect(db.collections.reportTemplates.docs.find((t) => t.code === 'patients').updatedAt).toEqual(originalUpdatedAt);

      const stale = db.collections.reportTemplates.docs.find((t) => t.code === 'patients');
      stale.handlerKey = 'stalePatientHandler';
      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      await seedReportTemplates(db);

      const reconciled = db.collections.reportTemplates.docs.find((t) => t.code === 'patients');
      expect(reconciled.handlerKey).toBe('patient');
      expect(reconciled.updatedAt).not.toEqual(originalUpdatedAt);
    });
  });
});
