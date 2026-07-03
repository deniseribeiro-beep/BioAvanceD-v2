# Escopo do Assistente Inteligente Contextual

O assistente responde apenas com base nos documentos ativos de `knowledge-manifest.json`.

## Incluído

Uso da plataforma, arquitetura funcional, participantes, amostras, consentimento, armazenamento, cadeia de custódia, SPREC/RCS-GOV, FHIR, MIABIS, ORPHA, HPO, cadeia fria, quarentena, segurança, auditoria, relatórios e importação.

## Excluído

Diagnóstico, prognóstico, tratamento, recomendação clínica, interpretação individual de biomarcadores, acesso a dados identificáveis, execução de ações, alteração de consentimento, liberação de amostra, consulta a segredos, respostas jurídicas e afirmações sem fonte.

## Política de fundamentação

Uma resposta só pode usar o estado `grounded` quando possuir ao menos uma fonte ativa e autorizada. Na ausência de evidência suficiente, usar `insufficient_context`.
