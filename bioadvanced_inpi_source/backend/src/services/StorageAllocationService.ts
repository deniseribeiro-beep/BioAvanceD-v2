import neo4j, { Driver, Session } from 'neo4j-driver';
import { Db, ObjectId } from 'mongodb';

export interface StorageAllocationResult {
  sampleId: string;
  equipmentId: string;
  boxId: string;
  coordinate: string;
  equipmentLabel: string;
  boxLabel: string;
}

export class StorageAllocationService {
  private neo4jDriver: Driver;
  private mongoDb: Db;

  constructor(neo4jDriver: Driver, mongoDb: Db) {
    this.neo4jDriver = neo4jDriver;
    this.mongoDb = mongoDb;
  }

  /**
   * Aloca uma amostra em um equipamento e posição disponíveis, atualizando MongoDB e Neo4j.
   * @param sampleId ID da amostra
   * @param tipoAmostra Tipo da amostra (ex: Sangue Total, Soro, DNA)
   */
  async allocateSample(sampleId: string, tipoAmostra: string): Promise<StorageAllocationResult> {
    const session: Session = this.neo4jDriver.session();
    try {
      // 1. Buscar equipamento correto
      let equipmentType = '';
      if (status === 'QUARANTINED') {
        equipmentType = 'Quarantine Freezer';
      } else if (status === 'AVAILABLE') {
        equipmentType = this.getEquipmentTypeForSample(tipoAmostra);
      } else {
        equipmentType = this.getEquipmentTypeForSample(tipoAmostra);
      }
      const equipmentResult = await session.run(
        `MATCH (e:Equipment {type: $equipmentType, status: 'ACTIVE'})-[:CONTAINS]->(b:Box)
         RETURN e, b ORDER BY b.label ASC`,
        { equipmentType }
      );
      if (equipmentResult.records.length === 0) {
        throw new Error('Nenhum equipamento ativo encontrado para o tipo de amostra.');
      }
      // 2. Encontrar a primeira caixa não cheia e posição livre
      let chosenBox = null;
      let freeCoordinate = '';
      let equipmentNode = null;
      for (const rec of equipmentResult.records) {
        const box = rec.get('b').properties;
        const equipment = rec.get('e').properties;
        // Buscar posições ocupadas
        const boxId = box.id;
        const boxLabel = box.label;
        const gridRows = box.rows || 9;
        const gridCols = box.cols || 9;
        const occupiedResult = await session.run(
          `MATCH (b:Box {id: $boxId})<-[:STORED_IN]-(s:Sample)-[r:STORED_IN]->(b)
           RETURN r.position AS position`,
          { boxId }
        );
        const occupied = new Set<string>();
        for (const occ of occupiedResult.records) {
          occupied.add(occ.get('position'));
        }
        // Gerar grid e encontrar posição livre
        outer: for (let row = 0; row < gridRows; row++) {
          for (let col = 1; col <= gridCols; col++) {
            const coord = String.fromCharCode(65 + row) + col; // A1, A2, ..., I9
            if (!occupied.has(coord)) {
              chosenBox = box;
              equipmentNode = equipment;
              freeCoordinate = coord;
              break outer;
            }
          }
        }
        if (chosenBox) break;
      }
      if (!chosenBox || !freeCoordinate) {
        throw new Error('Nenhuma posição livre encontrada nas caixas.');
      }
      // 3. Efetivar alocação no Neo4j
      await session.run(
        `MERGE (s:Sample {id: $sampleId})
         MERGE (b:Box {id: $boxId})
         MERGE (s)-[:STORED_IN {position: $coordinate}]->(b)`,
        { sampleId, boxId: chosenBox.id, coordinate: freeCoordinate }
      );
      // 4. Atualizar MongoDB
      const samples = this.mongoDb.collection('samples');
      await samples.updateOne(
        { _id: new ObjectId(sampleId) },
        { $set: {
            location: {
              equipmentId: equipmentNode.id,
              boxId: chosenBox.id,
              coordinate: freeCoordinate,
              equipmentLabel: equipmentNode.label,
              boxLabel: chosenBox.label
            }
          }
        }
      );
      // 5. Retornar DTO para etiqueta
      return {
        sampleId,
        equipmentId: equipmentNode.id,
        boxId: chosenBox.id,
        coordinate: freeCoordinate,
        equipmentLabel: equipmentNode.label,
        boxLabel: chosenBox.label
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Define o tipo de equipamento ideal para cada tipo de amostra.
   */
  private getEquipmentTypeForSample(tipoAmostra: string): string {
    switch (tipoAmostra.toLowerCase()) {
      case 'dna':
        return '-80C Freezer';
      case 'soro':
      case 'plasma':
        return '-20C Freezer';
      case 'sangue total':
        return 'Refrigerator';
      default:
        return '-80C Freezer';
    }
  }
}
