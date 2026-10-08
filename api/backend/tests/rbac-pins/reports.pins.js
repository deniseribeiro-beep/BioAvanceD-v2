// RBAC gate pins for reports.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/reports.routes.js',
  mount: '/api/reports',
  pins: [
    { method: 'GET', path: '/', permission: 'viewReports' },
    { method: 'GET', path: '/:id', permission: 'viewReports' },
    { method: 'POST', path: '/generate', permission: 'viewReports' },
    { method: 'DELETE', path: '/:id', permission: 'viewReports' },
    { method: 'DELETE', path: '/:id', roles: [3, 4] },
    { method: 'GET', path: '/:type/filters', permission: 'viewReports' },
    { method: 'POST', path: '/:type/preview', permission: 'viewReports' },
    { method: 'GET', path: '/:type/export', permission: 'viewReports' },
    { method: 'GET', path: '/:type/export/pdf', permission: 'viewReports' },
  ],
};
