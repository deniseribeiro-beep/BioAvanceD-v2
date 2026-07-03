# Interoperabilidade: HL7 FHIR e MIABIS

## HL7 FHIR

FHIR deve ser usado para intercâmbio estruturado de informações de saúde. Recursos relevantes podem incluir Patient, Specimen, Observation, Consent e Provenance, conforme o contrato adotado pelo BioAvanceD.

Importações devem:

- validar estrutura e campos obrigatórios;
- registrar proveniência;
- rejeitar inconsistências;
- preservar identificadores e referências;
- produzir relatório de erros;
- não considerar importação parcial como sucesso integral.

## MIABIS

MIABIS orienta o conjunto mínimo de metadados para compartilhamento de informações sobre biobancos e amostras. O BioAvanceD deve manter rastreabilidade entre os campos internos e o conjunto MIABIS adotado.

## FAIR

Os dados devem ser encontráveis, acessíveis sob controle, interoperáveis por padrões e reutilizáveis com qualidade, proveniência e condições de uso explícitas.
