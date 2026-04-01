const express = require('express');
const router = express.Router();
const controller = require('../controllers/biomarkerRequest.controller');

router.post('/', controller.create);
router.get('/pending', controller.listPending);
router.post('/:id/approve', controller.approve);
router.post('/:id/reject', controller.reject);

module.exports = router;
