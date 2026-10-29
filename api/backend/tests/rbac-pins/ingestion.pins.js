// RBAC gate pins for ingestion.routes.js (#1318). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/ingestion.routes.js',
  mount: '/api/ingestion',
  pins: [
    { method: 'POST', path: '/records', roles: [3, 4] },
  ],
};
