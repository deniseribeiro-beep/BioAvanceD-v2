// RBAC gate pins for storage.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/storage.routes.js',
  mount: '/api/storage',
  pins: [
    { method: 'POST', path: '/allocate', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/allocate/auto', permission: 'manageStorageAllocation' },
    { method: 'POST', path: '/move', permission: 'manageStorageAllocation' },
    { method: 'DELETE', path: '/release/:sampleId', permission: 'manageStorageAllocation' },
    { method: 'PATCH', path: '/freezer/:freezerId/room', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/topology/containers', permission: 'manageStorageTopology' },
    { method: 'POST', path: '/topology/boxes', permission: 'manageStorageTopology' },
  ],
};
