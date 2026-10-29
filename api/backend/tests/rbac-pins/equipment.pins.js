// RBAC gate pins for equipment.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/equipment.routes.js',
  mount: '/api/equipment',
  pins: [
    { method: 'GET', path: '/', permission: 'viewEquipment' },
    { method: 'GET', path: '/analytical', permission: 'viewEquipment' },
    { method: 'GET', path: '/:id', permission: 'viewEquipment' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'PUT', path: '/:id', permission: 'manageStorageTopology' },
    { method: 'DELETE', path: '/:id', permission: 'manageStorageTopology' },
  ],
};
