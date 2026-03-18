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

    const alphaGalHighMax = this.governance.thresholds.alphaGal.highMax;
    const alphaGalMediumMax = this.governance.thresholds.alphaGal.mediumMax;

    if (alphaGal < alphaGalHighMax) {
      return {
        feature: 'alphaGal',
        value: alphaGal,
        unit: 'U/mL',
        direction: 'below_reference',
        ruleApplied: `alphaGal_lt_${alphaGalHighMax}`,
        severity: 'high',
        rationale: 'α-Galactosidase abaixo de 1.0 U/mL sugere forte sinal de deficiência enzimática e requer correlação clínica.'
      };
    }

    if (alphaGal < alphaGalMediumMax) {
      return {
        feature: 'alphaGal',
        value: alphaGal,
        unit: 'U/mL',
        direction: 'borderline_low',
        ruleApplied: `alphaGal_between_${alphaGalHighMax}_${alphaGalMediumMax}`,
        severity: 'medium',
        rationale: 'α-Galactosidase em faixa limítrofe baixa; recomenda-se acompanhamento seriado e análise contextual.'
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

    const lysoGb3MediumMin = this.governance.thresholds.lysoGb3.mediumMin;
    const lysoGb3HighMin = this.governance.thresholds.lysoGb3.highMin;

    if (lysoGb3 > lysoGb3HighMin) {
      return {
        feature: 'lysoGb3',
        value: lysoGb3,
        unit: 'ng/mL',
        direction: 'above_reference',
        ruleApplied: `lysoGb3_gt_${lysoGb3HighMin}`,
        severity: 'high',
        rationale: 'Lyso-GB3 elevado acima de 1.8 ng/mL é compatível com maior probabilidade de alteração metabólica relevante.'
      };
    }

    if (lysoGb3 >= lysoGb3MediumMin) {
      return {
        feature: 'lysoGb3',
        value: lysoGb3,
        unit: 'ng/mL',
        direction: 'borderline_high',
        ruleApplied: `lysoGb3_between_${lysoGb3MediumMin}_${lysoGb3HighMin}`,
        severity: 'medium',
        rationale: 'Lyso-GB3 em faixa limítrofe alta; acompanhar tendência temporal e sintomas associados.'
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
