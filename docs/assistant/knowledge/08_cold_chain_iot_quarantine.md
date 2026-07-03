# Cadeia fria, IoT e quarentena lógica

A telemetria ambiental deve registrar medições, equipamento, sensor, unidade, data, hora, qualidade e política de limite aplicável.

## Fluxo esperado

1. o sensor envia uma medição;
2. a aplicação persiste a série temporal;
3. a política ambiental é avaliada;
4. um desvio relevante cria incidente;
5. a localização afetada é identificada;
6. as amostras relacionadas são marcadas para revisão ou quarentena;
7. ações posteriores respeitam o bloqueio;
8. todo o fluxo é auditado.

## Regras

- indisponibilidade do sensor não pode ser interpretada como temperatura normal;
- incidentes não devem ser apagados;
- liberação deve exigir papel e justificativa apropriados;
- o sistema deve distinguir aviso, excursão, incidente e quarentena;
- timestamps e unidades devem ser consistentes.
