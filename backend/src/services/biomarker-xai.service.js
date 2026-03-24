const env = require('../config/env');

class BiomarkerXaiService {
  constructor() {
    this.governance = {
      ruleVersion: String(env.BIOMARKER_XAI_RULE_VERSION || 'biomarker-rules-v1.1.0').trim(),
      owner: String(env.BIOMARKER_XAI_OWNER || 'Clinical Governance Board').trim(),
      clinicalApprover: String(env.BIOMARKER_XAI_CLINICAL_APPROVER || 'Pending clinical nomination').trim(),
      reviewCadenceDays: this.toPositiveInteger(env.BIOMARKER_XAI_REVIEW_CADENCE_DAYS, 90),
      lastApprovedAt: this.toDateOrNull(env.BIOMARKER_XAI_LAST_APPROVED_AT),
      thresholds: {
        alphaGal: {
          highMax: this.toNumberOrDefault(env.BIOMARKER_XAI_ALPHA_GAL_HIGH_MAX, 1.0),
          mediumMax: this.toNumberOrDefault(env.BIOMARKER_XAI_ALPHA_GAL_MEDIUM_MAX, 2.5)
        },
        lysoGb3: {
          mediumMin: this.toNumberOrDefault(env.BIOMARKER_XAI_LYSO_GB3_MEDIUM_MIN, 0.9),
          highMin: this.toNumberOrDefault(env.BIOMARKER_XAI_LYSO_GB3_HIGH_MIN, 1.8)
        }
      }
    };

    if (this.governance.thresholds.alphaGal.mediumMax < this.governance.thresholds.alphaGal.highMax) {
      this.governance.thresholds.alphaGal.mediumMax = this.governance.thresholds.alphaGal.highMax;
    }

    if (this.governance.thresholds.lysoGb3.highMin < this.governance.thresholds.lysoGb3.mediumMin) {
      this.governance.thresholds.lysoGb3.highMin = this.governance.thresholds.lysoGb3.mediumMin;
    }
  }

  verifyXaiThreshold(biomarker, value) {
    const xaiRuleHistory = [
      {
        biomarker: 'alphaGal',
        status: 'ACTIVE',
        version: this.governance.ruleVersion,
        direction: 'low',
        threshold: this.governance.thresholds.alphaGal.highMax,
        unit: 'U/mL',
        severity: 'high',
        justification: 'α-Galactosidase abaixo do limite ativo sugere forte sinal de deficiência enzimática e requer correlação clínica.'
      },
      {
        biomarker: 'alphaGal',
        status: 'ACTIVE',
        version: this.governance.ruleVersion,
        direction: 'range',
        threshold: {
          min: this.governance.thresholds.alphaGal.highMax,
          max: this.governance.thresholds.alphaGal.mediumMax
        },
        unit: 'U/mL',
        severity: 'medium',
        justification: 'α-Galactosidase em faixa limítrofe baixa; recomenda-se acompanhamento seriado e análise contextual.'
      },
      {
        biomarker: 'lysoGb3',
        status: 'ACTIVE',
        version: this.governance.ruleVersion,
        direction: 'high',
        threshold: this.governance.thresholds.lysoGb3.highMin,
        unit: 'ng/mL',
        severity: 'high',
        justification: 'Lyso-GB3 acima do limite ativo sugere maior probabilidade de alteração metabólica relevante.'
      }
      ,
      {
        biomarker: 'lysoGb3',
        status: 'ACTIVE',
        version: this.governance.ruleVersion,
        direction: 'range',
        threshold: {
          min: this.governance.thresholds.lysoGb3.mediumMin,
          max: this.governance.thresholds.lysoGb3.highMin
        },
        unit: 'ng/mL',
        severity: 'medium',
        justification: 'Lyso-GB3 em faixa limítrofe alta; acompanhar tendência temporal e sintomas associados.'
      }
    ];

    const normalizedBiomarker = String(biomarker || '').trim();
    const numericValue = Number(value);

    if (!normalizedBiomarker || !Number.isFinite(numericValue)) {
      return null;
    }

    const activeRules = xaiRuleHistory.filter(
      (rule) => rule.biomarker === normalizedBiomarker && rule.status === 'ACTIVE'
    );

    if (activeRules.length === 0) {
      return null;
    }

    const matchedRule = activeRules.find((rule) => {
      if (rule.direction === 'low') {
        return numericValue < rule.threshold;
      }

      if (rule.direction === 'high') {
        return numericValue > rule.threshold;
      }

      if (rule.direction === 'range') {
        return numericValue >= rule.threshold.min && numericValue < rule.threshold.max;
      }

      return false;
    });

    if (!matchedRule) {
      return null;
    }

    return {
      ruleVersion: matchedRule.version,
      severity: matchedRule.severity,
      justification: `${matchedRule.justification} Valor informado: ${numericValue} ${matchedRule.unit}. ${matchedRule.direction === 'range'
        ? `Faixa ativa: ${matchedRule.threshold.min} a ${matchedRule.threshold.max} ${matchedRule.unit}.`
        : `Limite ativo: ${matchedRule.direction === 'low' ? 'menor que' : 'maior que'} ${matchedRule.threshold} ${matchedRule.unit}.`}`
    };
  }

  toNumberOrDefault(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  toPositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.round(parsed);
  }

  toDateOrNull(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  toNumeric(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  evaluateAlphaGal(alphaGal) {
    if (alphaGal === null) return null;

    const xaiAlert = this.verifyXaiThreshold('alphaGal', alphaGal);
    if (xaiAlert) {
      const isMedium = xaiAlert.severity === 'medium';
      return {
        feature: 'alphaGal',
        value: alphaGal,
        unit: 'U/mL',
        direction: isMedium ? 'borderline_low' : 'below_reference',
        ruleApplied: isMedium
          ? `alphaGal_between_${this.governance.thresholds.alphaGal.highMax}_${this.governance.thresholds.alphaGal.mediumMax}`
          : `alphaGal_lt_${this.governance.thresholds.alphaGal.highMax}`,
        severity: xaiAlert.severity,
        rationale: xaiAlert.justification,
        xaiAlert
      };
    }

    return {
      feature: 'alphaGal',
      value: alphaGal,
      unit: 'U/mL',
      direction: 'within_reference',
      ruleApplied: 'alphaGal_ge_2_5',
      severity: 'low',
      rationale: 'α-Galactosidase dentro da faixa de referência definida por regra local.'
    };
  }

  evaluateLysoGb3(lysoGb3) {
    if (lysoGb3 === null) return null;

    const xaiAlert = this.verifyXaiThreshold('lysoGb3', lysoGb3);
    if (xaiAlert) {
      const isMedium = xaiAlert.severity === 'medium';
      return {
        feature: 'lysoGb3',
        value: lysoGb3,
        unit: 'ng/mL',
        direction: isMedium ? 'borderline_high' : 'above_reference',
        ruleApplied: isMedium
          ? `lysoGb3_between_${this.governance.thresholds.lysoGb3.mediumMin}_${this.governance.thresholds.lysoGb3.highMin}`
          : `lysoGb3_gt_${this.governance.thresholds.lysoGb3.highMin}`,
        severity: xaiAlert.severity,
        rationale: xaiAlert.justification,
        xaiAlert
      };
    }

    return {
      feature: 'lysoGb3',
      value: lysoGb3,
      unit: 'ng/mL',
      direction: 'within_reference',
      ruleApplied: 'lysoGb3_lt_0_9',
      severity: 'low',
      rationale: 'Lyso-GB3 dentro da faixa de referência definida por regra local.'
    };
  }

  buildSummary(evidenceList = []) {
    const hasHigh = evidenceList.some((item) => item.severity === 'high');
    const hasMedium = evidenceList.some((item) => item.severity === 'medium');

    if (hasHigh) {
      return 'Sinal laboratorial de maior criticidade detectado por regra determinística. Recomenda-se revisão clínica prioritária.';
    }

    if (hasMedium) {
      return 'Sinal laboratorial limítrofe detectado. Recomenda-se monitoramento longitudinal e correlação clínica.';
    }

    return 'Sem sinais laboratoriais críticos nas regras locais aplicadas para os biomarcadores informados.';
  }

  buildRecommendation(evidenceList = []) {
    const highSignals = evidenceList.filter((item) => item.severity === 'high');
    if (highSignals.length > 0) {
      return 'Priorizar reavaliação clínica, confirmar metodologia laboratorial e manter rastreio seriado de biomarcadores.';
    }

    if (evidenceList.some((item) => item.severity === 'medium')) {
      return 'Manter acompanhamento seriado e revisar histórico clínico para decisão multiprofissional.';
    }

    return 'Manter rotina de monitoramento conforme protocolo assistencial vigente.';
  }

  resolveNextReviewDate(generatedAt) {
    const baseDate = this.governance.lastApprovedAt || generatedAt;
    const nextReviewDate = new Date(baseDate);
    nextReviewDate.setDate(nextReviewDate.getDate() + this.governance.reviewCadenceDays);
    return nextReviewDate;
  }

  evaluate(patient = {}) {
    const alphaGal = this.toNumeric(patient.alphaGal);
    const lysoGb3 = this.toNumeric(patient.lysoGb3);

    if (alphaGal === null && lysoGb3 === null) {
      return null;
    }

    const evidence = [
      this.evaluateAlphaGal(alphaGal),
      this.evaluateLysoGb3(lysoGb3)
    ].filter(Boolean);

    const confidence = evidence.length >= 2 ? 0.9 : 0.75;

    const generatedAt = new Date();

    return {
      version: this.governance.ruleVersion,
      generatedAt,
      confidence,
      modelType: 'rule-based',
      isClinicalDiagnosis: false,
      disclaimer: 'Este resultado é suporte explicável baseado em regras e não substitui decisão médica.',
      governance: {
        owner: this.governance.owner,
        clinicalApprover: this.governance.clinicalApprover,
        reviewCadenceDays: this.governance.reviewCadenceDays,
        lastApprovedAt: this.governance.lastApprovedAt,
        nextReviewDueAt: this.resolveNextReviewDate(generatedAt),
        thresholds: this.governance.thresholds,
        source: 'documents/P1-6_XAI_GOVERNANCE.md'
      },
      evidence,
      summary: this.buildSummary(evidence),
      recommendation: this.buildRecommendation(evidence)
    };
  }
}

module.exports = new BiomarkerXaiService();
