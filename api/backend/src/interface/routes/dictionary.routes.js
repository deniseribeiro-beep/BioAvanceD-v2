// backend/src/interface/routes/dictionary.routes.js
//
// #1301: /api/dictionary was mounted with no authentication, so every route
// on it (search, suggest, disease-profile, medications, ATC) answered an
// anonymous caller, and /suggest runs release lookups per phenotype (#885).
// Every caller is an authenticated page sending the session token through
// apiClient, so the gate sits here, at the mount, and the route module stays
// mountable bare for its own unit tests.
const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const dictionaryRouter = require('../../../src/routes/dictionary');

const router = express.Router();
router.use(authenticate, dictionaryRouter);

module.exports = router;
