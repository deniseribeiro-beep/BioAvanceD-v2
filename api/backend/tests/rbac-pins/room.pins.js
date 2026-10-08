// RBAC gate pins for room.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/room.routes.js',
  mount: '/api/rooms',
  pins: [
    { method: 'GET', path: '/', permission: 'viewStorageTopology' },
    { method: 'GET', path: '/:id', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'PUT', path: '/:id', permission: 'manageStorageTopology' },
    { method: 'DELETE', path: '/:id', permission: 'manageStorageTopology' },
  ],
};
