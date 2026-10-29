// RBAC gate pins for compliance.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/compliance.routes.js',
  mount: '/api/compliance',
  pins: [
    { method: 'GET', path: '/dashboard', roles: [4] },
    { method: 'GET', path: '/report', roles: [4] },
    { method: 'GET', path: '/alerts', roles: [4] },
    { method: 'POST', path: '/alerts/:id/acknowledge', roles: [4] },
    { method: 'POST', path: '/alerts/:id/resolve', roles: [4] },
    { method: 'GET', path: '/verify-biomarker/:id', roles: [4] },
  ],
};
