// backend/src/routes/eConsent.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const PatientModel = require('../models/Patient');
const { getNeo4jDriver } = require('../infrastructure/database/neo4j/connection');
const { sendConsentLink } = require('../services/notification.service');
const CONSENT_SECRET = process.env.CONSENT_SECRET || 'consent_secret';
const CONSENT_EXPIRATION = 60 * 60 * 2; // 2h

// Gera link seguro para o paciente
router.post('/generate-link', async (req, res) => {
  const { patientId, email } = req.body;
  if (!patientId || !email) return res.status(400).json({ error: 'patientId e email obrigatórios' });
  const token = jwt.sign({ patientId }, CONSENT_SECRET, { expiresIn: CONSENT_EXPIRATION });
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/patient/e-consent/${token}`;
  await sendConsentLink(email, link);
  res.json({ success: true, link });
});

// Valida token e retorna dados do paciente e consentimentos
router.get('/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const payload = jwt.verify(token, CONSENT_SECRET);
    const patient = await PatientModel.findOne({ patientID: payload.patientId });
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });
    // Buscar consentimentos no Neo4j (mock)
    res.json({ patient, consents: patient.consents || [] });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

// Atualiza consentimento (aceite ou revogação)
router.post('/update', async (req, res) => {
  const { token, consents } = req.body;
  try {
    const payload = jwt.verify(token, CONSENT_SECRET);
    const patientId = payload.patientId;
    const neo4jDriver = require('../infrastructure/database/neo4j/connection').getNeo4jDriver();
    const session = neo4jDriver.session();
    // Atualiza consentimento no Neo4j (exemplo simplificado)
    for (const c of consents) {
      await session.run(
        'MERGE (p:Patient {patientID: $patientId})-[:HAS_CONSENT]->(c:Consent {key: $key}) SET c.status = $status, c.updatedAt = datetime()',
        { patientId, key: c.key, status: c.status }
      );
    }
    // Se algum consentimento foi revogado, coloca amostras em quarentena
    if (consents.some(c => c.status === 'REVOKED')) {
      // Atualiza status das amostras no Neo4j
      await session.run(
        'MATCH (p:Patient {patientID: $patientId})-[:HAS_SAMPLE]->(s:Sample) SET s.status = "QUARANTINED", s.updatedAt = datetime()',
        { patientId }
      );
      // Atualiza status das amostras no MongoDB
      const Sample = require('../models/Sample');
      await Sample.updateMany({ patientID: patientId }, { $set: { status: 'QUARANTINED' } });
      // Emite evento BullMQ/Socket.IO (mock)
      const io = req.app.get('io');
      if (io) io.to(`patient-${patientId}`).emit('sample-quarantined', { patientId });
    }
    await session.close();
    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

module.exports = router;
