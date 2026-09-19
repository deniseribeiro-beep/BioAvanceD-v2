const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const qualityDomain = require('../../services/quality-domain.service');

const router = express.Router();

router.post('/preview', authenticate, (req, res) => {
  const assessment = qualityDomain.evaluateQuality(req.body);
  const invalidInput = assessment.input_status === 'invalid';

  return res.status(invalidInput ? 422 : 200).json({
    success: !invalidInput,
    data: assessment,
  });
});

module.exports = router;
