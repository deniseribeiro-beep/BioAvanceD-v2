const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');

// #1089 unified the temperature-policy store on 'temperaturePolicies', the
// collection contracts/canonical/v1 maps to dict-02's ThresholdProfile, and
// kept the HTTP contract on its legacy names behind a translation layer: a
// request mapper, a response mapper and a key->path allowlist map, the same
// mapping stated three times. #1139 retired that layer. The request and the
// response ARE the stored document, so a caller's key is the path it lands on.
//
// The names are TemperaturePolicy.schema.js's, whose header maps them onto
// dict-02: name = profileName (P1X-0106), minTemp/maxTemp = lowerLimit/
// upperLimit, effectivePeriod (P1X-0111), minimumDuration (P1X-0110, minutes,
// #1195). One non-dictionary field remains: temperatureUnit, which dict-02
// carries inside lowerLimit/upperLimit as Quantities -- a storage migration,
// not a boundary one. #1197 dropped targetTemp: a nominal setpoint belongs to
// the storage unit (StorageContainer.temperature; v2.0.0 ELM-0175
// nominalTemperature), not to the threshold rule, and nothing enforced it.
const CANONICAL_METRIC_TYPE = 'temperature';
const CANONICAL_RULE_VERSION = '1.0.0';
// #1198: Celsius only. Nothing that enforces a policy reads its unit --
// iot.controller and checkPolicyAndAlert compare a reading's bare number with
// minTemp/maxTemp, and the schema has no unit field -- so a policy saved as
// degF was enforced as if its numbers were degC. Accepting only the unit the
// comparison already assumes makes the stored value true, rather than
// converting at the boundary.
const TEMPERATURE_UNITS = ['\u00b0C'];
const TEMPERATURE_UNIT_ERROR = 'temperatureUnit deve ser \u00b0C';

function validatePolicy(body) {
  const errors = [];
  // dict-02 P1X-0106 profileName is 1..1 Core, and the schema requires it.
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    errors.push('name \u00e9 obrigat\u00f3rio e deve ser string n\u00e3o vazia');
  }
  for (const field of ['minTemp', 'maxTemp']) {
    if (typeof body[field] !== 'number') {
      errors.push(`${field} \u00e9 obrigat\u00f3rio e deve ser number`);
    }
  }
  if (body.minTemp >= body.maxTemp) {
    errors.push('minTemp deve ser menor que maxTemp');
  }
  if (body.temperatureUnit && !TEMPERATURE_UNITS.includes(body.temperatureUnit)) {
    errors.push(TEMPERATURE_UNIT_ERROR);
  }
  return { isValid: errors.length === 0, errors };
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function buildPolicy(body) {
  const period = body.effectivePeriod || {};
  const now = new Date();
  return {
    name: body.name,
    minTemp: body.minTemp,
    maxTemp: body.maxTemp,
    hysteresis: body.hysteresis === undefined ? 0.5 : body.hysteresis,
    metricType: CANONICAL_METRIC_TYPE,
    ruleVersion: CANONICAL_RULE_VERSION,
    effectivePeriod: {
      start: toDate(period.start) || now,
      end: toDate(period.end)
    },
    // Set explicitly because these routes use the native driver, so the
    // schema's own default never runs. Null (or any non-positive value) is
    // TelemetryMonitor's "fall back to the global threshold" (#1195).
    minimumDuration: body.minimumDuration === undefined ? null : body.minimumDuration,
    temperatureUnit: body.temperatureUnit || '\u00b0C',
    createdAt: now,
    updatedAt: now
  };
}

// CRUD de Políticas de Temperatura
// #1074: the three READS carried `authenticate` and nothing else, so the
// read population was every authenticated user -- UsuarioExterno, whose only
// seeded grant is viewReports, included -- while the three WRITES below
// already carried viewTemperature. A policy row holds the thresholds
// checkPolicyAndAlert compares a reading against, so this is RF009's
// excursion detection being readable by anyone with an account.
//
// viewTemperature is the READ population's own code and needs no catalogue
// change: its allowedActions are CRUD (rbac-catalog-seed.service.js:96), so
// the #631 derived-action check passes for GET -> READ. And it costs nothing
// in the UI -- usePolicies' only consumer is FacilityManagementPage, which
// ProtectedRoute already limits to the three roles seeded with this code.
//
// The WRITE half followed separately: the three writes below now gate on
// 'manageTemperaturePolicy' (see rbac-catalog-seed.service.js for why that
// code exists rather than reusing manageTemperature). The grants are
// unchanged -- whether rewriting an alert threshold should be a
// Coordenador-and-above capability rather than a Tecnico one is still open,
// but it is now a catalogue decision rather than a code change.
router.get('/', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const policiesCollection = db.collection('temperaturePolicies');
    const policies = await policiesCollection.find({}).toArray();

    return res.status(200).json({
      success: true,
      data: policies
    });
  } catch (error) {
    logger.error('Erro ao listar políticas:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar políticas',
      message: error.message
    });
  }
});

// #1074, as above.
router.get('/:id', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const policiesCollection = db.collection('temperaturePolicies');
    // Tenta encontrar por policyId primeiro (busca numérica), depois por _id (MongoDB ObjectId)
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    const numId = parseInt(id, 10);
    
    let policy;
    // #1178: only an all-digit id is a legacy numeric policyId. parseInt
    // reads the leading digits of an ObjectId hex string ('66f2...' -> 66),
    // which could match an unrelated legacy policy before the _id lookup ran.
    if (/^\d+$/.test(id) && !isNaN(numId)) {
      // Se é um número, busca por policyId
      policy = await policiesCollection.findOne({ policyId: numId });
    }
    
    if (!policy && ObjectId.isValid(id)) {
      // Se não encontrou e o id é um ObjectId válido, busca por _id
      policy = await policiesCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      data: policy
    });
  } catch (error) {
    logger.error('Erro ao buscar política:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar política',
      message: error.message
    });
  }
});

// #1074, as above.
router.get('/:id/active-limit', authenticate, requirePermission('viewTemperature'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const policiesCollection = db.collection('temperaturePolicies');
    // Tenta encontrar por policyId primeiro (busca numérica), depois por _id (MongoDB ObjectId)
    const { ObjectId } = require('mongodb');
    const id = req.params.id;
    const numId = parseInt(id, 10);
    
    let policy;
    // #1178: only an all-digit id is a legacy numeric policyId. parseInt
    // reads the leading digits of an ObjectId hex string ('66f2...' -> 66),
    // which could match an unrelated legacy policy before the _id lookup ran.
    if (/^\d+$/.test(id) && !isNaN(numId)) {
      // Se é um número, busca por policyId
      policy = await policiesCollection.findOne({ policyId: numId });
    }
    
    if (!policy && ObjectId.isValid(id)) {
      // Se não encontrou e o id é um ObjectId válido, busca por _id
      policy = await policiesCollection.findOne({ _id: new ObjectId(id) });
    }

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    const isMax = req.query.type === 'max';
    const limit = isMax ? policy.maxTemp : policy.minTemp;

    return res.status(200).json({
      success: true,
      data: {
        limit,
        type: isMax ? 'max' : 'min',
        unit: policy.temperatureUnit || 'C'
      }
    });
  } catch (error) {
    logger.error('Erro ao buscar limite ativo:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar limite ativo',
      message: error.message
    });
  }
});

router.post('/', authenticate, requirePermission('manageTemperaturePolicy'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const validation = validatePolicy(req.body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', '),
        details: validation.errors
      });
    }

    const policiesCollection = db.collection('temperaturePolicies');
    const policy = buildPolicy(req.body);

    const result = await policiesCollection.insertOne(policy);

    return res.status(201).json({
      success: true,
      message: 'Política criada com sucesso',
      data: { _id: result.insertedId, ...policy }
    });
  } catch (error) {
    logger.error('Erro ao criar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao criar política',
      message: error.message
    });
  }
});

router.put('/:id', authenticate, requirePermission('manageTemperaturePolicy'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const policiesCollection = db.collection('temperaturePolicies');

    // #875: $set used to be built straight from req.body, letting a caller
    // inject arbitrary keys or overwrite fields like policyId/policyID.
    // Allowlist the request's own fields; policyId/policyID is business
    // identity and is excluded, updatedAt is server-set here (never
    // caller-supplied).
    //
    // #1139: a list again. #1089 had made it a key->path map while the
    // request's names diverged from the stored ones, and a typo in a map
    // value $set a field nothing reads. Now the caller's key is the stored
    // path, so the only way to get an entry wrong is to omit it, which fails
    // safe. effectivePeriod is set per bound, so a PUT carrying only `end`
    // keeps the stored `start`.
    const ALLOWED_POLICY_UPDATE_FIELDS = [
      'name',
      'minTemp',
      'maxTemp',
      'hysteresis',
      'minimumDuration',
      'temperatureUnit'
    ];
    const updateFields = {};
    for (const field of ALLOWED_POLICY_UPDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updateFields[field] = req.body[field];
      }
    }
    // #1198: POST's unit check, applied to the one field a PUT could
    // otherwise set to a unit nothing honours.
    if (updateFields.temperatureUnit && !TEMPERATURE_UNITS.includes(updateFields.temperatureUnit)) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: TEMPERATURE_UNIT_ERROR,
        details: [TEMPERATURE_UNIT_ERROR]
      });
    }
    const period = req.body.effectivePeriod;
    if (period && typeof period === 'object') {
      for (const bound of ['start', 'end']) {
        if (Object.prototype.hasOwnProperty.call(period, bound)) {
          updateFields[`effectivePeriod.${bound}`] = toDate(period[bound]);
        }
      }
    }
    updateFields.updatedAt = new Date();

    const result = await policiesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Política atualizada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao atualizar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao atualizar política',
      message: error.message
    });
  }
});

router.delete('/:id', authenticate, requirePermission('manageTemperaturePolicy'), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    const policiesCollection = db.collection('temperaturePolicies');
    const result = await policiesCollection.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Política não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Política deletada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao deletar política:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Erro ao deletar política',
      message: error.message
    });
  }
});

module.exports = router;

