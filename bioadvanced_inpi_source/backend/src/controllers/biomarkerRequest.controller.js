
const BiomarkerRequestModel = require('../models/BiomarkerRequest');

module.exports = {

  async create(req, res) {
    try {
      const db = req.app.locals.db;
      const id = await BiomarkerRequestModel.create(db, req.body);
      res.status(201).json({ success: true, id });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },


  async listPending(req, res) {
    try {
      const db = req.app.locals.db;
      const requests = await BiomarkerRequestModel.listPending(db);
      res.json({ success: true, requests });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },


  async approve(req, res) {
    try {
      const db = req.app.locals.db;
      const { id } = req.params;
      const { reviewer, comment } = req.body;
      await BiomarkerRequestModel.approve(db, id, reviewer, comment);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },


  async reject(req, res) {
    try {
      const db = req.app.locals.db;
      const { id } = req.params;
      const { reviewer, comment } = req.body;
      await BiomarkerRequestModel.reject(db, id, reviewer, comment);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};
