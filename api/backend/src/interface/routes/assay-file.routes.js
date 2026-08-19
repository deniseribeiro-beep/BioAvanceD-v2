const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const createLinkedFileController = require('../../controllers/createLinkedFileController');

// #643 (RF007 AC#6/gate F3-G05): scientific-file linkage for Assay,
// mirroring sample.routes.js's file sub-routes but mounted at
// /api/assays/:assayId/files/... -- gated the same way Assay's own
// create/update/delete already is (requireRole(3,4), the
// createMasterDataRouter precedent #641 used), not a new permission code.
const router = express.Router({ mergeParams: true });

const controller = createLinkedFileController({
  parentCollectionName: 'assays',
  parentIdParam: 'assayId',
  parentIdField: 'assayId',
  fileCollectionName: 'assayFiles',
  storageSubdir: 'assays',
  resourceType: 'AssayFile',
  moduleLabel: 'Ensaios'
});

router.post('/upload', authenticate, requireRole(3, 4), controller.uploadMiddleware(), controller.uploadFile);
router.get('/', authenticate, controller.listFiles);
router.get('/:fileID/download', authenticate, controller.downloadFile);
router.delete('/:fileID', authenticate, requireRole(3, 4), controller.deleteFile);
router.put('/:fileID/replace', authenticate, requireRole(3, 4), controller.uploadMiddleware(), controller.replaceFile);

module.exports = router;
