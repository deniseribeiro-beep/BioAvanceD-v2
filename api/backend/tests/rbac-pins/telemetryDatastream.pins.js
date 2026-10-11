// RBAC gate pins for telemetryDatastream.routes.js (#1317). Format and
// proof: see incident.pins.js.
module.exports = {
  file: 'interface/routes/telemetryDatastream.routes.js',
  mount: '/api/telemetry-datastreams',
  pins: [
    { method: 'GET', path: '/', permission: 'viewEquipment' },
    { method: 'GET', path: '/:telemetryDatastreamId', permission: 'viewEquipment' },
    { method: 'POST', path: '/', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/:telemetryDatastreamId/end', permission: 'manageStorageTopology' },
  ],
};
