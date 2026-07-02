import express from 'express';
import { FhirImportService } from '../services/FhirImportService';
import { getInfluxDB } from '../db/connection';
const router = express.Router();

const importService = new FhirImportService(getInfluxDB());

router.post('/import-fhir', async (req, res) => {
  const payload = req.body; // Array de ImportDTO
  const result = await importService.importBatch(payload);
  const status = result.errors.length > 0 ? 207 : 200;
  res.status(status).json(result);
});

export default router;
