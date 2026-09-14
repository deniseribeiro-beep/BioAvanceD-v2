# Wave 2 — checkpoint RF022 / Docker

## Estado validado

HEAD de estabilização validado: `9097d33967a95cc513e8992ff572d84bec6677f4`.

GitHub Actions run `34851251587`, job `103999457646`, concluiu com `success` em 2026-09-14.

A validação executou no mesmo HEAD:

- gate do Dicionário Canônico v2.0.0;
- lint e testes arquiteturais do backend;
- validação e dry-run do seed existente;
- typecheck e build do frontend;
- validação da configuração Compose efetiva;
- verificação explícita da precedência RF022;
- build Docker integral sem cache;
- subida da infraestrutura;
- inicialização do replica set MongoDB;
- execução do Foundation one-shot antes da API e workers;
- evidência `FoundationDataRun` com dicionário v2.0.0 e 1.644 elementos verificados;
- pós-condição de zero registros operacionais de domínio criados pelo Foundation;
- Neo4j vazio após Foundation;
- subida de API/worker/projector somente após o Foundation;
- prova temporal de que o Foundation terminou antes do backend iniciar;
- suíte backend completa dentro da stack Docker.

## Regra de fechamento

Este checkpoint prova a segurança do encadeamento Docker e a precedência do Foundation. Ele não encerra a Wave 2. A issue #1132 permanece aberta até que todos os critérios documentais de reconciliação integral backend × Modelo Canônico v2.0.0 estejam atendidos e revalidados.

Nenhuma issue funcional deve ser encerrada apenas com base neste checkpoint.
