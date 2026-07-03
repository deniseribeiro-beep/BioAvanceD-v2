# Segurança, privacidade e RBAC

O BioAvanceD deve aplicar Privacy by Design, minimização, segregação de responsabilidades e rastreabilidade.

## Controles essenciais

- autenticação;
- autorização por papel e ação;
- menor privilégio;
- sessões com expiração e revogação;
- criptografia de dados sensíveis;
- chaves e segredos fora do código-fonte;
- proteção de APIs;
- validação e sanitização de entrada;
- logs auditáveis;
- backup e restauração;
- proibição de identificadores diretos em domínios que não os exigem.

## Assistente

O Assistente Inteligente Contextual não pode receber CPF, nome, e-mail, prontuário, endereço, token, senha, segredo, variável de ambiente ou conteúdo clínico identificável. Perguntas devem ser sanitizadas e o log deve armazenar apenas informação mínima, hash ou versão redigida.

## Conformidade

A plataforma implementa controles destinados a apoiar a aderência à LGPD e o alinhamento a boas práticas. O sistema não deve declarar certificação ou conformidade jurídica integral sem avaliação institucional independente.
