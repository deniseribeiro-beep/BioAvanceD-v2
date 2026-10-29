// RBAC gate pins for intakeWizard.routes.js (#1342). Format and proof: see
// incident.pins.js. A router.use gate is pinned with `use: true` and a probe
// route the gate covers.
module.exports = {
  file: 'interface/routes/intakeWizard.routes.js',
  mount: '/api/intake-wizard',
  pins: [
    { use: true, permission: 'createSample', probe: { method: 'GET', path: '/patient-match' } },
  ],
};
