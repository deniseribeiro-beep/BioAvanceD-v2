const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const PolicyModel = require('../../models/Policy');

// #1089: the six CRUD routes here wrote db.collection('policies') while the
// telemetry ingestion path -- iot.controller#resolveTemperaturePolicy, via
// SensorMetadata.temperaturePolicy, down into TelemetryMonitor.js:233 --
// resolves a sensor's thresholds out of 'temperaturePolicies'. Nothing
// joined the two stores, so a policy created through this API governed no
// sensor, and checkPolicyAndAlert's `if (!policy) return` failed open
// rather than erroring. contracts/canonical/v1/index.js:232 maps
// temperaturePolicies to dict-02's ThresholdProfile, and models/Policy.js
// calls itself a "Politica de Temperatura" in its own first line, so the
// two were never different concepts -- temperaturePolicies survives.
//
// Dennis's calls 2026-09-22, recorded on the issue:
//   Q4 -- the stored document takes the canonical shape; the HTTP contract
//         keeps its existing field names, translated here at the boundary.
//         That is what these two functions are, and the whole of it.
//   Q1 -- dict-02 P1X-0106 profileName is 1..1 Core and the API had no
//         source for it, so callers now supply policyName. That is a new
//         REQUIRED request field (PolicyModel.validate enforces it).
//
// Q2/Q3 were not put to him, because Q4 answers them: temperatureUnit and
// alertDelayMin have no dict-02 counterpart, but a GET still returns them,
// so they must round-trip and are persisted as non-canonical extensions
// alongside policyId. Retiring this translation -- and with it the legacy
// names in the frontend's Policy type -- is the follow-up issue's job.
const CANONICAL_METRIC_TYPE = 'temperature';
const CANONICAL_RULE_VERSION = '1.0.0';

function toCanonical(body) {
  return {
    name: body.policyName,
    minTemp: body.minThreshold,
    maxTemp: body.maxThreshold,
    targetTemp: body.targetTemperature,
    hysteresis: body.hysteresis === undefined ? 0.5 : body.hysteresis,
    metricType: CANONICAL_METRIC_TYPE,
    ruleVersion: CANONICAL_RULE_VERSION,
    effectivePeriod: {
      start: body.validFrom ? new Date(body.validFrom) : new Date(),
      end: body.validTo ? new Date(body.validTo) : null
    },
    // P1X-0110. Set explicitly because these routes use the native driver,
    // so TemperaturePolicySchema's own default never runs. TelemetryMonitor
    // treats a non-positive value as "fall back to the global threshold".
    minimumDuration: null,
    // Non-canonical, kept because the HTTP contract above still exposes them.
    policyId: body.policyId || body.policyID || null,
    alertDelayMin: body.alertDelayMin === undefined ? 5 : body.alertDelayMin,
    temperatureUnit: body.temperatureUnit || '\u00b0C',
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function toApiShape(doc) {
  if (!doc) return doc;
  const { name, minTemp, maxTemp, targetTemp, effectivePeriod, ...rest } = doc;
  return {
    ...rest,
    policyName: name,
    minThreshold: minTemp,
    maxThreshold: maxTemp,
    targetTemperature: targetTemp,
    validFrom: effectivePeriod ? effectivePeriod.start : undefined,
    validTo: effectivePeriod ? effectivePeriod.end : undefined
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
      data: policies.map(toApiShape)
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
      data: toApiShape(policy)
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

    const validation = PolicyModel.validate(req.body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        error: 'Dados inválidos',
        message: validation.errors.join(', ')
      });
    }

    const policiesCollection = db.collection('temperaturePolicies');
    const policy = toCanonical(req.body);

    const result = await policiesCollection.insertOne(policy);

    return res.status(201).json({
      success: true,
      message: 'Política criada com sucesso',
      data: toApiShape({ _id: result.insertedId, ...policy })
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
    // #1089: the allowlist is now a MAP rather than a list, because the
    // request's names and the stored document's names diverge here. The
    // key is what a caller may send; the value is the canonical path it
    // lands on. An unlisted key still reaches nothing, which is #875's
    // whole invariant and is unchanged.
    const ALLOWED_POLICY_UPDATE_FIELDS = {
      policyName: 'name',
      minThreshold: 'minTemp',
      maxThreshold: 'maxTemp',
      targetTemperature: 'targetTemp',
      hysteresis: 'hysteresis',
      alertDelayMin: 'alertDelayMin',
      temperatureUnit: 'temperatureUnit',
      validFrom: 'effectivePeriod.start',
      validTo: 'effectivePeriod.end'
    };
    const updateFields = {};
    for (const [field, canonicalPath] of Object.entries(ALLOWED_POLICY_UPDATE_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = req.body[field];
        updateFields[canonicalPath] =
          canonicalPath.startsWith('effectivePeriod.') && value ? new Date(value) : value;
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

