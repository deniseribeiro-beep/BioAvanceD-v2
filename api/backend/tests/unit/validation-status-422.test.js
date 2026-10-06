import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// RNF018/RNF011 (#1300, split from #975): a model-validation failure answers
// 422. The service-layer validate-then-throw sites tag their error with
// statusCode 422 (the consent.service.js createPatientConsent precedent), and
// each caller's catch answers 422 for that tag only. Every other error keeps
// the status that catch gave it before, because the same catch also receives
// lookup failures, conflicts and programming errors.

const accessRequestController = require('../../src/controllers/accessRequest.controller');
const consentController = require('../../src/controllers/consent.controller');
const dispositionActionController = require('../../src/controllers/dispositionAction.controller');
const legalHoldController = require('../../src/controllers/legalHold.controller');
const nonconformanceController = require('../../src/controllers/nonconformance.controller');
const notificationRuleController = require('../../src/controllers/notificationRule.controller');
const retentionPolicyController = require('../../src/controllers/retentionPolicy.controller');
const sensorController = require('../../src/controllers/sensor.controller');
const temperatureController = require('../../src/controllers/temperature.controller');

const accessRequestService = require('../../src/services/accessRequest.service');
const consentService = require('../../src/services/consent.service');
const dispositionActionService = require('../../src/services/dispositionAction.service');
const legalHoldService = require('../../src/services/legalHold.service');
const nonconformanceService = require('../../src/services/nonconformance.service');
const notificationRuleService = require('../../src/services/notificationRule.service');
const retentionPolicyService = require('../../src/services/retentionPolicy.service');
const sensorService = require('../../src/services/sensor.service');
const temperatureService = require('../../src/services/temperature.service');

function buildReq() {
  return {
    app: { locals: { db: {} } },
    body: {},
    params: { id: 'id-1' },
    // A global scope makes resolveOrganizationIdForCreate pass the body's
    // value through, so sensor/temperature reach their service call.
    organizationScope: { scope: 'global' },
  };
}

function buildRes() {
  const res = { locals: {} };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function validationError() {
  const error = new Error('campo obrigatório ausente');
  error.statusCode = 422;
  return error;
}

// [label, controller, handler, service, service method, status for an untagged error]
const CASES = [
  ['POST access request', accessRequestController, 'createAccessRequest', accessRequestService, 'createRequest', 400],
  ['POST consent policy', consentController, 'createPolicy', consentService, 'createPolicy', 400],
  ['PUT consent policy', consentController, 'updatePolicy', consentService, 'updatePolicy', 400],
  ['POST consent template', consentController, 'createTemplate', consentService, 'createTemplate', 400],
  ['POST disposition action', dispositionActionController, 'record', dispositionActionService, 'recordDisposition', 400],
  ['POST legal hold', legalHoldController, 'impose', legalHoldService, 'imposeHold', 400],
  ['POST nonconformance', nonconformanceController, 'open', nonconformanceService, 'open', 400],
  ['POST notification rule', notificationRuleController, 'createRule', notificationRuleService, 'createRule', 400],
  ['PUT notification rule', notificationRuleController, 'updateRule', notificationRuleService, 'updateRule', 400],
  ['POST retention policy', retentionPolicyController, 'createPolicy', retentionPolicyService, 'createPolicy', 400],
  ['PUT retention policy', retentionPolicyController, 'updatePolicy', retentionPolicyService, 'updatePolicy', 400],
  ['POST sensor', sensorController, 'create', sensorService, 'createSensor', 400],
  ['POST temperature reading', temperatureController, 'createReading', temperatureService, 'createTemperatureReading', 400],
];

describe('service-layer validation failures answer 422 (#1300)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(CASES)('%s: a statusCode-422 validation error answers 422', async (_label, controller, handler, service, method) => {
    vi.spyOn(service, method).mockRejectedValue(validationError());
    const res = buildRes();

    await controller[handler](buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, message: 'campo obrigatório ausente' });
  });

  it.each(CASES)('%s: an untagged error keeps its previous status', async (_label, controller, handler, service, method, previous) => {
    vi.spyOn(service, method).mockRejectedValue(new Error('falha inesperada'));
    const res = buildRes();

    await controller[handler](buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(previous);
  });

  it('POST disposition action: a legal-hold block still answers 409, not 422', async () => {
    vi.spyOn(dispositionActionService, 'recordDisposition').mockRejectedValue(
      new Error('Destinação bloqueada: bloqueio legal ou ético ativo sobre um ou mais itens afetados')
    );
    const res = buildRes();

    await dispositionActionController.record(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('the service throw sites tag a validation failure with statusCode 422 (#1300)', () => {
  // These four validate before touching the db, so an empty payload reaches
  // the throw with no fake collections.
  it.each([
    ['accessRequest.createRequest', accessRequestService, 'createRequest'],
    ['dispositionAction.recordDisposition', dispositionActionService, 'recordDisposition'],
    ['legalHold.imposeHold', legalHoldService, 'imposeHold'],
    ['nonconformance.open', nonconformanceService, 'open'],
  ])('%s', async (_label, service, method) => {
    await expect(service[method]({}, {})).rejects.toMatchObject({ statusCode: 422 });
  });
});
