# Especificacao Tecnica - RCS-GOV 1.0

## Identificacao

Modelo metodologico: `RCS-GOV-1.0`

Versao SPREC de referencia: `SPREC-2.0`

## Objetivo

RCS-GOV 1.0 e a camada metodologica ativa para certificacao local de qualidade pre-analitica no BioAvanceD-v2. A metodologia preserva evidencias SPREC brutas e adiciona uma classificacao local auditavel, sem substituir SPREC, MIABIS, ISO 20387 ou boas praticas ISBER.

## Formula Central

```text
RCS = 100 - Pbio
Pbio = soma das penalidades dos eixos
penalty_axis = axis_weight x severity
```

`axis_weight` vem dos seeds de pesos. `severity` vem exclusivamente do seed de severidades S3.

## Matrizes

O modelo distingue matriz fluida e matriz solida. Cada matriz possui eixos proprios, catalogo SPREC proprio e pesos cuja soma deve ser 100.

## Classificacao

O campo de decisao final e `final_grade`, com escala:

- `A`: RCS >= 90;
- `B`: 80 <= RCS < 90;
- `C`: 65 <= RCS < 80;
- `D`: 50 <= RCS < 65;
- `E`: RCS < 50 ou falha de governanca.

## Gate de Governanca

O gate de governanca e nao compensavel. Se `governance_status = 0`, o resultado obrigatorio e:

```json
{
  "p_bio": null,
  "rcs_score": null,
  "score_based_grade": null,
  "final_grade": "E",
  "grade_route": "Governance failure",
  "axis_penalties": []
}
```

Falhas de governanca incluem, entre outras:

- metadados criticos ausentes;
- codigo SPREC desconhecido ou invalido;
- codigo incompatavel com a matriz;
- valor `Other` sem interpretacao local validada;
- valor `Unknown`;
- documentacao ou rastreabilidade insuficiente;
- monitoramento ausente quando aplicavel;
- incompatibilidade semantica entre matriz, eixo, evento e contexto;
- ausencia de workflow analitico quando a severidade depende de contexto.

## Not Scored

Valores desconhecidos, ausentes, invalidos, nao reconhecidos, `Other`, `Unknown` ou `Not scored` nao podem ser tratados como severidade zero. Devem ser representados como:

```json
{
  "is_scored": false,
  "severity_value": null,
  "governance_action": "requires_review"
}
```

ou como `governance_failure`, conforme regra seedada.

## Seeds Preservados

- S1: catalogo SPREC fluido;
- S2: catalogo SPREC solido;
- S3: mapeamento de severidade intraeixo;
- pesos dos eixos;
- thresholds A-E;
- regras de governanca.

## Rastreabilidade

Todo resultado deve conter `calculation_trace`, `axis_penalties`, versao do modelo, matriz, status de governanca, razoes de falha quando existirem e rota de classificacao.
