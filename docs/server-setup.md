# GCP Server Setup

One-time setup for the GCP server to host price-comparison.

## Prerequisites

- Debian/Ubuntu server (same as home-freezer-inventory)
- Docker + docker-compose v2 installed
- Port 80 and 443 open in GCP firewall rules

## 1. Create app directory

```bash
sudo mkdir -p /opt/price-comparison
sudo chown $USER:$USER /opt/price-comparison
```

## 2. Create .env file

```bash
cat > /opt/price-comparison/.env << 'EOF'
POSTGRES_PASSWORD=<strong-random-password>
NEXT_PUBLIC_APP_URL=https://prices.wetpaws.dev
APP_SECRET=<strong-random-secret>
RESEND_WEBHOOK_SECRET=<from-resend-dashboard>
ANTHROPIC_API_KEY=          # optional, for better OCR
OPENAI_API_KEY=             # optional
TARGET_STORE_ID=            # optional, for local Target pricing
SCRAPER_PROXY_URL=          # optional, if scraping gets blocked
EOF
chmod 600 /opt/price-comparison/.env
```

## 3. Set up nginx + SSL

```bash
# Clone or copy the nginx config to the server
sudo bash /opt/price-comparison/nginx/setup.sh
```

Or manually:
```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp nginx/nginx.conf /etc/nginx/sites-available/prices.wetpaws.dev
sudo ln -s /etc/nginx/sites-available/prices.wetpaws.dev /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d prices.wetpaws.dev
```

## 4. GitHub Actions secrets

Add these secrets to the repo (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `GCP_HOST` | Server IP or hostname |
| `GCP_USER` | SSH user (e.g. `ubuntu`) |
| `GCP_SSH_KEY` | Private SSH key (RSA/ED25519) |

## 5. DNS (Cloudflare)

See `nginx/cloudflare-dns.md` for DNS record setup.

## First deploy

The first deploy happens automatically when you push to `main`.
To verify manually:

```bash
cd /opt/price-comparison
docker compose ps
docker compose logs app
```

## Resend inbound email

1. Go to resend.com → Domains → Add `prices.wetpaws.dev`
2. Verify DNS records
3. Go to Inbound → Add route:
   - Recipient: `receipts@prices.wetpaws.dev`
   - Endpoint: `https://prices.wetpaws.dev/api/receipts/email`
4. Copy the webhook signing secret → add to `.env` as `RESEND_WEBHOOK_SECRET`
