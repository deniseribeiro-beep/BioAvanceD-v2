# U6 — Re-seed N=10000 applyMode=service

| Campo | Valor |
|---|---|
| Started | 2026-11-02T01:32:51+00:00 |
| Completed | ~2026-11-02T02:04:15Z (`ok: true`) |
| runId | `blpp-9002-10000-1793583172977` |
| seed | 9002 |
| N | 10000 |
| chunks | 200 × 50 |
| elapsed | 1882 s (~31,4 min) |
| failed chunks | 0 |
| Mongo DB | `bioavanced_dev` |
| runSamples / runPatients | 10000 / 10000 |
| totalSamples / totalPatients | 20006 / 20006 (inclui corpus lab-direct prévio) |
| Pré-requisito | Mongo replica set `rs0` + keyFile (`compose.lab-rs.yml`); smoke N=2 OK |

Logs: `~/blpp-runs/corpus10000-service/run.log` · `eta.txt`
