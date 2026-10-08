// RBAC gate pins for audit.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/audit.routes.js',
  mount: '/api/audit',
  pins: [
    { method: 'GET', path: '/root/:date', permission: 'viewReports' },
    { method: 'GET', path: '/report/:date', permission: 'viewReports' },
    { method: 'GET', path: '/compare/:date', permission: 'viewReports' },
    { method: 'GET', path: '/hl7/:date', permission: 'viewReports' },
    { method: 'GET', path: '/dashboard/dates', permission: 'viewReports' },
    { method: 'GET', path: '/dashboard/stats/:date', permission: 'viewReports' },
    { method: 'GET', path: '/dashboard/roots', permission: 'viewReports' },
    { method: 'POST', path: '/verify', permission: 'viewReports' },
    { method: 'POST', path: '/anchor', permission: 'manageSystem' },
  ],
};
