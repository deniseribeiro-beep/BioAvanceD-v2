// RBAC gate pins for analysis-type.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/analysis-type.routes.js',
  mount: '/api/analysis-types',
  pins: [
    { method: 'POST', path: '/', roles: [4] },
  ],
};
