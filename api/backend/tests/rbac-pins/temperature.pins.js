// RBAC gate pins for temperature.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/temperature.routes.js',
  mount: '/api/temperature',
  pins: [
    { method: 'POST', path: '/reading', permission: 'recordTemperature' },
    { method: 'GET', path: '/history', permission: 'viewTemperature' },
    { method: 'GET', path: '/alerts', permission: 'viewTemperature' },
    { method: 'GET', path: '/', permission: 'viewTemperature' },
    { method: 'GET', path: '/control', permission: 'viewTemperature' },
    { method: 'GET', path: '/:id', permission: 'viewTemperature' },
  ],
};
