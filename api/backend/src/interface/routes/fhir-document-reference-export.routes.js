const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const { requireDataExportAllowed } = require('../../infrastructure/middleware/lgpdExportGate');
const { enforceCommercialConsent } = require('../../infrastructure/middleware/consent.enforcement');
const { findSampleByAnyId } = require('../../utils/sampleLookup');
const { isSampleInOrganizationScope } = require('../../services/sampleTenancy.service');
const { buildFhirExport, toFhirDocumentReference } = require('../../services/fhir.service');
const logger = require('../../utils/logger');

// RF011 AC4 (#1322): the FHIR R4 DocumentReference export of one sample file,
// mounted at /api/export/fhir/samples/:specimenId/files/:fileID. It carries
// the gates and the checks of GET /api/samples/:specimenId/files/:fileID/
// export/fhir, in its order: organization scope, the LGPD export switch,
// commercial consent, then the file, the sample, the link and the sample's
// organization. Read only (RF011 AC7).
const router = express.Router({ mergeParams: true });

router.get('/',
  authenticate,
  requireOrganizationScope,
  requireDataExportAllowed,
  enforceCommercialConsent({ resolveSampleId: (req) => req.params.specimenId }),
  async (req, res) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const specimenId = String(req.params.specimenId);
      const fileID = String(req.params.fileID);
      if (!ObjectId.isValid(fileID)) {
        return res.status(404).json({ success: false, error: `${fileID} não encontrado` });
      }

      const file = await db.collection('sample_files').findOne({ _id: new ObjectId(fileID) });
      if (!file || file.deletedAt) {
        return res.status(404).json({ success: false, error: `${fileID} não encontrado` });
      }

      const sample = await findSampleByAnyId(db.collection('samples'), specimenId);
      if (String(file.specimenId) !== (sample ? sample._id.toString() : specimenId)) {
        return res.status(400).json({ success: false, error: 'Arquivo não está vinculado a esta amostra' });
      }
      if (!sample) {
        return res.status(404).json({ success: false, error: `${specimenId} não encontrado` });
      }
      if (req.organizationScope && !isSampleInOrganizationScope(sample, req.organizationScope)) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Esta amostra pertence a outra organização',
        });
      }

      return res.status(200).json({
        success: true,
        data: buildFhirExport('DocumentReference', [toFhirDocumentReference(file)], { generatedAt: new Date().toISOString() }),
      });
    } catch (error) {
      logger.error('Erro ao exportar FHIR:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao exportar FHIR', message: error.message });
    }
  });

module.exports = router;
