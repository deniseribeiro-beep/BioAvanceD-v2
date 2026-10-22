// RBAC gate pins for miabis-export.routes.js (#1322). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/miabis-export.routes.js',
  mount: '/api/biobanks/miabis',
  pins: [
    { method: 'GET', path: '/export', roles: [3, 4] },
  ],
};
