import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function loadDictionaryRouter() {
  const routerPath = require.resolve('../../src/routes/dictionary');
  const neo4jPath = require.resolve('../../src/database/neo4j');
  const redisPath = require.resolve('redis');

  delete require.cache[routerPath];
  delete require.cache[neo4jPath];
  delete require.cache[redisPath];

  require.cache[neo4jPath] = {
    id: neo4jPath,
    filename: neo4jPath,
    loaded: true,
    exports: {
      getNeo4jDriver: vi.fn(() => {
        throw new Error('neo4j unavailable');
      }),
    },
  };

  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: {
      createClient: vi.fn(() => ({
        isOpen: true,
        on: vi.fn(),
        connect: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        setEx: vi.fn().mockResolvedValue('OK'),
      })),
    },
  };

  return require('../../src/routes/dictionary');
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/dictionary', loadDictionaryRouter());
  return app;
}

describe('dictionary suggest fallback', () => {
  afterEach(() => {
    delete require.cache[require.resolve('../../src/routes/dictionary')];
    delete require.cache[require.resolve('../../src/database/neo4j')];
    delete require.cache[require.resolve('redis')];
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna HPO e biomarcadores do cache local quando Neo4j esta indisponivel', async () => {
    const db = {
      collection: vi.fn((name) => {
        if (name === 'diseaseDictionary') {
          return {
            findOne: vi.fn().mockResolvedValue({
              orpha_code: '324',
              name: 'Doenca de Fabry',
              validation_requirements: {
                biomarkers: {
                  required: ['alphaGal'],
                  recommended: ['lysoGb3'],
                },
              },
              phenotypes: [{ hpoId: 'HP:0001066', label: 'Angioqueratoma' }],
              active: true,
            }),
          };
        }

        if (name === 'terminologies') {
          return {
            find: vi.fn(() => cursor([{
              sistema: 'HPO',
              codigo: 'HP:0012471',
              descricao: 'Acroparestesia',
              relacoes: { orpha: '324', hpo: 'HP:0012471' },
              ativo: true,
            }])),
          };
        }

        return {
          find: vi.fn(() => cursor([])),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    const response = await request(buildApp(db)).get('/api/dictionary/suggest?orphaCode=324');

    expect(response.status).toBe(200);
    expect(response.body.disease).toMatchObject({ code: '324', display: 'Doenca de Fabry' });
    expect(response.body.phenotypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'HP:0001066', display: 'Angioqueratoma' }),
        expect.objectContaining({ code: 'HP:0012471', display: 'Acroparestesia' }),
      ])
    );
    expect(response.body.biomarkers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'alphaGal', display: 'alphaGal' }),
        expect.objectContaining({ code: 'lysoGb3', display: 'lysoGb3' }),
      ])
    );
  });
});
