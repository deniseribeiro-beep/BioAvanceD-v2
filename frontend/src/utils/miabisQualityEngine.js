// MIABIS Quality Engine - calculateSampleQuality
// Recebe um objeto de amostra (sample + test) e retorna status, code e recommendation

function calculateSampleQuality(data) {
  const issues = [];
  let status = 'Optimal';
  let recommendation = 'Amostra adequada.';

  // CRÍTICO: Hemólise, Citrato underfilled, Heparina+PCR
  if (data.sample?.condition === 'Hemolyzed') {
    issues.push('Hemolysis detected');
  }
  if (data.test?.category === 'Coagulation' && data.sample?.fillStatus === 'Underfilled') {
    issues.push('Citrate tube underfilled');
  }
  if (data.sample?.additive === 'Heparin' && data.test?.type === 'PCR') {
    issues.push('Incompatible additive for PCR');
  }

  // ALERTA: Temperatura inadequada para Amônia/Lactato
  if ((data.test?.type?.includes('Ammonia') || data.test?.type?.includes('Lactate')) &&
      !(data.sample?.transportTemp === 'Refrigerated' || data.sample?.transportTemp === 'Ice')) {
    issues.push('Suboptimal transport temperature for unstable analyte');
  }

  if (
    issues.includes('Hemolysis detected') ||
    issues.includes('Citrate tube underfilled') ||
    issues.includes('Incompatible additive for PCR')
  ) {
    status = 'Compromised';
    recommendation = 'Amostra comprometida. Recoleta obrigatória.';
  } else if (issues.length > 0) {
    status = 'Suboptimal';
    recommendation = 'Amostra subótima. Avaliar restrições de uso.';
  }

  return {
    status, // 'Optimal', 'Suboptimal', 'Compromised'
    recommendation,
    reasons: issues,
  };
}

export default calculateSampleQuality;
