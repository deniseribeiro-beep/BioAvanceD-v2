// RBAC gate pins for shipment.js (#660). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'routes/shipment.js',
  mount: '/api/shipments',
  pins: [
    { method: 'POST', path: '/', roles: [3, 4] },
    { method: 'POST', path: '/:id/receive', roles: [3, 4] },
  ],
};
