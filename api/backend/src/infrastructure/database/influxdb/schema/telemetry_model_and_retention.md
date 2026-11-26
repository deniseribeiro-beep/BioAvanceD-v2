# InfluxDB Model — BioAvanceD (Freezer IoT)

## Measurement
- `freezer_telemetry`

## Tags (alta cardinalidade controlada, filtros frequentes)
- `site_id`
- `freezer_id`
- `sensor_id`
- `equipment_type` (`-80C`, `LN2`)
- `rack`
- `zone`
- `unit` (`C`, `%`, `ppm`)

## Fields (valores medidos e estado)
- `temperature` (float)
- `humidity` (float)
- `nitrogen_level` (float)
- `door_open` (boolean)
- `battery_level` (float)
- `signal_rssi` (float)
- `alarm_state` (string)
- `setpoint_temperature` (float)

## Exemplo Line Protocol
```txt
freezer_telemetry,site_id=HOSP01,freezer_id=FRZ-80-12,sensor_id=SEN-991,equipment_type=-80C,rack=R2,zone=B,unit=C temperature=-79.8,humidity=38.2,battery_level=91.3,signal_rssi=-64.0,door_open=false 1767212160000000000
freezer_telemetry,site_id=HOSP01,freezer_id=LN2-03,sensor_id=SEN-772,equipment_type=LN2,rack=R1,zone=A,unit=ppm temperature=-196.2,nitrogen_level=74.5,alarm_state="normal",door_open=false 1767212160000000000
```

## Bucket e retenção aplicados pela stack
- Bucket único: o nome em `INFLUXDB_BUCKET`, criado pelo modo setup da imagem `influxdb` (`DOCKER_INFLUXDB_INIT_BUCKET`) em `compose.yml`, `compose.prod.yml` e `compose.test.yml`.
- Retenção aplicada pela stack (`DOCKER_INFLUXDB_INIT_RETENTION`): `infinita`. A variável não é definida, e o InfluxDB 2.x guarda os dados sem expiração. O InfluxDB é a autoridade da leitura (RNF016 C3), e nenhuma tarefa de downsampling roda para conservar um agregado antes de uma expiração.
- `api/backend/tests/architecture/influxdb-retention.arch.test.js` (RNF016 C7) compara esta linha com os arquivos compose.

## Plano de buckets com retenção e downsampling (não aplicado)
Nada abaixo é criado pela stack; é o plano para quando a retenção por bucket for adotada.

- `bioavanced_telemetry_raw_30d` → retenção 30 dias (dados brutos, 1s-10s)
- `bioavanced_telemetry_5m_2y` → retenção 2 anos (downsample 5 min)
- `bioavanced_telemetry_1h_10y` → retenção 10 anos (downsample 1 h, auditoria/ISO 20387)

### Setup (CLI InfluxDB 2.x)
```bash
influx bucket create -n bioavanced_telemetry_raw_30d --retention 720h
influx bucket create -n bioavanced_telemetry_5m_2y --retention 17520h
influx bucket create -n bioavanced_telemetry_1h_10y --retention 87600h
```

### Downsampling Tasks (Flux)
```flux
option task = {name: "downsample_5m", every: 5m}
from(bucket: "bioavanced_telemetry_raw_30d")
  |> range(start: -task.every)
  |> filter(fn: (r) => r._measurement == "freezer_telemetry")
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  |> to(bucket: "bioavanced_telemetry_5m_2y")
```

```flux
option task = {name: "downsample_1h", every: 1h}
from(bucket: "bioavanced_telemetry_5m_2y")
  |> range(start: -task.every)
  |> filter(fn: (r) => r._measurement == "freezer_telemetry")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
  |> to(bucket: "bioavanced_telemetry_1h_10y")
```
