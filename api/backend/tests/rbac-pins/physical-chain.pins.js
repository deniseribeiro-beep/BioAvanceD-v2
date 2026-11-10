// RBAC gate pins for physical-chain.routes.js (#1314, #1316). Format and
// proof: see incident.pins.js.
module.exports = {
  file: 'interface/routes/physical-chain.routes.js',
  mount: '/api/physical-chain',
  pins: [
    { method: 'POST', path: '/custody', permission: 'manageCustody' },
    { method: 'POST', path: '/custody/:custodianshipAssignmentId/end', permission: 'manageCustody' },
    { method: 'GET', path: '/specimens/:specimenId/custody', permission: 'viewStorageTopology' },
    { method: 'GET', path: '/specimens/:specimenId/location', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/specimens/:specimenId/telemetry-exposure-summaries', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/containers', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/containers/:containerId/specimens', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/specimen-assignments/:specimenContainerAssignmentId/unload', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/containers/:containerId/position', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/position-assignments/:containerPositionAssignmentId/remove', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/locations', permission: 'manageStorageTopology' },
    { method: 'GET', path: '/locations', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/locations/:storageLocationId/status', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/containers/:containerId/labels', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/racks/:storageRackId/location', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/racks/:storageRackId/labels', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/rack-assignments/:rackLocationAssignmentId/remove', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/racks', permission: 'manageStorageTopology' },
    { method: 'GET', path: '/racks/:storageRackId/positions', permission: 'viewStorageTopology' },
    { method: 'POST', path: '/scan', permission: 'manageStorageAllocation' },
  ],
};
