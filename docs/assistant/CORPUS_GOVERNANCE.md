# Governança do corpus

## Hierarquia de autoridade

1. Documentação operacional curada em `docs/assistant/knowledge/`.
2. Contratos e regras versionadas do software.
3. Projeto de pesquisa e parecer do CEP para escopo e limitações.
4. Artigos e normas para fundamentação científica.
5. Materiais históricos apenas como contexto, nunca para substituir a regra operacional atual.

## Conflitos

Quando dois documentos divergirem, prevalece o documento ativo de maior prioridade e versão mais recente. O assistente deve mencionar a divergência quando relevante.

## Atualização

Cada alteração exige:
- nova versão;
- hash;
- aprovação da responsável;
- reingestão idempotente;
- desativação, não exclusão, da versão anterior;
- registro de auditoria.

## Documentos antigos com IA/XAI

O projeto de pesquisa original contém alegações sobre machine learning, XAI e apoio diagnóstico. Essas alegações são históricas e estão fora do escopo técnico atual. Não devem ser usadas para gerar respostas operacionais.
