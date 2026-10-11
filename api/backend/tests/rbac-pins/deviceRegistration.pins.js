// RBAC gate pins for deviceRegistration.routes.js (#1317). Format and
// proof: see incident.pins.js.
module.exports = {
  file: 'interface/routes/deviceRegistration.routes.js',
  mount: '/api/device-registrations',
  pins: [
    { method: 'GET', path: '/', permission: 'viewEquipment' },
    { method: 'GET', path: '/:deviceRegistrationId', permission: 'viewEquipment' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/:deviceRegistrationId/deactivate', permission: 'manageStorageTopology' },
  ],
};
