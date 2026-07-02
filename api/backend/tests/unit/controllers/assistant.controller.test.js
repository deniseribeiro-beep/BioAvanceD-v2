import { afterEach, describe, expect, it, vi } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require() (see .claude/skills/testing-conventions/SKILL.md,
// "vi.mock() does not intercept require()", confirmed independently multiple
// times 2026-07-02). assistant.controller.js does a plain, non-destructured
// `const assistantService = require('../services/assistant.service')` and
// `const logger = require('../utils/logger')`, so the documented workaround
// applies directly: require the real singleton modules here (Node's CJS
// module cache guarantees the controller and this test share the same object
// instance) and vi.spyOn() their methods, restoring with vi.restoreAllMocks()
// in afterEach.
const assistantController = require('../../../src/controllers/assistant.controller');
const assistantService = require('../../../src/services/assistant.service');
const logger = require('../../../src/utils/logger');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function createReq(overrides = {}) {
  return {
    app: { locals: { db: { fake: true } } },
    body: {},
    user: undefined,
    t: vi.fn((key) => key),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssistantController.answerQuestion', () => {
  it('returns 503 and does not call service when db is unavailable', async () => {
    const answerQuestionSpy = vi.spyOn(assistantService, 'answerQuestion');
    const registerGuidanceLogSpy = vi.spyOn(assistantService, 'registerGuidanceLog');
    const req = createReq({ app: { locals: {} }, body: { question: 'oi' } });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
    expect(answerQuestionSpy).not.toHaveBeenCalled();
    expect(registerGuidanceLogSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with validation error when question is missing (req.t present)', async () => {
    const answerQuestionSpy = vi.spyOn(assistantService, 'answerQuestion');
    const req = createReq({ body: {} });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.questionRequired',
    });
    expect(answerQuestionSpy).not.toHaveBeenCalled();
  });

  it('rejects (unhandled) when question is missing and req.t is undefined, due to missing guard', async () => {
    // answerQuestion() calls req.t('assistant.questionRequired') directly, without the
    // `req.t && req.t(...)` guard used by suggestActions/startTutorial. When req.t is
    // undefined:
    //   1. `res.status(400)` runs (JS evaluates the callee/receiver before its argument
    //      object), THEN building `{ error: req.t(...) }` throws a TypeError -- so
    //      `.json()` for that call is never reached.
    //   2. The throw is caught by the outer catch, which itself does
    //      `res.status(400).json({ ..., error: req.t('assistant.errorProcessing'), ... })`.
    //      `res.status(400)` runs a SECOND time, then building that object also throws
    //      (req.t is still undefined) -- so `.json()` is never reached this time either.
    //   3. This second throw is not caught anywhere else, so the promise returned by
    //      answerQuestion() rejects with a TypeError, and the client never receives any
    //      HTTP response at all (status() was called twice, json() was never called).
    const req = createReq({ body: {}, t: undefined });
    const res = createRes();

    await expect(assistantController.answerQuestion(req, res)).rejects.toThrow(TypeError);

    expect(res.status).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenNthCalledWith(1, 400);
    expect(res.status).toHaveBeenNthCalledWith(2, 400);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('calls assistantService.answerQuestion with correct args, logs, and returns 200 on happy path', async () => {
    const db = { fake: true };
    const answerQuestionSpy = vi
      .spyOn(assistantService, 'answerQuestion')
      .mockResolvedValue({ answer: 'resposta' });
    const registerGuidanceLogSpy = vi
      .spyOn(assistantService, 'registerGuidanceLog')
      .mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { question: 'Como faço X?', contextScope: 'MyScope' },
      user: { userID: 'user-1', accessType: 3 },
      language: 'en-US',
    });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(answerQuestionSpy).toHaveBeenCalledWith(db, 'Como faço X?', 3, 'MyScope', 'en-US');
    expect(registerGuidanceLogSpy).toHaveBeenCalledWith(
      db,
      'user-1',
      'Pergunta: Como faço X?',
      req
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { answer: 'resposta' } });
  });

  it('defaults userRole to 1, language to pt-BR, and contextScope to Interface when absent', async () => {
    const db = { fake: true };
    const answerQuestionSpy = vi.spyOn(assistantService, 'answerQuestion').mockResolvedValue({});
    const registerGuidanceLogSpy = vi
      .spyOn(assistantService, 'registerGuidanceLog')
      .mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { question: 'oi' },
      user: undefined,
    });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(answerQuestionSpy).toHaveBeenCalledWith(db, 'oi', 1, 'Interface', 'pt-BR');
    expect(registerGuidanceLogSpy).toHaveBeenCalledWith(db, undefined, 'Pergunta: oi', req);
  });

  it('truncates the question in the guidance log message to 50 chars', async () => {
    const db = { fake: true };
    const longQuestion = 'a'.repeat(80);
    vi.spyOn(assistantService, 'answerQuestion').mockResolvedValue({});
    const registerGuidanceLogSpy = vi
      .spyOn(assistantService, 'registerGuidanceLog')
      .mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { question: longQuestion },
      user: { userID: 'u1', accessType: 2 },
    });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(registerGuidanceLogSpy).toHaveBeenCalledWith(
      db,
      'u1',
      `Pergunta: ${longQuestion.substring(0, 50)}`,
      req
    );
  });

  it('returns 400 with errorProcessing message and logs when service rejects', async () => {
    const db = { fake: true };
    vi.spyOn(assistantService, 'answerQuestion').mockRejectedValue(new Error('boom'));
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({
      app: { locals: { db } },
      body: { question: 'oi' },
      user: { userID: 'u1', accessType: 2 },
    });
    const res = createRes();

    await assistantController.answerQuestion(req, res);

    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro ao processar pergunta:', 'boom');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.errorProcessing',
      message: 'boom',
    });
  });
});

describe('AssistantController.suggestActions', () => {
  it('returns 503 and does not call service when db is unavailable', async () => {
    const suggestActionsSpy = vi.spyOn(assistantService, 'suggestActions');
    const req = createReq({ app: { locals: {} }, body: { screenID: 'HOME' } });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'errors.databaseUnavailable',
    });
    expect(suggestActionsSpy).not.toHaveBeenCalled();
  });

  it('falls back to default pt-BR message for 503 when req.t is absent', async () => {
    const req = createReq({ app: { locals: {} }, body: { screenID: 'HOME' }, t: undefined });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
  });

  it('returns 400 with validation error when screenID is missing', async () => {
    const suggestActionsSpy = vi.spyOn(assistantService, 'suggestActions');
    const req = createReq({ body: {} });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.screenIDRequired',
    });
    expect(suggestActionsSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with default validation message when screenID missing and req.t absent', async () => {
    const req = createReq({ body: {}, t: undefined });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'screenID é obrigatório',
    });
  });

  it('calls assistantService.suggestActions with correct args, logs, and returns 200 on happy path', async () => {
    const db = { fake: true };
    const suggestActionsSpy = vi
      .spyOn(assistantService, 'suggestActions')
      .mockResolvedValue([{ action: 'do-thing' }]);
    const registerGuidanceLogSpy = vi
      .spyOn(assistantService, 'registerGuidanceLog')
      .mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { screenID: 'HOME' },
      user: { userID: 'user-2', accessType: 4 },
    });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(suggestActionsSpy).toHaveBeenCalledWith(db, 'HOME', 4);
    expect(registerGuidanceLogSpy).toHaveBeenCalledWith(
      db,
      'user-2',
      'Sugestões para tela: HOME',
      req
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ action: 'do-thing' }] });
  });

  it('defaults userRole to 1 when req.user is undefined', async () => {
    const db = { fake: true };
    const suggestActionsSpy = vi.spyOn(assistantService, 'suggestActions').mockResolvedValue([]);
    vi.spyOn(assistantService, 'registerGuidanceLog').mockResolvedValue(undefined);
    const req = createReq({ app: { locals: { db } }, body: { screenID: 'HOME' }, user: undefined });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(suggestActionsSpy).toHaveBeenCalledWith(db, 'HOME', 1);
  });

  it('returns 400 with suggestActionsError message and logs when service rejects', async () => {
    const db = { fake: true };
    vi.spyOn(assistantService, 'suggestActions').mockRejectedValue(new Error('kaboom'));
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({
      app: { locals: { db } },
      body: { screenID: 'HOME' },
      user: { userID: 'u1', accessType: 2 },
    });
    const res = createRes();

    await assistantController.suggestActions(req, res);

    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro ao sugerir ações:', 'kaboom');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.suggestActionsError',
      message: 'kaboom',
    });
  });
});

describe('AssistantController.startTutorial', () => {
  it('returns 503 and does not call service when db is unavailable', async () => {
    const startTutorialSpy = vi.spyOn(assistantService, 'startTutorial');
    const req = createReq({ app: { locals: {} }, body: { flowID: 'FLOW1' } });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'errors.databaseUnavailable',
    });
    expect(startTutorialSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with validation error when flowID is missing', async () => {
    const startTutorialSpy = vi.spyOn(assistantService, 'startTutorial');
    const req = createReq({ body: {} });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.flowIDRequired',
    });
    expect(startTutorialSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with default validation message when flowID missing and req.t absent', async () => {
    const req = createReq({ body: {}, t: undefined });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'flowID é obrigatório',
    });
  });

  it('calls assistantService.startTutorial with correct args, logs, and returns 200 on happy path', async () => {
    const db = { fake: true };
    const startTutorialSpy = vi
      .spyOn(assistantService, 'startTutorial')
      .mockResolvedValue({ steps: [] });
    const registerGuidanceLogSpy = vi
      .spyOn(assistantService, 'registerGuidanceLog')
      .mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { flowID: 'FLOW1' },
      user: { userID: 'user-3', accessType: 2 },
    });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(startTutorialSpy).toHaveBeenCalledWith(db, 'FLOW1', 2);
    expect(registerGuidanceLogSpy).toHaveBeenCalledWith(
      db,
      'user-3',
      'Tutorial iniciado: FLOW1',
      req
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { steps: [] } });
  });

  it('defaults userRole to 1 when req.user.accessType is undefined', async () => {
    const db = { fake: true };
    const startTutorialSpy = vi.spyOn(assistantService, 'startTutorial').mockResolvedValue({});
    vi.spyOn(assistantService, 'registerGuidanceLog').mockResolvedValue(undefined);
    const req = createReq({
      app: { locals: { db } },
      body: { flowID: 'FLOW1' },
      user: { userID: 'user-3' },
    });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(startTutorialSpy).toHaveBeenCalledWith(db, 'FLOW1', 1);
  });

  it('returns 400 with startTutorialError message and logs when service rejects', async () => {
    const db = { fake: true };
    vi.spyOn(assistantService, 'startTutorial').mockRejectedValue(new Error('nope'));
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({
      app: { locals: { db } },
      body: { flowID: 'FLOW1' },
      user: { userID: 'u1', accessType: 2 },
    });
    const res = createRes();

    await assistantController.startTutorial(req, res);

    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro ao iniciar tutorial:', 'nope');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'assistant.startTutorialError',
      message: 'nope',
    });
  });
});
