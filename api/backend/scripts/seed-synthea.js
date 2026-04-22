// Script para popular o banco de dados MongoDB com dados Synthea, respeitando a estrutura e regras do projeto
// Local: backend/scripts/seed-synthea.js

const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const PatientModel = require('../src/models/Patient');
const PatientConsentModel = require('../src/models/PatientConsent');
const SampleModel = require('../src/models/Sample');

// Função para gerar CPF válido (mock simples)
function gerarCPF() {
  const n = () => Math.floor(Math.random() * 9);
  let cpf = Array.from({ length: 9 }, n);
  const calcDV = (cpfArr, factor) => {
    let sum = cpfArr.reduce((acc, num, idx) => acc + num * (factor - idx), 0);
    let dv = 11 - (sum % 11);
    return dv > 9 ? 0 : dv;
  };
  cpf.push(calcDV(cpf, 10));
  cpf.push(calcDV(cpf, 11));
  return cpf.join('');
}

// Mock de doenças raras
const rareDiseases = [
  { icdCode: 'Q87.1', orphaCode: 'ORPHA:84', omimCode: 'OMIM:123456', diagnosticHypothesis: 'Síndrome de Marfan' },
  { icdCode: 'E75.2', orphaCode: 'ORPHA:792', omimCode: 'OMIM:607015', diagnosticHypothesis: 'Doença de Gaucher' },
  { icdCode: 'G12.2', orphaCode: 'ORPHA:79247', omimCode: 'OMIM:253300', diagnosticHypothesis: 'Atrofia muscular espinhal' },
];

// Traduz gênero para sex do modelo
function traduzirGenero(gender) {
  if (gender === 'male') return 'M';
  if (gender === 'female') return 'F';
  return 'O';
}

// Mock de consentimento granular
function consentimentoMock() {
  return {
    accepts_genetics: true,
    accepts_biobank: true,
    accepts_contact: Math.random() > 0.2,
    responses: {
      genetics: true,
      biobank: true,
      contact: Math.random() > 0.2
    },
    templateId: 'default-tcle-template',
    signedAt: new Date(),
    status: 'ACTIVE',
  };
}

// Gera patientID anonimizado de 8 dígitos
function gerarPatientID() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// Mock de amostras (apenas após consentimento)
function gerarAmostras(patientID) {
  const tipos = ['Sangue Total', 'Soro'];
  const n = Math.floor(Math.random() * 3) + 1;
  const amostras = [];
  for (let i = 0; i < n; i++) {
    amostras.push({
      patientID,
      sampleType: tipos[Math.floor(Math.random() * tipos.length)],
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'PADRAO',
      registerDate: new Date(),
      quantity: 2000,
      unit: 'µL',
      quality: 'GOOD',
      linkedProject: 'synthea-import',
      status: 'AVAILABLE',
    });
  }
  return amostras;
}

async function main() {
  await mongoose.connect('mongodb://localhost:27017/bioavanced', { useNewUrlParser: true, useUnifiedTopology: true });
  const fhirDir = path.join(__dirname, '../../data-synthea/output/fhir');
  const files = (await fs.readdir(fhirDir)).filter(f => f.endsWith('.json'));
  const chunkSize = 50;
  let totalPacientes = 0, totalAmostras = 0, totalTCLEs = 0;

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (file) => {
      try {
        const raw = await fs.readFile(path.join(fhirDir, file), 'utf-8');
        const fhir = JSON.parse(raw);
        // Demografia
        const patientName = fhir.name?.[0]?.given?.[0] + ' ' + (fhir.name?.[0]?.family || '');
        const birthDate = fhir.birthDate;
        const sex = traduzirGenero(fhir.gender);
        const recordNumber = fhir.id;
        // Geração aleatória de CPF e patientID a cada iteração
        const cpf = gerarCPF();
        const patientID = gerarPatientID();
        // Clínica: sempre sorteia uma doença rara se houver condição, senão saudável
        let clinica;
        if (fhir.condition && Array.isArray(fhir.condition) && fhir.condition.length > 0) {
          // Sorteia uma doença rara diferente para cada paciente
          clinica = { ...rareDiseases[Math.floor(Math.random() * rareDiseases.length)] };
        } else {
          clinica = { icdCode: '', orphaCode: '', omimCode: '', diagnosticHypothesis: 'Controlo Saudável' };
        }
        // Paciente
        const pacienteData = {
          patientID,
          patientName,
          birthDate,
          sex,
          cpf,
          recordNumber,
          ...clinica,
          consentTemplateId: 'default-tcle-template',
          email: `${patientID}@synthea.mock`,
        };
        const paciente = await PatientModel.create(pacienteData);
        await new PatientModel(paciente).save();
        totalPacientes++;
        // Consentimento: sempre novo mock a cada paciente
        const consentData = {
          patientId: patientID,
          ...consentimentoMock(),
        };
        const consent = await PatientConsentModel.create(consentData);
        await new PatientConsentModel(consent).save();
        totalTCLEs++;
        // Amostras: sempre novo mock a cada paciente
        const amostras = gerarAmostras(patientID);
        for (const amostraData of amostras) {
          const amostra = await SampleModel.create(amostraData);
          await new SampleModel(amostra).save();
          totalAmostras++;
        }
      } catch (err) {
        console.error(`Erro ao processar ${file}:`, err);
      }
    }));
  }
  console.log(`✅ Seed concluído: ${totalPacientes} pacientes, ${totalAmostras} amostras e ${totalTCLEs} TCLEs inseridos.`);
  await mongoose.disconnect();
}

main();
