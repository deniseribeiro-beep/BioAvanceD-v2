# MQTT no Deploy da VM

MQTT e opcional no backend. Mantenha `MQTT_ENABLED=false` por padrao enquanto nao existir um broker MQTT configurado para a VM.

Com `MQTT_ENABLED=false`, o backend apenas registra `ingestão MQTT desabilitada` e segue o boot normalmente.

Use `MQTT_ENABLED=true` somente quando `MQTT_URL` apontar para um broker disponivel. Se `MQTT_ENABLED=true` estiver sem `MQTT_URL`, o backend registra warning controlado e continua sem iniciar a ingestao.
