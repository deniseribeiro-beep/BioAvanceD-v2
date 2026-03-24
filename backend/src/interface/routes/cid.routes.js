const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const cidController = require('../../controllers/cid.controller');
const logger = require('../../utils/logger');

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

function buildCidPayload(body = {}) {
	const codigoTabulacao = String(body.Codigo_Tabulacao || body.code || '').trim();
	const descricao = String(body.Descricao || body.description || '').trim();
	const codigosCid10 = String(body.Codigos_CID10 || body.cid10 || '').trim();
	const capitulo = String(body.Capitulo || body.chapter || '').trim();
	const orpha = String(body.ORPHA || body.orpha || body.orphaCode || body.orpha_code || '').trim();
	const omim = String(body.OMIM || body.omim || body.omimCode || body.omim_code || '').trim();

	return {
		Capitulo: capitulo,
		Codigo_Tabulacao: codigoTabulacao,
		Descricao: descricao,
		Codigos_CID10: codigosCid10,
		ORPHA: orpha,
		OMIM: omim,
		active: normalizeBoolean(body.active ?? body.is_active, true)
	};
}

function validateCidPayload(payload) {
	const errors = [];
	if (!payload.Codigo_Tabulacao) errors.push('Informe o código de tabulação.');
	if (!payload.Descricao) errors.push('Informe a descrição do CID.');
	if (!payload.Codigos_CID10) errors.push('Informe o código CID10.');
	return errors;
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

router.post('/', authenticate, requireRole(4), async (req, res) => {
	try {
		const db = req.app.locals.db;
		if (!db) {
			return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
		}

		const collection = db.collection('cids');
		const payload = buildCidPayload(req.body);
		const validationErrors = validateCidPayload(payload);

		if (validationErrors.length > 0) {
			return res.status(400).json({
				success: false,
				error: 'Dados inválidos',
				message: validationErrors.join(', ')
			});
		}

		const existing = await collection.findOne({ Codigo_Tabulacao: payload.Codigo_Tabulacao });
		if (existing) {
			return res.status(409).json({
				success: false,
				error: 'Código de tabulação já cadastrado',
				message: `Já existe um CID com o código ${payload.Codigo_Tabulacao}.`
			});
		}

		const now = new Date();
		const result = await collection.insertOne({
			...payload,
			active: true,
			is_active: true,
			createdAt: now,
			updatedAt: now
		});

		return res.status(201).json({
			success: true,
			message: 'CID criado com sucesso',
			data: normalizeCidDocument({ _id: result.insertedId, ...payload, active: true, is_active: true, createdAt: now, updatedAt: now })
		});
	} catch (error) {
		logger.error('Erro ao criar CID:', error.message);
		return res.status(500).json({
			success: false,
			error: 'Erro ao criar CID',
			message: error.message
		});
	}
});

router.put('/:id', authenticate, requireRole(4), async (req, res) => {
	try {
		const db = req.app.locals.db;
		if (!db) {
			return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
		}

		const collection = db.collection('cids');
		const { ObjectId } = require('mongodb');
		const cidId = req.params.id;
		const objectId = ObjectId.isValid(cidId) ? new ObjectId(cidId) : null;

		if (!objectId) {
			return res.status(400).json({ success: false, error: 'CID inválido' });
		}

		const payload = buildCidPayload(req.body);
		const validationErrors = validateCidPayload(payload);
		if (validationErrors.length > 0) {
			return res.status(400).json({
				success: false,
				error: 'Dados inválidos',
				message: validationErrors.join(', ')
			});
		}

		const current = await collection.findOne({ _id: objectId });
		if (!current) {
			return res.status(404).json({ success: false, error: 'CID não encontrado' });
		}

		const duplicate = await collection.findOne({
			Codigo_Tabulacao: payload.Codigo_Tabulacao,
			_id: { $ne: objectId }
		});
		if (duplicate) {
			return res.status(409).json({
				success: false,
				error: 'Código de tabulação já cadastrado',
				message: `Já existe um CID com o código ${payload.Codigo_Tabulacao}.`
			});
		}

		const now = new Date();
		await collection.updateOne(
			{ _id: objectId },
			{
				$set: {
					...payload,
					active: normalizeBoolean(req.body.active ?? req.body.is_active, true),
					is_active: normalizeBoolean(req.body.active ?? req.body.is_active, true),
					updatedAt: now
				}
			}
		);

		const updated = await collection.findOne({ _id: objectId });
		return res.status(200).json({
			success: true,
			message: 'CID atualizado com sucesso',
			data: normalizeCidDocument(updated)
		});
	} catch (error) {
		logger.error('Erro ao atualizar CID:', error.message);
		return res.status(500).json({
			success: false,
			error: 'Erro ao atualizar CID',
			message: error.message
		});
	}
});

router.patch('/:id', authenticate, requireRole(4), async (req, res) => {
	try {
		const db = req.app.locals.db;
		if (!db) {
			return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
		}

		const collection = db.collection('cids');
		const { ObjectId } = require('mongodb');
		const cidId = req.params.id;
		const objectId = ObjectId.isValid(cidId) ? new ObjectId(cidId) : null;

		if (!objectId) {
			return res.status(400).json({ success: false, error: 'CID inválido' });
		}

		const current = await collection.findOne({ _id: objectId });
		if (!current) {
			return res.status(404).json({ success: false, error: 'CID não encontrado' });
		}

		const active = normalizeBoolean(req.body.active ?? req.body.is_active, false);
		const now = new Date();
		await collection.updateOne(
			{ _id: objectId },
			{
				$set: {
					active,
					is_active: active,
					updatedAt: now
				}
			}
		);

		const updated = await collection.findOne({ _id: objectId });
		return res.status(200).json({
			success: true,
			message: active ? 'CID reativado com sucesso' : 'CID desativado com sucesso',
			data: normalizeCidDocument(updated)
		});
	} catch (error) {
		logger.error('Erro ao atualizar status do CID:', error.message);
		return res.status(500).json({
			success: false,
			error: 'Erro ao atualizar status do CID',
			message: error.message
		});
	}
});

module.exports = router;
