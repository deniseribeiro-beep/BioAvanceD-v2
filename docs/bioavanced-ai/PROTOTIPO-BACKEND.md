# Protótipo backend do simulador BioAvanceD AI

Este protótipo oferece uma API FastAPI isolada, com dependências próprias e
sem importar ou alterar as rotas atuais do assistente:

- `GET /api/v1/simulator/scenarios`: retorna os cenários e perguntas
  sintéticos permitidos.
- `POST /api/v1/simulator/evaluate`: recebe somente `scenario_id` e
  `question_id` do catálogo e devolve uma prévia determinística do contrato.

Exemplo de chamada:

```json
{
  "scenario_id": "synthetic-baseline",
  "question_id": "rcs-status"
}
```

A resposta marca explicitamente `mode: "contract_preview"`,
`governance.status: "not_evaluated"` e `result.status: "not_calculated"`.
Score, classificação, matriz e eixos permanecem indisponíveis; não se deve
interpretar esta prévia como avaliação RCS. A explicação é texto estático
(`explanation_source: "static_demo"`), sem chamada a LLM, RAG, Core ou banco.
O módulo não persiste requisições, perguntas nem respostas.

Instale as dependências do protótipo a partir de `backend/`:

```powershell
python -m pip install -r requirements-simulator.txt
```

Inicie a API independente a partir de `backend/`:

```powershell
uvicorn app.simulator_main:app --reload
```

Os testes focados podem ser executados a partir de `backend/`:

```powershell
python -m unittest tests.test_simulator
```

A implementação do cálculo RCS permanece bloqueada até aprovação das regras,
matriz e vetores de referência, conforme os gates do
[plano de implementação](./PLANO-IMPLEMENTACAO-IMPLANTACAO.md). O entrypoint
independente não substitui nem modifica o serviço principal.
