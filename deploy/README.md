# Deploying The Record

Two environments on one Linode box (`ssh linode`, root, IP 69.164.213.218), both behind Cloudflare
(proxied DNS, SSL mode **Full (strict)**) and nginx, both managed by pm2 under nvm node 22.

| | Production | Staging |
|---|---|---|
| URL | https://record.mtrokel.org | https://recordstaging.mtrokel.org |
| Checkout | `/var/www/record` | `/var/www/record-staging` |
| Git ref | release tag (from `main`) | `staging` branch |
| pm2 name / port | `record` / 3001 | `record-staging` / 3002 |
| Postgres DB | `record` | `record_staging` |
| Deploy trigger | GitHub **release published** → `.github/workflows/deploy.yaml` | **push to `staging`** → `.github/workflows/deploy-staging.yaml` |
| Env file | `/var/www/record/.env` (see `env.prod.example`) | `/var/www/record-staging/.env` (see `env.staging.example`) |

Staging shares the AWS account, IAM user, KMS key and S3 bucket with prod. It has its own database,
its own `NEXTAUTH_SECRET` and its own `ENCRYPTION_KEY` (blind-index pepper).

## Files in this directory

| File | Purpose |
|---|---|
| `provision.sh` | One-time (idempotent) box setup: packages, nvm node 22, pm2, swap, both checkouts, Postgres DBs, nginx + certbot. |
| `harden.sh` | Idempotent security hardening: unattended upgrades, ufw, fail2ban, key-only sshd, sysctl. Refuses to run if no SSH key is installed. |
| `deploy.sh prod\|staging` | The deploy sequence (fetch → `npm ci` → prisma generate/migrate → build → pm2 reload → smoke test). Used by both workflows and by hand. |
| `ecosystem.config.js` | pm2 definitions for `record` and `record-staging`. |
| `nginx/*.conf` | Server blocks; `provision.sh` copies them into `/etc/nginx/sites-available/`. |
| `env.*.example` | Templates for each environment's `.env`. |

## Fresh box: first-time setup

1. **Get in.** Put your public key on the box (Linode Cloud Manager → Linode → *Rescue/LISH console*, or add
   it under *Profile → SSH Keys* before reprovisioning). `ssh linode` must work before anything else.
2. **DNS + Cloudflare.** A records `record` and `recordstaging` → `69.164.213.218`, proxied (orange cloud).
   SSL/TLS mode Full (strict). Optionally under *Security → WAF* block everything but your school's country.
3. **Clone + provision:**
   ```bash
   apt-get update && apt-get install -y git
   git clone <repo-url> /var/www/record
   REPO_URL=<repo-url> bash /var/www/record/deploy/provision.sh
   ```
   It clones the `staging` branch into `/var/www/record-staging`, creates both DBs on local Postgres
   (skip if you use a managed DB — just set `DATABASE_URL`), and issues Let's Encrypt certs (needs DNS first).
4. **Fill in both `.env` files** from the examples. Prod values come from your password manager /
   the previous box; staging gets fresh `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` values:
   ```bash
   openssl rand -base64 32   # NEXTAUTH_SECRET
   openssl rand -hex 32      # ENCRYPTION_KEY
   ```
5. **Google OAuth.** In Google Cloud Console add `https://recordstaging.mtrokel.org/api/auth/callback/google`
   as an authorised redirect URI on the existing client (prod's is already there).
6. **AWS.** S3 CORS on `the-record-media` must list `https://recordstaging.mtrokel.org` as an allowed origin
   (see `docs/aws-infrastructure.md`).
7. **Deploy both:**
   ```bash
   bash /var/www/record/deploy/deploy.sh prod
   bash /var/www/record-staging/deploy/deploy.sh staging
   ```
8. **Harden** (last, once you've confirmed a *second* SSH session works with your key):
   ```bash
   bash /var/www/record/deploy/harden.sh
   # or, to only accept web traffic via Cloudflare (recommended once both DNS records are proxied):
   RESTRICT_TO_CLOUDFLARE=1 bash /var/www/record/deploy/harden.sh
   ```
9. **GitHub secrets** (repo → Settings → Secrets → Actions): `LINODE_HOST` = `69.164.213.218`,
   `LINODE_USER` = `root`, `LINODE_SSH_KEY` = a *dedicated* deploy private key whose public half is in
   `/root/.ssh/authorized_keys` (don't reuse your personal key). `ENCRYPTION_KEY` is no longer needed as a
   GitHub secret — it lives in the server's `.env`.

## Day-to-day

- **Ship to staging:** `git push origin <branch>:staging` (or merge into `staging`). The workflow deploys within ~2 min.
- **Ship to prod:** publish a GitHub release from `main`. The workflow checks out that tag.
- **By hand:** `ssh linode 'bash /var/www/record-staging/deploy/deploy.sh staging'`.
- **Logs:** `pm2 logs record-staging --lines 100`; error log mtime tells you if an error is fresh:
  `stat /root/.pm2/logs/record-staging-error.log`.
- **Roll back prod:** `ssh linode 'REF=<previous-tag> bash /var/www/record/deploy/deploy.sh prod'`.
- **Refresh staging data from prod** (PII lives here — only when needed):
  ```bash
  sudo -u postgres pg_dump -Fc record | sudo -u postgres pg_restore -d record_staging --clean --if-exists
  ```
  Rows stay decryptable because both environments share the KMS key, **but** blind indexes (`emailHash`
  etc.) are keyed by `ENCRYPTION_KEY`, so after a copy either sign-in lookups fail on staging or you
  temporarily set staging's `ENCRYPTION_KEY` to prod's. Prefer seeding staging with test accounts instead.

## Gotchas

- The box has ~1 GB RAM. `deploy.sh` caps Node's heap and `provision.sh` adds 2 GB swap. Don't add
  monolithic dependencies (the old `googleapis` package OOM-killed the build).
- A failed `next build` leaves no `.next/BUILD_ID`; `deploy.sh` then refuses to restart pm2 so the old
  process keeps serving from memory.
- `next start` loads `.env` from the checkout directory itself — pm2 doesn't need to be told about it.
- Node on the non-login PATH is not 22; `deploy.sh` and `ecosystem.config.js` pin
  `/root/.nvm/versions/node/v22.22.1/bin`. If you bump node, update both and reinstall pm2.
