/**
 * #1266: lgpd.allowDataExport (P1X-0316, "permite exportação de dados mediante
 * autorização") switches the personal-data exports off. Mounted after
 * authentication and the route's own permission or scope checks, so a caller
 * those refuse learns nothing about the setting.
 *
 * #1274: on the sample-file exports, requireOrganizationScope refuses only a
 * caller with no organization. Whether this sample is in the caller's scope
 * is the controller's check, after this gate. So a caller with an
 * organization, asking for another organization's file, is told exports are
 * off. That leaks nothing: the switch is site-wide, and the same caller reads
 * it from any export of their own. With exports off it also hides whether the
 * file is in or out of scope, so no answer here is more specific than the
 * controller's own.
 */
async function requireDataExportAllowed(req, res, next) {
  try {
    // Lazy: security.service loads session.service and the audit logger.
    const securityService = require('../../services/security.service');
    const db = req.app && req.app.locals && req.app.locals.db;
    // No database: the route's own 503 answers, as it did before the gate.
    if (!db) return next();
    if (await securityService.isDataExportAllowed(db)) return next();
    return res.status(403).json({
      success: false,
      error: 'Exportação desabilitada',
      message: 'A exportação de dados está desabilitada na configuração LGPD'
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireDataExportAllowed };
