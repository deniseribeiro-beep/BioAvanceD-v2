const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const { resolveFileReference } = require('../../services/workflowRunFileLinker');
const auditLogger = require('../../utils/auditLogger');

// RF027 AC#3 (#716 slice 2/4): "Vincular arquivos de entrada e saída" --
// links an existing scientific file (already uploaded via sample/assay/
// dataset's own upload routes) to a WorkflowRun's inputFileIds/
// outputFileIds, rather than re-implementing upload/download/replace
// (createLinkedFileController's shape) -- a workflow run doesn't own new
// file bytes, it references files that already exist elsewhere.
const DIRECTIONS = ['input', 'output'];

function buildWorkflowRunQuery(rawId) {
  return {
    $or: [
      ...(ObjectId.isValid(rawId) ? [{ _id: new ObjectId(rawId) }] : []),
      { workflowRunId: rawId },
    ],
  };
}

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const workflowRun = await db.collection('workflowRuns').findOne(buildWorkflowRunQuery(String(req.params.workflowRunId)));
    if (!workflowRun) {
      return res.status(404).json({ success: false, error: 'workflowRunId não encontrado' });
    }

    return res.status(200).json({
      success: true,
      data: {
        inputFileIds: workflowRun.inputFileIds || [],
        outputFileIds: workflowRun.outputFileIds || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao listar arquivos vinculados', message: error.message });
  }
});

router.post('/', authenticate, requireRole(3, 4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { fileId, direction } = req.body || {};

    if (!DIRECTIONS.includes(direction)) {
      return res.status(422).json({ success: false, error: `direction deve ser um de: ${DIRECTIONS.join(', ')}`, details: [`direction deve ser um de: ${DIRECTIONS.join(', ')}`] });
    }
    if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') {
      return res.status(422).json({ success: false, error: 'fileId é obrigatório', details: ['fileId é obrigatório'] });
    }

    const workflowRun = await db.collection('workflowRuns').findOne(buildWorkflowRunQuery(String(req.params.workflowRunId)));
    if (!workflowRun) {
      return res.status(404).json({ success: false, error: 'workflowRunId não encontrado' });
    }

    const foundInCollection = await resolveFileReference(db, fileId);
    if (!foundInCollection) {
      return res.status(404).json({ success: false, error: `fileId ${fileId} não encontrado` });
    }

    const arrayField = direction === 'input' ? 'inputFileIds' : 'outputFileIds';
    await db.collection('workflowRuns').updateOne(
      { _id: workflowRun._id },
      { $addToSet: { [arrayField]: fileId }, $set: { updatedAt: new Date() } }
    );

    if (req.user) {
      auditLogger.init(db);
      await auditLogger.log({
        action: 'WORKFLOW_RUN_FILE_LINK',
        resourceType: 'WorkflowRun',
        resourceId: String(workflowRun.workflowRunId || workflowRun._id),
        status: 'success',
        severity: 'info',
        message: `Arquivo vinculado ao WorkflowRun (${direction}): ${fileId}`,
        payload: { fileId, direction, foundInCollection },
        req,
        module: 'Workflows',
      });
    }

    const updated = await db.collection('workflowRuns').findOne({ _id: workflowRun._id });
    return res.status(200).json({
      success: true,
      data: {
        inputFileIds: updated.inputFileIds || [],
        outputFileIds: updated.outputFileIds || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao vincular arquivo', message: error.message });
  }
});

module.exports = router;
