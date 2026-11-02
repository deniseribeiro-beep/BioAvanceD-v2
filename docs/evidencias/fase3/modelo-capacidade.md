# Modelo de capacidade — BLPP / lab GCP

## Premissas medidas (F3.2–F3.4 + service)

| Run | N | applyMode | elapsedSec | taxa efetiva |
|---|---:|---|---:|---|
| PoC | 100 | lab-direct | ~3–7 | — |
| Corpus | 1000 | lab-direct | **41** | ≈ **24,4** fluxos/s |
| Resume proof | 4 | lab-direct | <1 | idempotência OK |
| Teto | 10000 | lab-direct | **505** (~8,4 min) | ≈ **19,8** fluxos/s |
| Smoke | 2 | service | ~1 | path RF006 OK pós-RS |
| Re-seed | 10000 | **service** | **1882** (~31,4 min) | ≈ **5,3** fluxos/s |

F2 (contexto de carga da VM): ~556 020 conceitos, ~552 436 relações.

## Camada A — modelo teórico

Com taxa medida \(r\) no corpus lab-direct:

\[
ETA(N) \approx \frac{N}{r}
\]

Usando \(r = 1000/41 \approx 24{,}4\,s^{-1}\) (lab-direct) e \(r_s = 10000/1882 \approx 5{,}3\,s^{-1}\) (service):

| N | ETA lab-direct | ETA service (medido/extrap.) |
|---:|---|---|
| 100 | ~4 s | ~19 s |
| 1 000 | **41 s medido** | ~3 min |
| 10 000 | **505 s medido** | **1882 s medido** |

Fator service/lab-direct no teto N=10k: ≈ **3,7×** mais lento (transações + alocação + outbox).

## Camada B — empírico

- N=100 / 1000 / 10000 lab-direct na mesma VM (seed 4242).
- N=10000 service (seed 9002, chunkSize 50, runId `blpp-9002-10000-1793583172977`).
- Idempotência: reaplicar seed 4242 em N=1000 reutilizou os 100 primeiros `sourceRecordId` do PoC.

## Gargalos

1. ~~Mongo standalone~~ → **resolvido** com `compose.lab-rs.yml` (`rs0` + keyFile).
2. `applyMode=service` é ~3–4× mais lento que lab-direct (esperado: RF006 + storage + movements).
3. Outbox Neo4j não foi o gargalo dominante no re-seed service observado.

## Conclusão de viabilidade técnica

Infra do lab **suporta** população sintética N=1000 (segundos, lab-direct) e N=10 000 nos modos lab-direct e service após replica set. O caminho RF006 completo está **empiricamente** calibrado (~5,3 fluxos/s no teto service).
