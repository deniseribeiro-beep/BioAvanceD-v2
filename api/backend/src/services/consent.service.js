// Wave 2 canonical entrypoint. The legacy mutable PatientConsent
// implementation was replaced by the normalized consent-governance v2
// persistence model. Keep this path stable for controllers/routes/tests.
module.exports = require('./consent-v2.service');
