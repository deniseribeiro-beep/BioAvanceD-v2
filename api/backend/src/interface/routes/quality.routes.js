const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const qualityDomain = require('../../services/quality-domain.service');
const rcsCertificationService = require('../../services/rcs-certification.service');
const { samplePayloadOf } = require('../../services/rcs-certification.service');
const { resolveGovernanceEvidence } = require('../../services/governance-evidence-resolver.service');

const router = express.Router();

// RNF018 AC5 (#1524): the body's governanceEvidence references are resolved
// against the stored records before certification, and the response carries
// the six governance criteria read from the result.
router.post('/preview', authenticate, async (req, res) => {
  try {
    const source = samplePayloadOf(req.body);
    const resolution = await resolveGovernanceEvidence(req.app.locals.db, {
      governanceEvidence: source.governanceEvidence,
      specimenId: source.specimenId,
      collectionId: source.collectionId,
    });
    const assessment = qualityDomain.evaluateQuality(
      req.body,
      resolution ? { governanceEvidenceResolution: resolution } : {}
    );
    return res.json({
      success: true,
      data: {
        ...assessment,
        governance_evidence: rcsCertificationService.evaluateGovernanceEvidence(assessment.rcs_input),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
