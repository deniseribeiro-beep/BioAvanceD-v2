/**
 * Lightweight contract for GET /dictionary/procedures/search handler shape.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/database/neo4j', () => ({
  getNeo4jDriver: () => ({
    session: () => ({ run: async () => ({ records: [] }), close: async () => {} }),
  }),
}));
vi.mock('../../src/services/DrugService', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../../src/ingestion/activeCodeValidator', () => ({
  checkActiveCode: vi.fn(),
}));
vi.mock('../../src/services/biomarkerAssociation.service', () => ({
  findAssociationsForOrpha: vi.fn(async () => []),
}));
vi.mock('../../src/utils/requestContext', () => ({
  currentRequestId: () => 'test',
  neo4jTxConfig: () => ({}),
}));
vi.mock('redis', () => ({
  createClient: () => ({
    on: () => {},
    connect: async () => {},
    get isOpen() {
      return false;
    },
  }),
}));

const dictionaryRouter = (await import('../../src/routes/dictionary')).default;

function makeApp(db) {
  const app = express();
  app.use((req, _res, next) => {
    req.app.locals.db = db;
    next();
  });
  app.use('/dictionary', dictionaryRouter);
  return app;
}

describe('GET /dictionary/procedures/search', () => {
  it('returns SIGTAP + institutional matches', async () => {
    const rows = [
      {
        systemUri: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS',
        code: '0101010010',
        display: 'ATIVIDADE EDUCATIVA',
      },
    ];
    const institutional = [{ code: 'INST-1', display: 'Biópsia institucional', active: true }];
    const db = {
      collection(name) {
        if (name === 'terminologyConcepts') {
          return {
            find: () => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => rows,
                }),
              }),
            }),
          };
        }
        if (name === 'institutionalProcedureCodes') {
          return {
            find: () => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => institutional,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };

    const res = await request(makeApp(db)).get('/dictionary/procedures/search').query({ query: 'ATIV' });
    expect(res.status).toBe(200);
    expect(res.body.procedures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '0101010010', source: 'SIGTAP' }),
        expect.objectContaining({ code: 'INST-1', source: 'INSTITUTIONAL' }),
      ]),
    );
  });

  it('requires query', async () => {
    const res = await request(makeApp({ collection: () => ({}) })).get('/dictionary/procedures/search');
    expect(res.status).toBe(400);
  });
});
