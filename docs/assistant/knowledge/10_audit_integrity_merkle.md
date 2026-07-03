# Auditoria e integridade

A auditoria deve registrar ações relevantes com usuário ou pseudônimo, ação, entidade, resultado, data, correlação e versão do esquema.

## Integridade

Hashes encadeados e árvores Merkle podem tornar a trilha tamper-evident. Isso significa que alterações retroativas devem ser detectáveis; não significa impossibilidade física absoluta de alteração por alguém que controle simultaneamente banco, host, chaves e âncoras.

## Verificação

A verificação deve usar eventos e raízes oficiais recuperados pelo servidor. O cliente não deve fornecer uma raiz arbitrária como fonte de verdade.

## Requisitos

- serialização canônica;
- hash de folha e nó com separação de domínio;
- prova de inclusão;
- prova de consistência;
- tree head assinado;
- chave assimétrica separada;
- histórico de chaves;
- timestamp ou testemunha externa quando configurados;
- estado explícito em indisponibilidade;
- testes de adulteração.
