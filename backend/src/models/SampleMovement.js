/**
 * Modelo de Movimentação de Amostras (Ledger Imutável)
 * 
 * Este modelo armazena o histórico completo de retiradas e devoluções
 * de amostras biológicas, garantindo rastreabilidade e auditoria.
 * 
 * Requisitos atendidos:
 * - Histórico imutável de movimentações
 * - Controle de custódia
 * - Conformidade com boas práticas laboratoriais
 */

class SampleMovementModel {
  static MOVEMENT_TYPES = {
    WITHDRAW: 'withdraw',      // Retirada
    RETURN: 'return',          // Devolução
    ADJUST: 'adjust',          // Ajuste administrativo
    MOVE: 'move'               // Movimentação física entre posições
  };

  static RETURN_CONDITIONS = {
    INTACT: 'Íntegra',
    PARTIALLY_COMPROMISED: 'Parcialmente comprometida',
    UNUSABLE: 'Inutilizada'
  };

  static validate(data) {
    const errors = [];

    // Campos obrigatórios
    if (!data.sampleID) {
      errors.push('sampleID é obrigatório');
    }

    if (!data.type || !Object.values(this.MOVEMENT_TYPES).includes(data.type)) {
      errors.push('type deve ser: withdraw, return, adjust ou move');
    }

    if (!data.quantity || typeof data.quantity !== 'number' || data.quantity <= 0) {
      errors.push('quantity deve ser um número maior que zero');
    }

    if (!data.responsible || typeof data.responsible !== 'string' || data.responsible.trim().length < 3) {
      errors.push('responsible é obrigatório (mínimo 3 caracteres)');
    }

    // Validações específicas por tipo
    if (data.type === 'withdraw') {
      if (!data.destination || typeof data.destination !== 'string') {
        errors.push('destination é obrigatório para retirada');
      }
      if (!data.purpose || typeof data.purpose !== 'string') {
        errors.push('purpose (finalidade) é obrigatório para retirada');
      }
    }

    if (data.type === 'return') {
      if (!data.condition || !Object.values(this.RETURN_CONDITIONS).includes(data.condition)) {
        errors.push('condition deve ser: Íntegra, Parcialmente comprometida ou Inutilizada');
      }
      // Observações obrigatórias se condição não for íntegra
      if (data.condition !== 'Íntegra' && (!data.observations || data.observations.trim() === '')) {
        errors.push('observations é obrigatório quando a condição não é Íntegra');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const now = new Date();
    
    return {
      // Identificação
      movementID: data.movementID || null, // Será gerado automaticamente se não fornecido
      sampleID: data.sampleID,
      barcode: data.barcode || null,
      
      // Tipo e quantidade
      type: data.type, // withdraw | return | adjust
      quantity: data.quantity,
      unit: data.unit || 'µL',
      
      // Responsável
      responsible: data.responsible,
      
      // Dados específicos de retirada
      destination: data.destination || null,
      purpose: data.purpose || null,       // Finalidade
      linkedProject: data.linkedProject || null,
      
      // Dados específicos de devolução
      condition: data.condition || null,   // Condição da amostra
      relatedWithdrawalID: data.relatedWithdrawalID || null, // Referência à retirada original
      
      // Observações e justificativas
      observations: data.observations || null,
      
      // Auditoria
      userId: data.userId || null,
      userName: data.userName || null,
      userRole: data.userRole || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      
      // Saldos (snapshot no momento da operação)
      previousQuantity: data.previousQuantity || null,  // Saldo antes
      newQuantity: data.newQuantity || null,            // Saldo depois
      
      // Timestamps
      timestamp: data.timestamp || now,
      createdAt: now,
      
      // Flag de imutabilidade (para auditoria)
      immutable: true
    };
  }

  /**
   * Gera ID único para movimentação
   */
  static async generateMovementID(db) {
    try {
      const countersCollection = db.collection('counters');
      const counter = await countersCollection.findOneAndUpdate(
        { _id: 'sample_movements' },
        {
          $inc: { seq: 1 },
          $setOnInsert: { createdAt: new Date() }
        },
        {
          upsert: true,
          returnDocument: 'after'
        }
      );

      if (counter?.value?.seq) {
        return counter.value.seq;
      }
    } catch (_) {
      // fallback para compatibilidade com ambientes de teste/mocks
    }

    const collection = db.collection('sample_movements');
    const lastMovement = await collection
      .find({})
      .sort({ movementID: -1 })
      .limit(1)
      .toArray();

    const lastID = lastMovement.length > 0 && lastMovement[0].movementID
      ? lastMovement[0].movementID
      : 0;

    return lastID + 1;
  }
}

module.exports = SampleMovementModel;
