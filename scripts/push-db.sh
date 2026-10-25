#!/usr/bin/env bash
# Replace the VPS database with a snapshot of the local one: `pnpm run push-db`. Overwrites the VPS data (the old file is kept as leads.db.bak).
# Required env: DEPLOY_HOST (the VPS IP or an ~/.ssh/config alias, never the Cloudflare-proxied domain, which does not carry SSH) and DEPLOY_USER.
# Optional: DEPLOY_DIR. Keep the values out of the repo (shell profile or ~/.ssh/config).
set -euo pipefail
host="${DEPLOY_HOST:?set DEPLOY_HOST}" user="${DEPLOY_USER:?set DEPLOY_USER}" dir="${DEPLOY_DIR:-/home/safwat/facebook-leads}"
snap="$(mktemp -d)"; trap 'rm -rf "$snap"' EXIT
DATA_DIR="${DATA_DIR:-./data}" node scripts/backup.mjs "$snap" > /dev/null # VACUUM INTO: one self-contained file, no -wal/-shm
scp -q "$snap"/leads-*.db "$user@$host:$dir/data/leads.db.new"
ssh "$user@$host" "export PATH=/usr/local/bin:/usr/bin:/bin:\$HOME/.local/share/pnpm:\$HOME/.local/bin:\$PATH; set -e; cd $dir/data
  pm2 stop fb-leads > /dev/null
  [ -f leads.db ] && cp leads.db leads.db.bak
  mv leads.db.new leads.db; rm -f leads.db-wal leads.db-shm
  pm2 start fb-leads > /dev/null"
echo "pushed to $user@$host:$dir/data/leads.db"
