// RBAC gate pins for sensor.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/sensor.routes.js',
  mount: '/api/sensors',
  pins: [
    { method: 'POST', path: '/', permission: 'manageSensor' },
    { method: 'GET', path: '/', permission: 'viewTemperature' },
    { method: 'GET', path: '/:id', permission: 'viewTemperature' },
    { method: 'PUT', path: '/:id', permission: 'manageSensor' },
    { method: 'DELETE', path: '/:id', permission: 'manageSensor' },
  ],
};
