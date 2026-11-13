# Acesso HTTPS + IAP — bioadvanced.dev

## URL
- Canônica: https://bioadvanced.dev/login
- Alias: https://www.bioadvanced.dev/login

## Arquitetura
Browser → Google HTTPS Load Balancer (IAP) → VM `:8080` (`bioavanced-access-proxy`) → `frontend-app-test` / `backend-app-test` (loopback via rede Docker).

| Recurso GCP | Nome |
|---|---|
| Forwarding rule (443) | `bioavanced-access-https-rule` |
| IP do LB | **136.110.235.22** |
| SSL (managed) | `bioavanced-dev-cert` (`bioadvanced.dev`, `www.bioadvanced.dev`) |
| Backend + IAP | `bioavanced-access-backend` |
| Instance group | `bioavanced-access-ig` (VM `instance-20261029-155615`) |
| Proxy container | `bioavanced-access-proxy` |

## Login
1. **IAP (Google):** conta autorizada (ex. `denise.ribeiro@mail.usf.edu.br`) — tela Google antes do app.
2. **BioAvanceD (app):** usuário `admin`, senha `BOOTSTRAP_ADMIN_TEMP_PASSWORD` de `compose.test.yml` (lab; sem OAuth no produto).

### Conceder acesso IAP (manual — IAM)
A conta CLI atual (`deniser.contato@gmail.com`) não tem `setIamPolicy`. No Console GCP (projeto `fundamental-run-494721-e2`), com uma conta Owner/Admin:

1. Abra [IAP](https://console.cloud.google.com/security/iap?project=fundamental-run-494721-e2).
2. Selecione o backend **`bioavanced-access-backend`**.
3. Em **Principals** / Adicionar: `denise.ribeiro@mail.usf.edu.br` com papel **IAP-secured Web App User** (`roles/iap.httpsResourceAccessor`).
4. Se o Console pedir configurar tela de consentimento OAuth do IAP, complete com o e-mail de suporte da USF e tipo **Interno** (ou Externo só para testes).

## DNS na Name.com (manual — obrigatório para o certificado ACTIVE)

Em **Gerenciar registros DNS** de `bioadvanced.dev` (nameservers já são `ns1–ns4.name.com`):

| Tipo | Host | Resposta / valor |
|---|---|---|
| A | `@` | `136.110.235.22` |
| A | `www` | `136.110.235.22` |

Remova A/AAAA antigos que apontem para outro IP. Aguarde propagação (minutos a algumas horas). O certificado Google passa de `PROVISIONING` → `ACTIVE` só depois do DNS bater no LB.

Conferir:
```bash
gcloud compute ssl-certificates describe bioavanced-dev-cert --global --format="yaml(managed.status,managed.domainStatus)"
```

## Fallback SSH (se o LB/IAP estiver fora)
```powershell
gcloud compute ssh instance-20261029-155615 --zone=us-central1-a -- -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000
```
Abrir http://127.0.0.1:5173/login

## Operação na VM
```bash
# Rede Docker do compose
# bioavanced-test_bioavanced-test

# Rebuild frontend same-origin + proxy
bash ~/BioAvanceD-v2-homolog/scripts/gcp-access-proxy/deploy-on-vm.sh

# Só reiniciar proxy
bash ~/BioAvanceD-v2-homolog/scripts/gcp-access-proxy/run-proxy.sh
```

Frontend de lab usa `VITE_API_BASE_URL=/api` via overlay
`scripts/gcp-access-proxy/compose.access-overlay.yml`.

## Caixa de e-mail da pilha de teste

O homolog entrega e-mail por SMTP ao Mailpit (`smtp-test`, porta `1025`). A caixa fica no mesmo acesso da porta 8080, em `/mailpit/` (`scripts/gcp-access-proxy/nginx.conf`, raiz `MP_WEBROOT=/mailpit`). As mensagens permanecem na pilha.

Pelo túnel local:

```powershell
gcloud compute ssh instance-20261029-155615 --zone=us-central1-a --ssh-flag="-L 8080:127.0.0.1:8080" --command "sleep 600"
```

Abrir http://127.0.0.1:8080/mailpit/

Cada `sendEmail` grava em `notification_compliance_logs` a hora do servidor, a mesma hora em `America/Sao_Paulo` e o lugar do envio (`smtp-test:1025` e o nome da máquina). O alerta de segurança usa o mesmo envio quando `ALERT_EMAIL_TO` está definido.

## Notas
- Não use o UbiquiTLS Name.com para este caminho (cert do LB é Google-managed).
- Portas `5173`/`3000` continuam só em `127.0.0.1` no host; o mundo entra só por 443 no LB + IAP.
