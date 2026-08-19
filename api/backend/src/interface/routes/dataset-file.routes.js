const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const createLinkedFileController = require('../../controllers/createLinkedFileController');

// #643 (RF007 AC#6/gate F3-G05): scientific-file linkage for Dataset,
// mounted at /api/datasets/:datasetId/files/.... Dataset has no
// organization/laboratory field in dict-02 (ELM-0416..0423), unlike Assay's
// laboratoryId -- no org-scope check applies here, matching Dataset's own
// entity exposure (createMasterDataRouter, no requireOrganizationScope).
const router = express.Router({ mergeParams: true });

const controller = createLinkedFileController({
  parentCollectionName: 'datasets',
  parentIdParam: 'datasetId',
  parentIdField: 'datasetId',
  fileCollectionName: 'datasetFiles',
  storageSubdir: 'datasets',
  resourceType: 'DatasetFile',
  moduleLabel: 'Datasets'
});

router.post('/upload', authenticate, requireRole(3, 4), controller.uploadMiddleware(), controller.uploadFile);
router.get('/', authenticate, controller.listFiles);
router.get('/:fileID/download', authenticate, controller.downloadFile);
router.delete('/:fileID', authenticate, requireRole(3, 4), controller.deleteFile);
router.put('/:fileID/replace', authenticate, requireRole(3, 4), controller.uploadMiddleware(), controller.replaceFile);

module.exports = router;
