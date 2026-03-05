const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const cidController = require('../../controllers/cid.controller');

router.get('/search', authenticate, cidController.search);

module.exports = router;
