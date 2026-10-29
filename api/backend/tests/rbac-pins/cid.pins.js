// RBAC gate pins for cid.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/cid.routes.js',
  mount: '/api/cids',
  pins: [
    { method: 'GET', path: '/', roles: [4] },
    { method: 'POST', path: '/', roles: [4] },
    { method: 'PUT', path: '/:id', roles: [4] },
    { method: 'PATCH', path: '/:id', roles: [4] },
  ],
};
