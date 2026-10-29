const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { walkWorkflowRunLineage } = require('../../services/workflowRunLineage');

// RF027 AC4 (#1322): "Preservar lineage fonte→ingestão→transformação→
// snapshot→resultado" -- the runs that produced a WorkflowRun's inputs and
// consumed its outputs, derived from shared file ids in inputFileIds/
// outputFileIds. Read-only, so like the file-link GET it needs a session
// and no role.
const router = express.Router({ mergeParams: true });

router.get('/', authenticate, async (req, res) => {
  try {
    const lineage = await walkWorkflowRunLineage(req.app.locals.db, String(req.params.workflowRunId));
    if (!lineage) {
      return res.status(404).json({ success: false, error: 'workflowRunId não encontrado' });
    }
    return res.status(200).json({ success: true, data: lineage });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao consultar a linhagem do WorkflowRun', message: error.message });
  }
});

module.exports = router;
