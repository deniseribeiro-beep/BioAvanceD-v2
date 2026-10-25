// RBAC gate pins for monitoring.routes.js (#1323). Format and proof:
// see incident.pins.js.
module.exports = {
  file: 'interface/routes/monitoring.routes.js',
  mount: '/api/monitoring',
  pins: [
    { method: 'GET', path: '/runs', roles: [4] },
  ],
};
