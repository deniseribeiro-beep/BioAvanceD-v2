# Guia de Importacao FHIR/Excel em Lote

## Uso recomendado

O Intake Wizard e o fluxo recomendado para uso diario, cadastro individual e operacao assistida de paciente e amostra.

A importacao FHIR em lote deve ser usada apenas para lotes de transferencia, cargas preparadas por pesquisadores ou interoperabilidade entre sistemas. Ela nao substitui o Intake Wizard para rotina operacional.

## Padrao principal

O formato principal aceito para importacao em lote e um arquivo FHIR R4 Bundle JSON.

O Excel e apenas um modelo auxiliar para facilitar preenchimento por pesquisadores. O arquivo Excel nao e salvo diretamente. Ele deve ser convertido para JSON FHIR antes de entrar no staging.

## Fluxo obrigatorio

1. Upload: o usuario seleciona um JSON FHIR R4 Bundle ou converte previamente um Excel para JSON FHIR.
2. Staging: o backend cria um lote temporario em `import_batches` e linhas em `import_staging_records`.
3. Validacao: cada linha recebe status e mensagens por campo obrigatorio ausente ou inconsistente.
4. Correcao: registros com erro devem ser corrigidos antes de consolidacao.
5. Envio TCLE: registros com e-mail valido podem receber TCLE para assinatura.
6. Assinatura: sem TCLE assinado, o registro permanece pendente.
7. Commit: somente registros validos e com TCLE assinado podem gerar paciente/amostra definitivos.
8. Etiqueta: a etiqueta de identificacao so deve ser gerada/exibida depois que a amostra definitiva existir.
9. RCS-GOV: o preview e o calculo final devem vir do backend, preservando `final_grade`, `calculation_trace` e `axis_penalties`.

## Recursos FHIR esperados

O Bundle pode conter:

- `Patient`
- `Specimen`
- `Condition`
- `Observation`
- `Consent`

## Campos minimos obrigatorios

Paciente:

- identificador externo ou `Patient.id`
- nome
- documento ou `identifier`
- e-mail quando TCLE precisar ser enviado
- data de nascimento, quando disponivel
- sexo/genero, quando disponivel

Amostra:

- identificador externo ou `Specimen.id`
- vinculo com paciente em `Specimen.subject.reference`
- tipo de amostra
- data/hora de coleta ou cadastro, quando exigida
- matriz
- SPREC ou indicacao controlada de processamento desconhecido
- container, barcode ou identificador de amostra, quando disponivel

Doenca:

- nome da doenca, quando disponivel
- CID-10/ICD
- ORPHA
- OMIM

Observacoes:

- biomarcadores codificados ou descritos
- fenomenos HPO quando codificados

Consentimento:

- recurso `Consent`, quando ja existir
- status assinado/ativo para liberar commit automaticamente

## Garantias de seguranca do fluxo

Dados faltantes nao sao salvos silenciosamente. Cada inconsistencia deve aparecer na revisao do lote com status e mensagem de campo.

Registros sem TCLE assinado nao sao salvos como pacientes/amostras definitivos. Eles permanecem em staging com status pendente ate assinatura ou correcao.

O Excel nao deve conter segredos, chaves, tokens ou dados sensiveis desnecessarios. O JSON FHIR gerado deve seguir o mesmo cuidado.
