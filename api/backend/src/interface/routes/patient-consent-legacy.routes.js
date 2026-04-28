const express = require('express');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../../utils/collectionResolver');

const router = express.Router();

async function findPatientByConsentToken(db, token) {
  const patientsCollection = await getCollection(db, 'patients');
  return patientsCollection.findOne({ consentToken: token });
}

router.get('/consent-by-token/:token', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const token = String(req.params.token || '').trim();
    const patient = await findPatientByConsentToken(db, token);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Token de consentimento não encontrado' });
    }

    const templatesCollection = await getCollection(db, 'consentTemplates');
    const templateId = String(patient.consentTemplateId || '').trim();
    const template = ObjectId.isValid(templateId)
      ? await templatesCollection.findOne({ _id: new ObjectId(templateId) })
      : null;

    return res.status(200).json({
      success: true,
      data: {
        patient,
        template,
        consentToken: token,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao validar token de consentimento', message: error.message });
  }
});

router.put('/consent-by-token/:token', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const token = String(req.params.token || '').trim();
    const patient = await findPatientByConsentToken(db, token);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Token de consentimento não encontrado' });
    }

    const consentsCollection = await getCollection(db, 'consents');
    const now = new Date();
    const consent = {
      patientId: String(patient._id),
      patientID: String(patient.patientID || ''),
      templateId: String(patient.consentTemplateId || ''),
      responses: req.body?.responses || req.body?.consents || {},
      status: 'ACTIVE',
      signedAt: now,
      createdAt: now,
      updatedAt: now,
      source: 'legacy-consent-by-token',
    };
    const result = await consentsCollection.insertOne(consent);

    const patientsCollection = await getCollection(db, 'patients');
    await patientsCollection.updateOne(
      { _id: patient._id },
      { $set: { status: 'ACTIVE', consentAcceptedAt: now, updatedAt: now } }
    );

    return res.status(200).json({
      success: true,
      data: { _id: result.insertedId, ...consent },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao registrar consentimento por token', message: error.message });
  }
});

module.exports = router;
