// RBAC gate pins for diagnostic-report.routes.js (#695). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/diagnostic-report.routes.js',
  mount: '/api/diagnostic-reports',
  pins: [
    { method: 'POST', path: '/', permission: 'createPatient' },
  ],
};
