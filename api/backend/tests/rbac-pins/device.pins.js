// RBAC gate pins for device.routes.js (#1316). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/device.routes.js',
  mount: '/api/devices',
  pins: [
    { method: 'GET', path: '/', permission: 'viewEquipment' },
    { method: 'GET', path: '/:deviceId', permission: 'viewEquipment' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/:deviceId/events', permission: 'manageStorageTopology' },
  ],
};
