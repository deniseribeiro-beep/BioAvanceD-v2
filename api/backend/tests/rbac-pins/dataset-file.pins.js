// RBAC gate pins for dataset-file.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/dataset-file.routes.js',
  mount: '/api/datasets/:datasetId/files',
  pins: [
    { method: 'POST', path: '/upload', roles: [3, 4] },
    { method: 'DELETE', path: '/:fileID', roles: [3, 4] },
    { method: 'PUT', path: '/:fileID/replace', roles: [3, 4] },
  ],
};
