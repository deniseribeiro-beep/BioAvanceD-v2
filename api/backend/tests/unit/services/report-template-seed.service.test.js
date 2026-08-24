import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedReportTemplates, SYSTEM_REPORT_TEMPLATES } = require('../../../src/services/report-template-seed.service');

/**
 * Real query-matching fake (findOne exact-match on `code`, insertOne) —
 * same shape as rbac-catalog-seed.service.test.js's fixture — proves the
 * seed's upsert-by-code idempotency actually depends on querying by `code`,
 * per build-loop's native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => Object.keys(filter).every((key) => doc[key] === filter[key])) || null;
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
});
