# Implementação HL7 - Health Level Seven

## ✅ Resumo da Implementação

Esta implementação adiciona suporte completo a padrões HL7 para interoperabilidade em saúde ao módulo de arquivos de análise do BioAdvanceD.

---

## 📦 O que foi implementado

### **1. Modelo de Dados (Backend)**
- ✅ Extensão do modelo `SampleFile` com campos HL7 opcionais:
  - `accessionNumber` - Número de acesso do exame
  - `orderNumber` - Número da requisição
  - `loincCode` - Código LOINC do procedimento
  - `collectionDateTime` - Data/hora da coleta
  - `processingDateTime` - Data/hora do processamento
  - `analysisDateTime` - Data/hora da análise
  - `resultStatus` - Status (Final/Preliminar/Cancelado)
  - `unitOfMeasure` - Unidade de medida
  - `resultValue` - Valor numérico do resultado
  - `interpretation` - Interpretação (Normal/Anormal/Crítico)
  - E outros metadados de equipamento e HL7

**Arquivo:** `backend/src/models/SampleFile.js`

---

### **2. Serviços de Geração HL7**

#### **HL7 Service (`backend/src/services/hl7.service.js`)**
- ✅ **HL7 v2.x** - Geração de mensagens pipe-delimited com segmentos:
  - MSH (Message Header)
  - PID (Patient Identification - apenas patientID anonimizado)
  - SPM (Specimen)
  - OBR (Observation Request)
  - OBX (Observation/Result)

- ✅ **FHIR R4** - Geração de Bundle JSON com recursos:
  - DiagnosticReport
  - Observation
  - Specimen
  - Referência ao arquivo Binary

- ✅ **CDA** - Geração de documento XML CDA (Clinical Document Architecture) conforme HL7 CDA Release 2.0

---

### **3. Endpoints de Exportação**

Todos os endpoints exigem autenticação e estão disponíveis para **todos os perfis** (não contêm dados sensíveis, apenas patientID anonimizado):

- ✅ `GET /api/samples/:sampleID/files/:fileID/export/hl7` - Exporta em HL7 v2.x
- ✅ `GET /api/samples/:sampleID/files/:fileID/export/fhir` - Exporta em FHIR R4 JSON
- ✅ `GET /api/samples/:sampleID/files/:fileID/export/cda` - Exporta em CDA XML

**Arquivos:** 
- `backend/src/controllers/sample-file.controller.js` (métodos: `exportHL7v2`, `exportFHIR`, `exportCDA`)
- `backend/src/routes/sample.routes.js` (rotas adicionadas)

---

### **4. Interface Frontend**

#### **Componente SampleFilesSection**
- ✅ Menu dropdown de exportação para cada arquivo
- ✅ Opções: HL7 v2.x, FHIR JSON, CDA XML
- ✅ Download automático dos arquivos gerados
- ✅ Indicadores de carregamento durante exportação

**Arquivos:**
- `src/components/SampleFilesSection.tsx` (atualizado)
- `src/types/models.ts` (interface SampleFile estendida)
- `src/services/api.ts` (métodos de exportação)
- `src/hooks/useSampleFiles.ts` (hooks de exportação)

---

### **5. Auditoria LGPD**

✅ Todos os eventos de exportação são registrados nos logs com:
- Ação: `file_export_hl7`, `file_export_fhir`, `file_export_cda`
- Severidade: `medium`
- Payload: fileName, fileType, sampleID, exportFormat
- **Nenhum dado sensível** (apenas patientID anonimizado)

**Arquivo:** `backend/src/controllers/sample-file.controller.js`

---

### **6. Traduções (i18n)**

✅ Traduções adicionadas em PT e EN:

- `sampleFiles.export` - "Exportar" / "Export"
- `sampleFiles.exportHL7` - "HL7 v2.x"
- `sampleFiles.exportFHIR` - "FHIR JSON"
- `sampleFiles.exportCDA` - "CDA XML"
- `sampleFiles.exportError` - Mensagens de erro
- `sampleFiles.exportSuccess` - Mensagens de sucesso

**Arquivos:**
- `src/i18n/pt-BR.json`
- `src/i18n/en-US.json`

---

## 🔒 Conformidade LGPD

✅ **Apenas dados anonimizados são exportados:**
- Apenas `patientID` (8 dígitos numéricos) é incluído
- **Nenhum** dado pessoal (nome, data de nascimento, etc.)
- Uploader identificado por `userAnonId` anonimizado
- Logs não contêm informações sensíveis

---

## 🎯 Formatos Suportados

### **HL7 v2.x**
- Formato: Texto pipe-delimited (`|`)
- Extensão: `.hl7`
- Padrão: HL7 v2.8
- Mensagem: ORU^R01 (Observation Result - Unsolicited)

### **FHIR R4**
- Formato: JSON
- Extensão: `.json`
- Padrão: FHIR R4 (Fast Healthcare Interoperability Resources)
- Bundle contendo: DiagnosticReport, Observation, Specimen

### **CDA**
- Formato: XML
- Extensão: `.xml`
- Padrão: HL7 CDA Release 2.0
- Documento estruturado com header e seções clínicas

---

## 📝 Uso

### **Backend**
```javascript
// Exemplo de uso no controller
const hl7Service = require('../services/hl7.service');

// Gerar HL7 v2.x
const hl7Message = await hl7Service.generateHL7v2Message(db, sampleFile, sample, patientID);

// Gerar FHIR
const fhirBundle = await hl7Service.generateFHIRResource(db, sampleFile, sample, patientID);

// Gerar CDA
const cdaDocument = await hl7Service.generateCDA(db, sampleFile, sample, patientID);
```

### **Frontend**
```typescript
// No componente SampleFilesSection
const { exportHL7v2, exportFHIR, exportCDA } = useSampleFiles(sampleID);

// Exportar arquivo
await exportHL7v2(file._id);
await exportFHIR(file._id);
await exportCDA(file._id);
```

---

## ✅ Testes Recomendados

1. ✅ **Validação de campos HL7** - Campos opcionais não quebram funcionalidade existente
2. ✅ **Geração HL7 v2.x** - Mensagem formatada corretamente
3. ✅ **Geração FHIR** - Bundle JSON válido
4. ✅ **Geração CDA** - XML válido e bem formado
5. ✅ **Download de arquivos** - Arquivos baixados corretamente
6. ✅ **Traduções PT/EN** - Interface traduzida
7. ✅ **Logs de auditoria** - Eventos registrados corretamente
8. ✅ **LGPD** - Nenhum dado sensível exposto

---

## 🚀 Próximos Passos (Opcional)

Para implementação futura, considere:

1. **Interface de edição de metadados HL7** - Permitir que Admin/Coordenador preencha campos HL7 ao fazer upload
2. **Validação LOINC** - Validar códigos LOINC contra base de dados oficial
3. **Importação HL7** - Receber e processar mensagens HL7 de sistemas externos
4. **Webhook para exportações** - Notificar sistemas externos sobre novas exportações
5. **Mapeamento de códigos** - Interface para mapear códigos locais para LOINC/SNOMED

---

## 📚 Documentação Relacionada

- `HL7_COMPATIBILIDADE.md` - Análise de compatibilidade HL7
- `backend/src/services/hl7.service.js` - Implementação dos serviços
- `backend/src/controllers/sample-file.controller.js` - Endpoints de exportação

---

**Implementação concluída e pronta para uso!** ✅



