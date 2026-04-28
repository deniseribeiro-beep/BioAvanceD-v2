const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const qualityDomain = require('../../services/quality-domain.service');

const router = express.Router();

router.post('/preview', authenticate, (req, res) => {
  const assessment = qualityDomain.evaluateQuality(req.body || {});
  return res.json({
    success: true,
    data: assessment,
  });
});

module.exports = router;
