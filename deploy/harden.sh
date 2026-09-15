#!/usr/bin/env bash
# Idempotent security hardening for the Record Linode box (Ubuntu/Debian).
# Run as root:  bash deploy/harden.sh
#
# What it does:
#   1. apt upgrade + unattended security upgrades
#   2. ufw: default deny inbound, allow SSH + 80 + 443 (optionally only from Cloudflare)
#   3. fail2ban with an sshd jail
#   4. sshd: key-only auth, no passwords, root allowed with key only, tighter limits
#   5. kernel/sysctl network hardening
#   6. tightens permissions on /var/www/*/.env
#
# Safety: it refuses to disable password auth unless /root/.ssh/authorized_keys has a key,
# and it validates the sshd config (sshd -t) before reloading, so you can't lock yourself out.
#
# Options (env vars):
#   RESTRICT_TO_CLOUDFLARE=1   only allow 80/443 from Cloudflare's published IP ranges
#                              (prod DNS is proxied through Cloudflare; make sure the staging
#                              record is proxied too before turning this on).
#   SSH_PORT=22                port to keep open for SSH.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
SSH_PORT="${SSH_PORT:-22}"

log() { printf '\n==> %s\n' "$*"; }

log "1/6 apt update + upgrade + unattended-upgrades"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ufw fail2ban unattended-upgrades apt-listchanges curl
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Only security origins are enabled by default in 50unattended-upgrades; make sure reboots
# aren't automatic (pm2 apps would come back, but we'd rather decide when).
sed -i 's|^//Unattended-Upgrade::Automatic-Reboot "false";|Unattended-Upgrade::Automatic-Reboot "false";|' /etc/apt/apt.conf.d/50unattended-upgrades
sed -i 's|^//Unattended-Upgrade::Remove-Unused-Dependencies "false";|Unattended-Upgrade::Remove-Unused-Dependencies "true";|' /etc/apt/apt.conf.d/50unattended-upgrades

log "2/6 ufw firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_PORT}/tcp" comment 'SSH (rate limited)'
if [[ "${RESTRICT_TO_CLOUDFLARE:-0}" == "1" ]]; then
  for range in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    ufw allow from "$range" to any port 80,443 proto tcp comment 'Cloudflare'
  done
  echo "80/443 restricted to Cloudflare ranges"
else
  ufw allow 80/tcp comment 'HTTP (certbot + redirect)'
  ufw allow 443/tcp comment 'HTTPS'
fi
ufw --force enable
ufw status verbose

log "3/6 fail2ban"
cat > /etc/fail2ban/jail.local <<CONF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ${SSH_PORT}
mode    = aggressive
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "4/6 sshd hardening"
if [[ ! -s /root/.ssh/authorized_keys ]]; then
  echo "REFUSING to disable password auth: /root/.ssh/authorized_keys is empty. Add your key first." >&2
  exit 1
fi
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-record-hardening.conf <<CONF
Port ${SSH_PORT}
Protocol 2
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
MaxAuthTries 3
MaxSessions 5
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
UseDNS no
CONF
# Ubuntu cloud images ship a 50-cloud-init.conf that re-enables passwords; neutralise it.
if [[ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ]]; then
  sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf
fi
chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "sshd reloaded (key-only). Keep this session open and test a NEW ssh login before closing it."

log "5/6 sysctl network hardening"
cat > /etc/sysctl.d/60-record-hardening.conf <<'CONF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.tcp_syncookies = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
CONF
sysctl --system >/dev/null

log "6/6 file permissions"
for f in /var/www/*/.env; do [[ -f "$f" ]] && chmod 600 "$f" && echo "chmod 600 $f"; done
# Remove any leftover password-based accounts' passwords? No — just report them.
echo "Accounts with a password set (should normally be none):"
awk -F: '($2 !~ /^[!*]/) {print "  " $1}' /etc/shadow || true

log "done. Summary:"
ufw status | head -20
fail2ban-client status sshd | sed -n '1,6p' || true
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|pubkeyauthentication|port) '
