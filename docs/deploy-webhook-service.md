# Deploy Webhook Worker (Production)

This guide replaces the temporary Nginx-only `/webhook` ACK with a real deployment worker.

## 1. Server Prerequisites

- Node.js 20+
- PM2 installed and running `ironlog-api`
- Nginx configured for `deploy.ironloggroup.com`
- Repository cloned at `/opt/ironlogv2`

## 2. Copy Service Files

From repository root:

- `scripts/deploy-webhook-server.mjs`
- `infra/deploy/deploy-webhook.env.example`
- `infra/deploy/deploy-webhook.service`

## 3. Create Environment File

```bash
sudo mkdir -p /etc/ironlog
sudo cp /opt/ironlogv2/infra/deploy/deploy-webhook.env.example /etc/ironlog/deploy-webhook.env
sudo nano /etc/ironlog/deploy-webhook.env
```

Set a strong `DEPLOY_WEBHOOK_TOKEN` value.

## 4. Install Systemd Service

```bash
sudo cp /opt/ironlogv2/infra/deploy/deploy-webhook.service /etc/systemd/system/deploy-webhook.service
sudo systemctl daemon-reload
sudo systemctl enable deploy-webhook
sudo systemctl restart deploy-webhook
sudo systemctl status deploy-webhook --no-pager
```

## 5. Nginx Webhook Route

Update `location = /webhook` in your Nginx config:

```nginx
location = /webhook {
    proxy_pass http://127.0.0.1:9000/webhook;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Apply config:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. GitHub Secrets

Set in `staging` and `production` environments:

- `DEPLOY_WEBHOOK_URL=https://deploy.ironloggroup.com/webhook`
- `DEPLOY_WEBHOOK_TOKEN=<same token as /etc/ironlog/deploy-webhook.env>`

## 7. Verification

Health endpoint for worker:

```bash
curl -i http://127.0.0.1:9000/health
```

Manual webhook test:

```bash
curl -i -X POST https://deploy.ironloggroup.com/webhook \
  -H "Authorization: Bearer <DEPLOY_WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main","environment":"staging"}'
```

Check latest job:

```bash
curl -s http://127.0.0.1:9000/jobs/latest
```

Service logs:

```bash
journalctl -u deploy-webhook -n 120 --no-pager
```
