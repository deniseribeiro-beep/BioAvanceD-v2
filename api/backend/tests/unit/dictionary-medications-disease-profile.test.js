import { describe, it, expect, vi, beforeEach } from 'vitest';
const express = require('express');
const request = require('supertest');

const dictionaryRouter = require('../../src/routes/dictionary.js');

function buildDb(collectionOverrides = {}) {
  const findChain = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };

  const collection = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue(findChain),
    createIndex: vi.fn().mockResolvedValue(true),
    estimatedDocumentCount: vi.fn().mockResolvedValue(1), // count > 0 => skip seeding
    bulkWrite: vi.fn().mockResolvedValue(true),
    ...collectionOverrides,
  };

  return {
    db: { collection: vi.fn().mockReturnValue(collection) },
    collection,
    findChain,
  };
}

function buildApp(db) {
  const app = express();
  app.locals.db = db;
  app.use('/api/dictionary', dictionaryRouter);
  return app;
}

describe('GET /api/dictionary/disease-profile', () => {
  let db, collection, app;

  beforeEach(() => {
    ({ db, collection } = buildDb());
    app = buildApp(db);
  });

  it('returns 503 when db is unavailable', async () => {
    const noDbApp = buildApp(null);
    const res = await request(noDbApp).get('/api/dictionary/disease-profile?orphaCode=123');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Database unavailable');
  });

  it('returns 400 when orphaCode is missing', async () => {
    const res = await request(app).get('/api/dictionary/disease-profile');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing orphaCode');
  });

  it('returns 400 when orphaCode is only the ORPHA: prefix (normalizes to empty)', async () => {
    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=ORPHA:');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing orphaCode');
  });

  it('strips the ORPHA: prefix before querying the database', async () => {
    collection.findOne.mockResolvedValue({
      orpha_code: '558',
      name: 'Fabry disease',
      disease_category: 'Erros Inatos do Metabolismo',
    });

    await request(app).get('/api/dictionary/disease-profile?orphaCode=ORPHA:558');

    expect(collection.findOne).toHaveBeenCalledWith({
      orpha_code: '558',
      active: { $ne: false },
    });
  });

  it('returns 404 when no matching document is found', async () => {
    collection.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=558');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Disease profile not found');
  });

  it('returns a normalized disease profile with defaults applied when found', async () => {
    collection.findOne.mockResolvedValue({
      orpha_code: 'ORPHA:558',
      name: '  Fabry disease  ',
      disease_category: ' Erros Inatos do Metabolismo ',
      // validation_requirements absent, drug_classes absent
    });

    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=558');
    expect(res.status).toBe(200);
    expect(res.body.disease).toEqual({
      orpha_code: '558',
      name: 'Fabry disease',
      disease_category: 'Erros Inatos do Metabolismo',
      validation_requirements: {},
      drug_classes: [],
    });
  });

  it('keeps validation_requirements and drug_classes when they are valid', async () => {
    collection.findOne.mockResolvedValue({
      orpha_code: '558',
      name: 'Fabry disease',
      disease_category: 'Erros Inatos do Metabolismo',
      validation_requirements: { requiresBiomarker: true },
      drug_classes: ['enzyme_replacement_therapy'],
    });

    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=558');
    expect(res.status).toBe(200);
    expect(res.body.disease.validation_requirements).toEqual({ requiresBiomarker: true });
    expect(res.body.disease.drug_classes).toEqual(['enzyme_replacement_therapy']);
  });

  it('defaults validation_requirements to {} when it is not an object (e.g. a string)', async () => {
    collection.findOne.mockResolvedValue({
      orpha_code: '558',
      name: 'Fabry disease',
      validation_requirements: 'not-an-object',
      drug_classes: 'not-an-array',
    });

    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=558');
    expect(res.status).toBe(200);
    expect(res.body.disease.validation_requirements).toEqual({});
    expect(res.body.disease.drug_classes).toEqual([]);
  });

  it('returns 500 with the error message when findOne throws', async () => {
    collection.findOne.mockRejectedValue(new Error('mongo exploded'));
    const res = await request(app).get('/api/dictionary/disease-profile?orphaCode=558');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('mongo exploded');
  });
});

describe('GET /api/dictionary/medications/search', () => {
  let db, collection, findChain, app;

  beforeEach(() => {
    ({ db, collection, findChain } = buildDb());
    app = buildApp(db);
  });

  it('returns 503 when db is unavailable', async () => {
    const noDbApp = buildApp(null);
    const res = await request(noDbApp).get('/api/dictionary/medications/search');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Database unavailable');
  });

  it('applies a default limit of 20 when no limit param is given', async () => {
    await request(app).get('/api/dictionary/medications/search');
    expect(findChain.limit).toHaveBeenCalledWith(20);
  });

  it('clamps the limit to 50 when a larger value is requested', async () => {
    await request(app).get('/api/dictionary/medications/search?limit=500');
    expect(findChain.limit).toHaveBeenCalledWith(50);
  });

  it('clamps the limit to 1 when a value of 0 is requested', async () => {
    await request(app).get('/api/dictionary/medications/search?limit=0');
    expect(findChain.limit).toHaveBeenCalledWith(1);
  });

  it('clamps the limit to 1 when a negative value is requested', async () => {
    await request(app).get('/api/dictionary/medications/search?limit=-10');
    expect(findChain.limit).toHaveBeenCalledWith(1);
  });

  it('includes an $or regex filter across name/generic_name/synonyms/code/atc_code when query is present', async () => {
    await request(app).get('/api/dictionary/medications/search?query=fabry');

    const calledFilter = collection.find.mock.calls[0][0];
    expect(calledFilter.$and).toContainEqual({ active: { $ne: false } });
    const orClause = calledFilter.$and.find((clause) => clause.$or);
    expect(orClause).toBeDefined();
    const fields = orClause.$or.map((entry) => Object.keys(entry)[0]);
    expect(fields).toEqual(['name', 'generic_name', 'synonyms', 'code', 'atc_code']);
    orClause.$or.forEach((entry) => {
      const regex = Object.values(entry)[0];
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.source).toBe('fabry');
      expect(regex.flags).toBe('i');
    });
  });

  // #1212: the query is a search term, not a pattern. Unescaped, '(' threw
  // inside the handler and '.' matched any character.
  it('matches regex metacharacters in the query literally', async () => {
    const crash = await request(app).get('/api/dictionary/medications/search?query=' + encodeURIComponent('fab(ry'));
    expect(crash.status).toBe(200);

    await request(app).get('/api/dictionary/medications/search?query=' + encodeURIComponent('fa.ry'));
    const calledFilter = collection.find.mock.calls[collection.find.mock.calls.length - 1][0];
    const regex = calledFilter.$and.find((clause) => clause.$or).$or[0].name;
    expect(regex.test('fa.ry')).toBe(true);
    expect(regex.test('fabry')).toBe(false);
  });

  it('uses the base active filter alone (no $and) when no other params are provided', async () => {
    await request(app).get('/api/dictionary/medications/search');
    const calledFilter = collection.find.mock.calls[0][0];
    expect(calledFilter).toEqual({ active: { $ne: false } });
  });

  it('adds a disease_categories filter when diseaseCategory is present', async () => {
    await request(app).get('/api/dictionary/medications/search?diseaseCategory=Erros%20Inatos%20do%20Metabolismo');
    const calledFilter = collection.find.mock.calls[0][0];
    expect(calledFilter.$and).toContainEqual({ disease_categories: 'Erros Inatos do Metabolismo' });
  });

  it('splits a comma-separated drugClasses param into a drug_class $in filter, trimming whitespace', async () => {
    await request(app).get('/api/dictionary/medications/search?drugClasses=enzyme_replacement_therapy%20,%20corticosteroid');
    const calledFilter = collection.find.mock.calls[0][0];
    expect(calledFilter.$and).toContainEqual({
      drug_class: { $in: ['enzyme_replacement_therapy', 'corticosteroid'] },
    });
  });

  it('returns 200 with medications normalized (atc_code uppercased and ATC: prefix stripped)', async () => {
    findChain.toArray.mockResolvedValue([
      {
        code: 'ATC:a16ab04',
        atc_code: 'atc:a16ab04',
        name: '  Agalsidase beta  ',
        synonyms: ['Fabrazyme', ' Agalsidase-Beta '],
        drug_class: 'enzyme_replacement_therapy',
        disease_categories: ['Erros Inatos do Metabolismo'],
      },
    ]);

    const res = await request(app).get('/api/dictionary/medications/search?query=agalsidase');
    expect(res.status).toBe(200);
    expect(res.body.medications).toHaveLength(1);
    expect(res.body.medications[0].atc_code).toBe('A16AB04');
    expect(res.body.medications[0].name).toBe('Agalsidase beta');
    expect(res.body.medications[0].synonyms).toEqual(['Fabrazyme', 'Agalsidase-Beta']);
  });

  it('returns 500 with the error message when the query throws', async () => {
    findChain.toArray.mockRejectedValue(new Error('query failed'));
    const res = await request(app).get('/api/dictionary/medications/search');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('query failed');
  });

  it('only creates the medication_dictionary indexes once per db instance, not on every request (issue #58)', async () => {
    await request(app).get('/api/dictionary/medications/search?query=fabry');
    expect(collection.createIndex).toHaveBeenCalledTimes(5);

    await request(app).get('/api/dictionary/medications/search?query=fabry');
    expect(collection.createIndex).toHaveBeenCalledTimes(5);
  });
});
