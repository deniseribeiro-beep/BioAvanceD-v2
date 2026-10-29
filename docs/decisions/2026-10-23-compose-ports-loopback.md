# 2026-10-23: the dev and test compose stacks publish their ports on the host loopback only

## Decided

1. **Every published port in `compose.dev.yml` and `compose.test.yml` binds `127.0.0.1`.** Each `ports:` entry has the form `"127.0.0.1:${<NAME>_HOST_PORT:-<port>}:<port>"`: Mongo, Neo4j, InfluxDB, Redis, TSA, Witness, the backend and its debugger, and the frontend. The host-port variables stay, so an override in `.env.docker` still moves a port. `expose:` entries are not publishes and are unchanged.
2. **Why.** A bare `"host:container"` entry publishes on `0.0.0.0` and `[::]`. On these dev PCs Docker Desktop's inbound Allow rule for its backend sits on the Public network profile, so the firewall let every one of those services be reached from the local network: databases with test credentials, an unauthenticated debugger, a backend seeded with test users. These stacks are not deployments; nothing off the machine is meant to reach them.
3. **What still reaches them.** Playwright, the e2e gate and the fixture helpers in `tests/e2e/helpers/` reach the published ports by `localhost` or `127.0.0.1`, and services reach each other by compose service name over the compose network, which a publish does not touch. The containers' own `--host 0.0.0.0`, `--inspect=0.0.0.0:9229` and `--bind_ip_all` bind inside the container and stay: the publish is what narrows exposure.
4. **`compose.prod.yml` is untouched.** Its exposure is a deployment decision, not a dev-machine one.

## Publishing on the LAN for a one-off

Do not edit the tracked compose files. Put a local override file beside them, for example `compose.lan.yml` kept out of git, that re-lists the one port wanted on the LAN with `!override` so it replaces the loopback entry rather than adding to it:

```yaml
services:
  frontend:
    ports: !override
      - "0.0.0.0:5173:5173"
```

and start the stack with `docker compose -f compose.dev.yml -f compose.lan.yml up`. Stop it, or drop the override, when the one-off is over.
