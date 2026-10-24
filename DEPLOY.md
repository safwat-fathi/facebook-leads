# Deploying to your VPS

Direct host deployment, no Docker: the Next.js app runs under **pm2** (the same way as now-focus) on `127.0.0.1:3100`, and **nginx** terminates HTTPS (certbot) and proxies to it. Only nginx is reachable from outside.

## Before you start
- A VPS with Node.js 22.19+, pnpm, pm2, nginx and certbot (the now-focus box already has them; check with `node -v`, since `node:sqlite` needs 22.19+).
- Ports 22/80/443 open. Port 3100 stays closed to the outside.
- DNS: `fbleads.tijaratk.com` is an **A record in Cloudflare** pointing at the VPS (75.119.144.29), proxied (orange cloud). After certbot runs, set Cloudflare SSL/TLS mode to **Full** (not Flexible, which causes a redirect loop). Cloudflare only proxies HTTP(S): SSH and `DEPLOY_HOST` must use the VPS IP, never `fbleads.tijaratk.com`. nginx needs real-client-IP handling for Cloudflare (see the comment in `deploy/leads.conf`).

## First deploy
```sh
git clone https://github.com/safwat-fathi/facebook-leads.git /opt/leads && cd /opt/leads
pnpm install --frozen-lockfile
cp .env.example .env

# 1. create the login key (shown once; save it in a password manager)
pnpm run gen-key
# 2. edit .env: APP_ORIGIN (https://fbleads.tijaratk.com), the two values printed above, APIFY_TOKEN, OPENROUTER_API_KEY, limits
nano .env

# 3. optional, BEFORE the first start: bring your existing leads (see "Importing your existing leads" below)

# 4. build and start under pm2 (survives reboots after `pm2 startup`, which you only run once per VPS)
pnpm build
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs leads --lines 30 --nostream

# 5. nginx vhost + certificate (server_name is already fbleads.tijaratk.com)
sudo cp deploy/leads.conf /etc/nginx/sites-available/leads
sudo ln -s /etc/nginx/sites-available/leads /etc/nginx/sites-enabled/leads
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d fbleads.tijaratk.com
```
Open `https://fbleads.tijaratk.com` and sign in with the key. If the repo is private, the VPS needs read access to clone it (a read-only GitHub deploy key, or a token in the remote URL).

## First-deploy checklist (nothing here can be tested from a laptop)
- [ ] `https://fbleads.tijaratk.com` loads without a certificate warning, and `http://fbleads.tijaratk.com` redirects to https.
- [ ] `curl -sI https://fbleads.tijaratk.com/login` shows `strict-transport-security`, `content-security-policy` (with a `nonce-`) and `x-frame-options: DENY`.
- [ ] A wrong key gives "Invalid API key"; the right key signs you in; **Sign out** returns you to the login page.
- [ ] `curl -m 5 http://<vps-ip>:3100/` from another machine **fails** (the app port must not be published).
- [ ] Jobs page shows the daily limit. Run a small check first: Leads, filter to one page, **Check websites**, tick "check again", Start. A listed site costs $0.
- [ ] `pm2 restart leads --update-env` again: your data and pages are still there (they live in `DATA_DIR`, default `./data`).
- [ ] Run a backup (below) and confirm the file exists.

## Importing your existing leads
The database may have `-wal`/`-shm` side files, so do not copy the bare `.db`. Make one self-contained snapshot, then copy it over:
```sh
# on your laptop, from the project root:
DATA_DIR=./data node scripts/backup.mjs ./export          # writes ./export/leads-YYYY-MM-DD.db
ssh safwat@server mkdir -p /opt/leads/data
scp ./export/leads-*.db safwat@server:/opt/leads/data/leads.db
```
Run it before the first `pm2 start`, as the same user that runs pm2, so the file is writable by the app.

## Backups
```sh
node scripts/backup.mjs /opt/leads/backups     # run from /opt/leads; keeps the 14 newest, safe while the app is running
```
Nightly cron job:
```
0 3 * * * cd /opt/leads && /usr/bin/node scripts/backup.mjs /opt/leads/backups
```
The database holds sole traders' phone numbers and emails: keep the backups private and the VPS disk encrypted if you can.

## Updating
```sh
git pull && pnpm install --frozen-lockfile && pnpm build && pm2 restart leads --update-env
```

## Auto-deploy from GitHub Actions
Every push to `main` runs typecheck + tests, then `deploy` SSHes to the VPS and runs `deploy/release.sh <sha>` (git fast-forward, `pnpm install --frozen-lockfile`, `pnpm build`, `pm2 startOrRestart`, then it waits for `/login` to answer). The deploy key can run that script and nothing else. `.env` and the data directory are never touched. One-time setup:

1. Laptop: `ssh-keygen -t ed25519 -N '' -C leads-deploy -f ~/leads-deploy`
2. VPS: finish "First deploy" above (clone to `/opt/leads`, `.env`, `pm2 start` done once; no sudo needed for later releases). Check that `ssh <host> 'command -v node pnpm pm2'` works from your laptop (same minimal PATH as CI; extend the `PATH` line in `release.sh` if not). Then append to `~/.ssh/authorized_keys`:
   `restrict,command="/opt/leads/deploy/release.sh" <contents of leads-deploy.pub>`
3. Laptop, from the project root:
   ```sh
   gh secret set DEPLOY_SSH_KEY < ~/leads-deploy && rm ~/leads-deploy ~/leads-deploy.pub
   gh secret set DEPLOY_HOST --body "<vps hostname or ip>"          # bare host: no user@, no port
   ssh-keyscan -t ed25519 <vps hostname or ip> | gh secret set DEPLOY_KNOWN_HOSTS
   gh secret list
   ```
The workflow logs in as `safwat`; change the user in `.github/workflows/deploy.yml` if your VPS user differs. By hand, same script: `deploy/release.sh <full sha>` on the VPS.

## Rotating the key
```sh
node scripts/gen-key.mjs   # new key + hash
# put the new APP_API_KEY_HASH in .env, then:
pm2 restart leads --update-env                                 # the old key stops working immediately
```
Changing `SESSION_SECRET` signs everyone out without changing the key.

## Local development
```sh
pnpm install
cp .env.example .env.local        # APP_ORIGIN=http://localhost:3000; run `pnpm run gen-key` and paste the two values
mkdir -p data
pnpm dev                          # http://localhost:3000
pnpm test                         # unit + integration tests
pnpm build && pnpm run check:server   # security checks against the production build
```

## Spending
Every search costs real money (Apify, OpenRouter). Each job has a budget; no job may exceed `MAX_JOB_USD` and all jobs together stay under `DAILY_BUDGET_USD` per rolling 24 hours. The Jobs page shows what was spent. The amounts come from Apify and OpenRouter themselves, not from estimates.
