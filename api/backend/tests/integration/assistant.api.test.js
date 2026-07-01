import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const assistantService = require('../../src/services/assistant.service');
const { createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

const FAKE_ANSWER = { answer: 'Para cadastrar uma amostra, acesse o menu Amostras.', suggestions: [] };

beforeEach(() => {
  givenSession();
  vi.spyOn(assistantService, 'answerQuestion').mockResolvedValue(FAKE_ANSWER);
  vi.spyOn(assistantService, 'startTutorial').mockResolvedValue({
    tutorial: { title: 'Cadastrar Paciente', steps: ['Passo 1', 'Passo 2'] }
  });
  vi.spyOn(assistantService, 'suggestActions').mockResolvedValue({
    suggestions: ['Consultar relatórios', 'Cadastrar amostra']
  });
  app.locals.db = createDbMock({});
});

afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/assistant/answer', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/assistant/answer').send({ question: 'Como cadastrar?' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/api/assistant/answer')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns answer for valid question', async () => {
    const res = await request(app)
      .post('/api/assistant/answer')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ question: 'Como cadastrar uma amostra?' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBeTruthy();
  });
});

describe('POST /api/assistant/consult', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/assistant/consult').send({ question: 'Ajuda' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/api/assistant/consult')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns answer for valid question', async () => {
    const res = await request(app)
      .post('/api/assistant/consult')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ question: 'Quais são os tipos de análise?' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assistant/question', () => {
  it('returns 400 when question is missing', async () => {
    const res = await request(app)
      .post('/api/assistant/question')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns answer for valid question', async () => {
    const res = await request(app)
      .post('/api/assistant/question')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ question: 'Como funciona o TCLE?' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assistant/contextual-help', () => {
  it('returns contextual help for a given context', async () => {
    const res = await request(app)
      .post('/api/assistant/contextual-help')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ context: 'samples' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contextualHelp).toBeDefined();
  });
});

describe('POST /api/assistant/tutorial', () => {
  it('returns tutorial steps for a topic', async () => {
    const res = await request(app)
      .post('/api/assistant/tutorial')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ topic: 'paciente' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.steps)).toBe(true);
  });
});

describe('POST /api/assistant/suggestions', () => {
  it('returns action suggestions for a context', async () => {
    const res = await request(app)
      .post('/api/assistant/suggestions')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ context: 'dashboard' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.suggestions)).toBe(true);
  });
});

describe('POST /api/assistant/suggest', () => {
  it('returns suggestions for a context', async () => {
    const res = await request(app)
      .post('/api/assistant/suggest')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ context: 'amostra' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
