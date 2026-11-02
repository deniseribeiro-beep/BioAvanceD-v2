# Viabilidade econômica (analítica) — TCO / ROI / payback

Premissas explícitas (lab tese, não contrato comercial). Valores em BRL aproximados 2026; ajustar à fatura GCP real.

## Custos (TCO anualizado — cenário lab)

| Item | Premissa | R$/mês | R$/ano |
|---|---|---:|---:|
| VM GCP (e2-equivalente 16 GB) | lab contínuo | 900 | 10 800 |
| Disco + snapshots | 100–200 GB | 80 | 960 |
| Egress / misc | baixo | 50 | 600 |
| Operador (tempo parcial) | 8 h/mês × R$80/h | 640 | 7 680 |
| Licenças vocab. (LOINC etc.) | conforme contrato real | 0–500 | 0–6 000 |
| **Total TCO lab (faixa)** | | | **≈ 20–26 k** |

Custo pontual Fase 2+3 (engenharia já afundado no projeto de tese): tratado como **sunk cost** de P&D; não entra no payback operacional do biobanco.

## Benefícios (ROI qualitativo-quantitativo)

| Benefício | Estimativa conservadora |
|---|---|
| Evitar retrabalho de planilhas / erros de consentimento | 16 h/mês × R$80 = R$1 280/mês |
| Rastreabilidade + prontidão regulatória | risco evitado (não monetizado aqui) — valor estratégico |
| Reuso do BLPP para regressão | 4 h/mês de QA economizadas = R$320/mês |
| **Benefício monetizável/mês** | **≈ R$1 600** |

## Payback (sobre TCO operacional mensal)

- TCO mensal médio ≈ R$1 700–2 200  
- Benefício mensal ≈ R$1 600  
- Payback do **delta operacional** ≈ **12–18 meses** se o biobanco substitui processo manual equivalente  

Se o benefício regulatório (evita não conformidade) for material, o payback acelera — declarar como sensibilidade, não como fato contábil.

## Conclusão econômica

Viável como **infra de P&D/tese e PoC de biobanco digital**. ROI positivo sob premissas conservadoras de economia de horas; não substitui business case institucional completo.
