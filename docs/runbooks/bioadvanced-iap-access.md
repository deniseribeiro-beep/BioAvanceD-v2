# Acesso HTTPS — bioadvanced.dev (homolog comercial paliativo)

> **v2.1 / G10.** IAP Google **não** é autenticação de produto e está **desabilitado** no backend `bioavanced-access-backend` (2026-11-26).
> Auth comercial = tenant invite/ativação (ADR `docs/decisions/2026-11-26-access-tenant-only-identity.md`).
> Domínio paliativo: `bioadvanced.dev` (grafia com “advanced”; mantido de propósito).

## URL

- Preferencial (DNS A confirmado): https://www.bioadvanced.dev/login
- Apex: https://bioadvanced.dev/login — exige registro **A** Host `@` → `136.110.235.22` na Name.com (se o Host for literal `bioadvanced.dev` e o apex não resolver, edite para `@` / em branco)

## Arquitetura (2026-11-26)

Browser → Google HTTPS Load Balancer (TLS Google-managed, **sem IAP**) → VM `:8080` (`bioavanced-access-proxy`) → `frontend-app-test` / `backend-app-test`.

| Recurso GCP | Nome |
|---|---|
| Forwarding rule (443) | `bioavanced-access-https-rule` |
| IP do LB | **136.110.235.22** |
| SSL (managed) | `bioavanced-dev-cert` (`bioadvanced.dev`, `www.bioadvanced.dev`) — **ACTIVE** |
| Backend | `bioavanced-access-backend` — **IAP disabled** |
| Instance group | `bioavanced-access-ig` (VM `instance-20261029-155615`) |
| Proxy container | `bioavanced-access-proxy` |

## Login (produto)

1. Abrir https://www.bioadvanced.dev/login (ou apex se A `@` estiver propagado).
2. Usuário `admin` bootstrap ou conta ativada por convite; senha lab `BOOTSTRAP_ADMIN_TEMP_PASSWORD` de `compose.test.yml`.
3. **Sem** tela Google / IAP no caminho.

### Reabilitar IAP (só ops — não usar para cliente)

```bash
gcloud compute backend-services update bioavanced-access-backend --global --iap=enabled
```

Conceder `roles/iap.httpsResourceAccessor` no Console IAP se reabilitado. Clientes 2.1 **não** devem depender disso.

### Desabilitar IAP (caminho comercial)

```bash
gcloud compute backend-services update bioavanced-access-backend --global --iap=disabled
```

## DNS na Name.com

Nameservers: `ns1–ns4.name.com`.

| Tipo | Host | Resposta |
|---|---|---|
| A | `@` (raiz; **não** digitar o FQDN como subdomínio) | `136.110.235.22` |
| A | `www` | `136.110.235.22` |

Remova A/AAAA antigos. Não use UbiquiTLS Name.com — cert é Google-managed no LB.

Conferir:

```bash
nslookup www.bioadvanced.dev
nslookup bioadvanced.dev
gcloud compute ssl-certificates describe bioavanced-dev-cert --global --format="yaml(managed.status,managed.domainStatus)"
gcloud compute backend-services describe bioavanced-access-backend --global --format="yaml(iap)"
```

## Fallback SSH (lab)

```powershell
gcloud compute ssh instance-20261029-155615 --zone=us-central1-a --ssh-flag="-L 8080:127.0.0.1:8080" --command "sleep 600"
```

Abrir http://127.0.0.1:8080/login

## Operação na VM

```bash
bash ~/BioAvanceD-v2/scripts/gcp-access-proxy/deploy-on-vm.sh
bash ~/BioAvanceD-v2/scripts/gcp-access-proxy/run-proxy.sh
```

Frontend same-origin: `VITE_API_BASE_URL=/api` via `scripts/gcp-access-proxy/compose.access-overlay.yml`.

## Mailpit

Homolog: SMTP → Mailpit; UI em `/mailpit/` no mesmo host HTTPS (ou túnel `:8080`).

## Notas

- Mundo entra por **443** no LB; `5173`/`3000` só loopback na VM.
- Smoke 2026-11-26: `https://www.bioadvanced.dev/login` → **200** título BioAvanceD; IAP `enabled: false`.
