#!/usr/bin/env bash
# One-time provisioning of a freshly reprovisioned Linode box for The Record (prod + staging).
# Run as root ON THE SERVER after cloning the repo somewhere (e.g. /var/www/record):
#   bash deploy/provision.sh
# Idempotent: safe to re-run. Does NOT run harden.sh (run that separately once your SSH key works).
#
# Prereqs you must do by hand first:
#   - DNS: record.mtrokel.org and recordstaging.mtrokel.org → this box's IP (Cloudflare, proxied)
#   - Cloudflare SSL mode "Full (strict)" for both hostnames
#   - Postgres: local (installed below; the role password is generated and written into both .env
#     files) or a managed DATABASE_URL you set in each .env afterwards
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
REPO_URL="${REPO_URL:-$(git -C "$(dirname "$0")/.." remote get-url origin 2>/dev/null || true)}"
NODE_VERSION=22.22.1
LE_EMAIL="${LE_EMAIL:-michaelt96099@gmail.com}"

log() { printf '\n==> %s\n' "$*"; }

log "packages"
apt-get update -q
apt-get install -yq git curl build-essential nginx certbot python3-certbot-nginx postgresql postgresql-contrib

log "node ${NODE_VERSION} via nvm + pm2"
if [[ ! -d /root/.nvm ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
export NVM_DIR=/root/.nvm; . "$NVM_DIR/nvm.sh"
nvm install "$NODE_VERSION" >/dev/null
nvm alias default "$NODE_VERSION" >/dev/null
export PATH=/root/.nvm/versions/node/v${NODE_VERSION}/bin:$PATH
command -v pm2 >/dev/null || npm install -g pm2
pm2 startup systemd -u root --hp /root >/dev/null || true

log "swap (build needs it on a 1 GB box)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "checkouts"
for pair in "record:main" "record-staging:staging"; do
  dir="/var/www/${pair%%:*}"; branch="${pair##*:}"
  if [[ ! -d "$dir/.git" ]]; then
    [[ -n "$REPO_URL" ]] || { echo "set REPO_URL=<git clone url>" >&2; exit 1; }
    git clone --branch "$branch" "$REPO_URL" "$dir" || git clone "$REPO_URL" "$dir"
  fi
  if [[ ! -f "$dir/.env" ]]; then
    envname=$([[ "$dir" == */record ]] && echo prod || echo staging)
    cp "$dir/deploy/env.${envname}.example" "$dir/.env" 2>/dev/null || true
    echo "!! $dir/.env created from example — FILL IT IN before deploying"
  fi
  chmod 600 "$dir/.env" 2>/dev/null || true
done

log "postgres: role + databases"
if systemctl is-active --quiet postgresql; then
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='record'" | grep -q 1; then
    DB_PW=$(openssl rand -hex 24)
    sudo -u postgres psql -qc "CREATE ROLE record LOGIN PASSWORD '$DB_PW';"
    # Write the generated password straight into each checkout's .env so it is never lost.
    for pair in "record:record" "record-staging:record_staging"; do
      envf="/var/www/${pair%%:*}/.env"; db="${pair##*:}"
      [[ -f "$envf" ]] && sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://record:${DB_PW}@localhost:5432/${db}#" "$envf"
    done
    echo "created role 'record'; DATABASE_URL written into both .env files"
  fi
  for db in record record_staging; do
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || \
      sudo -u postgres createdb -O record "$db"
  done
fi

log "nginx"
mkdir -p /var/www/letsencrypt /etc/nginx/snippets
cat > /etc/nginx/snippets/record-ssl.conf <<'CONF'
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_ecdh_curve X25519:prime256v1;
ssl_session_timeout 1d;
ssl_session_cache shared:RecordSSL:10m;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;
resolver 1.1.1.1 8.8.8.8 valid=300s;
CONF
# Trust Cloudflare's forwarded client IP so rate limiting / logs see real visitors.
{
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > /etc/nginx/conf.d/cloudflare-realip.conf
SRC="$(cd "$(dirname "$0")" && pwd)/nginx"
rm -f /etc/nginx/sites-enabled/default
for site in record record-staging; do
  host=$([[ $site == record ]] && echo record.mtrokel.org || echo recordstaging.mtrokel.org)
  if [[ ! -d /etc/letsencrypt/live/$host ]]; then
    # Bootstrap: plain HTTP server block so certbot's webroot challenge can be answered.
    cat > /etc/nginx/sites-available/$site <<CONF
server { listen 80; listen [::]:80; server_name $host;
  location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
  location / { return 503; } }
CONF
    ln -sf /etc/nginx/sites-available/$site /etc/nginx/sites-enabled/$site
    nginx -t && systemctl reload nginx
    certbot certonly --webroot -w /var/www/letsencrypt -d "$host" --non-interactive --agree-tos -m "$LE_EMAIL" \
      || { echo "!! certbot failed for $host (is DNS pointing here yet?) — leaving HTTP-only stub"; continue; }
  fi
  cp "$SRC/$site.conf" /etc/nginx/sites-available/$site
  ln -sf /etc/nginx/sites-available/$site /etc/nginx/sites-enabled/$site
done
nginx -t && systemctl enable --now nginx && systemctl reload nginx
systemctl enable --now certbot.timer 2>/dev/null || true

log "done. Next: fill in /var/www/record/.env and /var/www/record-staging/.env, then"
echo "  bash /var/www/record/deploy/deploy.sh prod"
echo "  bash /var/www/record-staging/deploy/deploy.sh staging"
echo "  bash /var/www/record/deploy/harden.sh"
