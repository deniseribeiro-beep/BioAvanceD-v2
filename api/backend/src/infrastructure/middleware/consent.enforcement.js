const consentValidator = require('../../services/consent.validator');

function enforceCommercialConsent(options = {}) {
  const scope = options.scope || 'uso_comercial';
  const resolveSampleId = options.resolveSampleId || ((req) => {
    return req.body?.specimenId || req.body?.specimenId || req.params?.specimenId || req.params?.id || null;
  });

  return async (req, res, next) => {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const specimenId = resolveSampleId(req);
      consentValidator.init(db);
      await consentValidator.validateAccess(specimenId, scope);

      return next();
    } catch (error) {
      return res.status(403).json({
        success: false,
        error: 'Consentimento insuficiente para uso comercial',
        message: error.message
      });
    }
  };
}

module.exports = { enforceCommercialConsent };
