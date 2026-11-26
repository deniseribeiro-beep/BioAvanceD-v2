// RBAC gate pins for product-legal.routes.js (G13). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/product-legal.routes.js',
  mount: '/api/product-legal',
  pins: [
    { method: 'PUT', path: '/documents/:docType/publish', roles: [4] },
  ],
};
