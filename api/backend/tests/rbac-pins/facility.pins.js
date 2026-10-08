// RBAC gate pins for facility.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/facility.routes.js',
  mount: '/api/facilities',
  pins: [
    { method: 'GET', path: '/', permission: 'viewStorageTopology' },
    { method: 'GET', path: '/:id', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'PUT', path: '/:id', permission: 'manageStorageTopology' },
    { method: 'DELETE', path: '/:id', permission: 'manageStorageTopology' },
  ],
};
