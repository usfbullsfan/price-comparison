#!/usr/bin/env bash
# Run on the GCP server to set up nginx + SSL for prices.wetpaws.dev
# Usage: sudo bash nginx/setup.sh

set -euo pipefail

DOMAIN="prices.wetpaws.dev"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"

echo "==> Installing nginx + certbot"
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Copying nginx config"
cp "$(dirname "$0")/nginx.conf" "${NGINX_CONF}"
ln -sf "${NGINX_CONF}" "/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> Testing nginx config"
nginx -t

echo "==> Reloading nginx"
systemctl reload nginx

echo "==> Obtaining SSL certificate"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m admin@wetpaws.dev

echo "==> Enabling certbot renewal timer"
systemctl enable --now certbot.timer

echo ""
echo "Done! ${DOMAIN} is live."
