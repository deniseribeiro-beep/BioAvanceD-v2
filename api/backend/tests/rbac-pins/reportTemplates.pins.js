// RBAC gate pins for reportTemplates.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/reportTemplates.routes.js',
  mount: '/api/report-templates',
  pins: [
    { method: 'GET', path: '/', permission: 'viewReports' },
    { method: 'GET', path: '/:id', permission: 'viewReports' },
    { method: 'POST', path: '/', permission: 'manageReportTemplates' },
    { method: 'PUT', path: '/:id', permission: 'manageReportTemplates' },
    { method: 'DELETE', path: '/:id', permission: 'manageReportTemplates' },
  ],
};
