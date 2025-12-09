# Compatibilidade HL7 - Health Level Seven

## 📋 Sobre HL7

**HL7 (Health Level Seven)** é um conjunto de padrões internacionais para interoperabilidade em saúde, facilitando a troca de informações clínicas entre sistemas de saúde.

### Padrões HL7 Principais:
- **HL7 v2.x**: Padrão amplamente utilizado para integração de sistemas hospitalares
- **HL7 v3**: Versão mais recente com Modelo de Informação de Referência (RIM)
- **FHIR (Fast Healthcare Interoperability Resources)**: Padrão moderno baseado em REST/JSON
- **CDA (Clinical Document Architecture)**: Padrão XML para documentos clínicos

---

## 🔍 Análise da Implementação Atual

### ✅ O que JÁ está compatível:

1. **Estrutura de Dados**
   - ✅ Vinculação obrigatória de arquivos à amostra (relacionamento Sample → File)
   - ✅ Metadados essenciais (nome, tipo, tamanho, data)
   - ✅ IDs únicos e rastreáveis

2. **Tipos de Arquivo Suportados**
   - ✅ `.raw` - Arquivos de espectrômetro de massas (comum em laboratórios)
   - ✅ `.csv`, `.xls`, `.xlsx` - Formatos estruturados para dados
   - ✅ `.pdf` - Documentos clínicos

3. **Auditoria e Rastreabilidade**
   - ✅ Logs completos de todas as operações
   - ✅ IDs anonimizados (LGPD)
   - ✅ Timestamps em todas as operações

### ⚠️ O que PRECISA ser adicionado para conformidade HL7:

1. **Metadados HL7 nos Arquivos**
   - Campo para identificador único do equipamento (conforme HL7 OBR segment)
   - Campo para código do procedimento/exame (LOINC)
   - Campo para data/hora da coleta da amostra
   - Campo para data/hora do processamento

2. **Estrutura de Resultados**
   - Suporte a múltiplos resultados por arquivo
   - Valores numéricos e unidades de medida padronizadas
   - Interpretação/status do resultado (normal/anormal/crítico)

3. **Identificadores Padronizados**
   - Accession Number (número de acesso do exame)
   - Order Number (número da requisição)
   - Equipment ID padronizado

4. **Formato de Exportação**
   - Exportação em formato HL7 v2.x (pipe-delimited)
   - Exportação em FHIR JSON
   - Suporte a CDA para relatórios

---

## 🔧 Proposta de Melhorias para Conformidade HL7

### 1. Estender Modelo SampleFile com Metadados HL7

```javascript
// Campos adicionais sugeridos:
{
  // Identificadores HL7
  accessionNumber: string,      // Número de acesso do exame
  orderNumber: string,          // Número da requisição
  equipmentID: number,          // ID do equipamento que gerou o arquivo
  
  // Metadados de coleta/processamento
  collectionDateTime: Date,     // Data/hora da coleta da amostra
  processingDateTime: Date,     // Data/hora do processamento
  analysisDateTime: Date,       // Data/hora da análise
  
  // Códigos padronizados
  loincCode: string,            // Código LOINC do exame/procedimento
  procedureCode: string,        // Código do procedimento (SNOMED ou local)
  
  // Informações do equipamento
  equipmentManufacturer: string,
  equipmentModel: string,
  equipmentSerialNumber: string,
  softwareVersion: string,
  
  // Status e interpretação
  resultStatus: string,         // F (Final), P (Preliminar), C (Cancelado)
  interpretation: string,       // N (Normal), A (Anormal), C (Crítico)
  
  // Versão HL7/FHIR
  hl7Version: string,           // Ex: "2.8", "FHIR R4"
  messageType: string           // Ex: "ORU^R01", "OBR"
}
```

### 2. Criar Service de Conversão HL7

- Converter arquivos para formato HL7 v2.x
- Exportar em formato FHIR JSON
- Validar estrutura conforme padrão HL7

### 3. API de Exportação

- `GET /api/samples/:sampleID/files/:fileID/export/hl7` - Exporta em HL7 v2.x
- `GET /api/samples/:sampleID/files/:fileID/export/fhir` - Exporta em FHIR JSON

---

## ✅ Implementação Recomendada

A implementação atual é **sólida e funcional** para gerenciamento interno de arquivos. Para adicionar **conformidade HL7**, recomendo:

1. **Fase 1 (Essencial)**:
   - Adicionar campos opcionais de metadados HL7 no modelo
   - Suportar Accession Number e Order Number
   - Adicionar campos de data/hora de coleta e processamento

2. **Fase 2 (Interoperabilidade)**:
   - Criar service de exportação HL7 v2.x
   - Implementar exportação FHIR
   - Validação de estrutura HL7

3. **Fase 3 (Integração Completa)**:
   - API REST para receber resultados em formato HL7
   - Webhook para notificações
   - Interface para mapeamento de códigos LOINC/SNOMED

---

## 📝 Conclusão

A implementação atual **atende completamente aos requisitos funcionais** solicitados:
- ✅ Upload, armazenamento, consulta e download de arquivos
- ✅ Vinculação obrigatória à amostra
- ✅ Permissões por perfil
- ✅ Auditoria LGPD
- ✅ Suporte a arquivos .raw de espectrômetro

**Para conformidade HL7**, são necessárias extensões adicionais (campos opcionais e APIs de exportação) que podem ser implementadas em fases futuras, conforme a necessidade de integração com sistemas externos.

---

## 🎯 Próximos Passos Sugeridos

1. Confirmar se há necessidade imediata de conformidade HL7
2. Definir quais campos HL7 são prioritários
3. Identificar sistemas externos que precisam se integrar
4. Implementar extensões de forma incremental



