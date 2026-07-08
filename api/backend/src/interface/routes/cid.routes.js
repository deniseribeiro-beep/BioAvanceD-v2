const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const cidController = require('../../controllers/cid.controller');
const logger = require('../../utils/logger');

function methodNotAllowed(res) {
	return res.status(405).json({
		success: false,
		error: 'Método não permitido',
		message: 'As rotas de CID estão em modo somente leitura nesta versão.'
	});
}

function normalizeBoolean(value, fallback = true) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value === 1;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (['true', '1', 'yes', 'sim', 'active', 'ativo'].includes(normalized)) return true;
		if (['false', '0', 'no', 'nao', 'inativo', 'inactive'].includes(normalized)) return false;
	}
	return fallback;
}

function normalizeCidDocument(document = {}) {
	return {
		_id: document._id,
		Capitulo: String(document.Capitulo || document.chapter || '').trim(),
		Codigo_Tabulacao: String(document.Codigo_Tabulacao || document.code || '').trim(),
		Descricao: String(document.Descricao || document.description || '').trim(),
		Codigos_CID10: String(document.Codigos_CID10 || document.cid10 || document.Codigo_Tabulacao || document.code || '').trim(),
		ORPHA: String(document.ORPHA || document.orpha || document.orphaCode || document.orpha_code || '').trim(),
		OMIM: String(document.OMIM || document.omim || document.omimCode || document.omim_code || '').trim(),
		active: normalizeBoolean(document.active ?? document.is_active, true),
		createdAt: document.createdAt,
		updatedAt: document.updatedAt
	};
}

router.get('/', authenticate, requireRole(4), async (req, res) => {
	try {
		const db = req.app.locals.db;
		if (!db) {
			return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
		}

		const collection = db.collection('cids');
		const items = await collection
			.find({})
			.sort({ Codigo_Tabulacao: 1, Codigos_CID10: 1, Descricao: 1 })
			.toArray();

		return res.status(200).json({
			success: true,
			data: items.map((item) => normalizeCidDocument(item))
		});
	} catch (error) {
		logger.error('Erro ao listar CIDs:', error.message);
		return res.status(500).json({
			success: false,
			error: 'Erro ao listar CIDs',
			message: error.message
		});
	}
});

router.get('/search', authenticate, cidController.search);

router.post('/', authenticate, requireRole(4), async (_req, res) => methodNotAllowed(res));

router.put('/:id', authenticate, requireRole(4), async (_req, res) => methodNotAllowed(res));

router.patch('/:id', authenticate, requireRole(4), async (_req, res) => methodNotAllowed(res));

module.exports = router;
