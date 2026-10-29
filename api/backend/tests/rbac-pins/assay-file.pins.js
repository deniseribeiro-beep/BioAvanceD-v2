// RBAC gate pins for assay-file.routes.js (#1342). Format and proof: see
// incident.pins.js.
module.exports = {
  file: 'interface/routes/assay-file.routes.js',
  mount: '/api/assays/:assayId/files',
  pins: [
    { method: 'POST', path: '/upload', roles: [3, 4] },
    { method: 'DELETE', path: '/:fileID', roles: [3, 4] },
    { method: 'PUT', path: '/:fileID/replace', roles: [3, 4] },
  ],
};
