import { StorageAllocationService } from './StorageAllocationService';
import { logger } from '../utils/logger';
const PatientModel = require('../models/Patient');
const SampleModel = require('../models/Sample');
const PatientConsentModel = require('../models/PatientConsent');
import { Driver } from 'neo4j-driver';
import { InfluxDB, Point } from '@influxdata/influxdb-client';

export interface ImportDTO {
  identificador: string;
  nomePaciente: string;
  diagnostico?: string;
  tipoAmostra?: string;
  volume?: string;
  tipoImportacao: 'NOVO_CADASTRO' | 'ATUALIZACAO_AMOSTRA';
  tcleId?: string;
  tcleStatus?: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  aceitaGenetica?: boolean;
  aceitaPartilha?: boolean;
}

export interface ImportResult {
  successes: Array<{ identificador: string; message: string }>;
  errors: Array<{ identificador: string; error: string }>;
}

export class FhirImportService {
  constructor(
    private neo4jDriver: Driver,
    private influx: InfluxDB,
    private storageAllocationService: StorageAllocationService
  ) {}

  async importBatch(payload: ImportDTO[]): Promise<ImportResult> {
    const successes: ImportResult['successes'] = [];
    const errors: ImportResult['errors'] = [];
    
    // OTIMIZAÇÃO: Abrir conexão InfluxDB fora do loop para Batching Real
    const writeApi = this.influx.getWriteApi('default', 'consent_audit');

    for (const row of payload) {
      try {
        // =======================================
        // 1. MONGODB (Fonte de Verdade)
        // =======================================
        
        // CORREÇÃO: Uso de $setOnInsert para não perder o CPF em novos cadastros
        const patient = await PatientModel.findOneAndUpdate(
          { $or: [{ cpf: row.identificador }, { recordNumber: row.identificador }] },
          { 
            $set: { patientName: row.nomePaciente },
            $setOnInsert: { cpf: row.identificador, recordNumber: row.identificador } 
          },
          { upsert: true, new: true }
        );

        let consentDoc = null;

        // CORREÇÃO: Lógica para evitar a "Amnésia" de TCLE
        if (row.tcleId && row.tcleStatus) {
          // Cenário A: O TCLE vem no payload (Novo cadastro ou renovação)
          consentDoc = await PatientConsentModel.findOneAndUpdate(
            { patientId: patient.patientID, consentId: row.tcleId },
            {
              $set: {
                status: row.tcleStatus,
                allowsGenetics: row.aceitaGenetica,
                allowsSharing: row.aceitaPartilha,
              }
            },
            { upsert: true, new: true }
          );
        } else {
          // Cenário B: Amostra nova sem envio de TCLE. Procura no banco se há um ativo!
          consentDoc = await PatientConsentModel.findOne({ 
            patientId: patient.patientID, 
            status: 'ACTIVE' 
          });
        }

        // Upsert Sample
        let sampleDoc = null;
        let statusAmostra = 'QUARANTINED';
        
        if (row.tipoAmostra) {
          // A validação agora é 100% segura, baseada no payload ou histórico do banco
          const hasActiveConsent = consentDoc && consentDoc.status === 'ACTIVE';
          statusAmostra = hasActiveConsent ? 'AVAILABLE' : 'QUARANTINED';
          
          sampleDoc = await SampleModel.findOneAndUpdate(
            { patientID: patient.patientID, sampleType: row.tipoAmostra },
            {
              $set: {
                volume: row.volume,
                status: statusAmostra,
              }
            },
            { upsert: true, new: true }
          );
        }

        // =======================================
        // 2. NEO4J (Grafo de Conhecimento)
        // =======================================
        const session = this.neo4jDriver.session();
        try {
          const cypher: string[] = ['MERGE (p:Patient {id: $identificador})'];
          const params: any = { identificador: row.identificador };

          if (row.nomePaciente) {
            cypher.push('SET p.name = $nomePaciente');
            params.nomePaciente = row.nomePaciente;
          }

          if (consentDoc) {
            cypher.push('MERGE (c:Consent {id: $tcleId}) SET c.status = $tcleStatus, c.allowsGenetics = $aceitaGenetica, c.allowsSharing = $aceitaPartilha');
            cypher.push('MERGE (p)-[:SIGNED]->(c)');
            params.tcleId = consentDoc.consentId || consentDoc._id?.toString();
            params.tcleStatus = consentDoc.status;
            params.aceitaGenetica = consentDoc.allowsGenetics ?? false;
            params.aceitaPartilha = consentDoc.allowsSharing ?? false;
          }

          if (sampleDoc) {
            cypher.push('MERGE (s:Sample {id: $sampleId}) SET s.type = $tipoAmostra, s.status = $statusAmostra');
            cypher.push('MERGE (p)-[:DONATED]->(s)');
            
            // Só liga a amostra ao TCLE no grafo se o consentDoc existir
            if (consentDoc) {
              cypher.push('MERGE (s)-[:GOVERNED_BY]->(c)');
            }
            
            params.sampleId = sampleDoc._id?.toString();
            params.tipoAmostra = row.tipoAmostra;
            params.statusAmostra = statusAmostra;
          }
          
          await session.run(cypher.join(' '), params);
        } finally {
          await session.close();
        }

        // =======================================
        // 3. INFLUXDB (Auditoria Ética)
        // =======================================
        
        // Audita o TCLE apenas se ele foi enviado / alterado nesta requisição
        if (consentDoc && row.tcleStatus) { 
          const point = new Point('consent_audit')
            .tag('patient_id', row.identificador)
            .tag('action', consentDoc.status === 'ACTIVE' ? 'TCLE_ACCEPTED' : 'TCLE_REVOKED');
          point.intField('status_code', consentDoc.status === 'ACTIVE' ? 1 : 0);
          writeApi.writePoint(point); // Fica em fila na memória (super rápido)
        }

        if (sampleDoc) {
          const point = new Point('consent_audit')
            .tag('patient_id', row.identificador)
            .tag('action', statusAmostra === 'AVAILABLE' ? 'SAMPLE_AVAILABLE' : 'SAMPLE_QUARANTINED');
          point.intField('status_code', statusAmostra === 'AVAILABLE' ? 1 : 0);
          writeApi.writePoint(point);
        }

        // Após salvar a amostra como AVAILABLE, alocar fisicamente
        if (sampleDoc && statusAmostra === 'AVAILABLE') {
          try {
            await this.storageAllocationService.allocateSample(sampleDoc._id.toString(), row.tipoAmostra);
          } catch (allocErr) {
            const allocationErrorMessage =
              allocErr instanceof Error ? allocErr.message : String(allocErr);
            logger.error('[ALLOCATION_ERROR]', {
              sampleId: sampleDoc._id.toString(),
              error: allocationErrorMessage,
            });
          }
        }

        successes.push({ identificador: row.identificador, message: 'Importação bem-sucedida' });
      } catch (error: any) {
        logger.error('[IMPORT_ERROR]', { identificador: row.identificador, error: error.message || String(error), payload: row });
        errors.push({ identificador: row.identificador, error: error.message || String(error) });
      }
    }

    // OTIMIZAÇÃO: Fecha a conexão InfluxDB no final de tudo, descarregando (Flush) os pontos em rede de uma só vez
    try {
      await writeApi.close();
    } catch (influxErr) {
      logger.error('[INFLUX_FLUSH_ERROR]', influxErr);
    }

    return { successes, errors };
  }
}