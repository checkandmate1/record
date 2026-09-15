#!/usr/bin/env bash
# Deploy one environment on the Linode box. Run as root ON THE SERVER:
#   bash deploy/deploy.sh prod            # /var/www/record, branch main (or REF=<tag>)
#   bash deploy/deploy.sh staging         # /var/www/record-staging, branch staging
# Env overrides: REF=<git ref to check out>  SKIP_INSTALL=1  SKIP_BUILD=1
set -euo pipefail

main() {

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  prod)    APP_DIR=/var/www/record;         PM2_NAME=record;         PORT=3001; DEFAULT_REF=main ;;
  staging) APP_DIR=/var/www/record-staging; PM2_NAME=record-staging; PORT=3002; DEFAULT_REF=staging ;;
  *) echo "usage: $0 prod|staging" >&2; exit 1 ;;
esac
REF="${REF:-$DEFAULT_REF}"

# pm2 and the app both run under nvm node 22 (the system node is older). See CLAUDE.md "Environments".
export PATH=/root/.nvm/versions/node/v22.22.1/bin:$PATH
export NODE_OPTIONS="--max-old-space-size=1536"   # ~1 GB RAM + swap box; next build is memory hungry

cd "$APP_DIR"
git reset -q --hard   # server checkouts are disposable; never hand-edit files here
[[ -f .env ]] || { echo "$APP_DIR/.env missing — copy deploy/env.${ENV_NAME}.example and fill it in" >&2; exit 1; }

echo "==> [$ENV_NAME] fetching $REF"
git fetch --tags --prune origin
git checkout -q --detach "origin/$REF" 2>/dev/null || git checkout -q --detach "$REF"
git log --oneline -1

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "==> npm ci"
  npm ci --no-audit --no-fund
fi

echo "==> prisma generate + migrate deploy"
npx prisma generate
npx prisma migrate deploy

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> next build"
  # A failed build leaves no .next/BUILD_ID; the running pm2 process keeps serving from memory,
  # and we must not restart it in that case.
  npm run build
  [[ -f .next/BUILD_ID ]] || { echo "build produced no BUILD_ID — NOT restarting $PM2_NAME" >&2; exit 1; }
fi

echo "==> pm2 reload $PM2_NAME"
pm2 startOrReload deploy/ecosystem.config.js --only "$PM2_NAME" --update-env
pm2 save

echo "==> smoke test"
sleep 3
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "http://127.0.0.1:${PORT}/login")
echo "GET /login -> $code"
[[ "$code" == "200" ]] || { echo "smoke test failed"; pm2 logs "$PM2_NAME" --lines 40 --nostream; exit 1; }
echo "==> [$ENV_NAME] deployed $(git rev-parse --short HEAD)"
}

main "$@"
