# Deploying to your VPS

Two containers: the app, and Caddy (HTTPS certificates, reverse proxy). Only Caddy is reachable from outside.

## Before you start
- A VPS with Docker and the Compose plugin, ports 22/80/443 open (`ufw allow 22,80,443/tcp && ufw enable`).
- A domain whose **A record** points at the VPS (Caddy needs this to get a certificate).

## First deploy
```sh
git clone <your repo> /opt/leads && cd /opt/leads
cp .env.example .env
docker compose build

# 1. create the login key (shown once; save it in a password manager)
docker compose run --rm app node scripts/gen-key.mjs
# 2. edit .env: APP_ORIGIN, APP_DOMAIN, the two values printed above, APIFY_TOKEN, OPENROUTER_API_KEY, limits
nano .env

# 3. optional, BEFORE the first "up": bring your existing leads along (see "Importing your existing leads" below)

docker compose up -d
docker compose logs -f
```
Open `https://<your domain>` and sign in with the key.

## First-deploy checklist (nothing here can be tested from a laptop)
- [ ] `https://<domain>` loads without a certificate warning, and `http://<domain>` redirects to https.
- [ ] `curl -sI https://<domain>/login` shows `strict-transport-security`, `content-security-policy` (with a `nonce-`) and `x-frame-options: DENY`.
- [ ] A wrong key gives "Invalid API key"; the right key signs you in; **Sign out** returns you to the login page.
- [ ] `curl -m 5 http://<vps-ip>:3000/` from another machine **fails** (the app port must not be published).
- [ ] Jobs page shows the daily limit. Run a small check first: Leads, filter to one page, **Check websites**, tick "check again", Start. A listed site costs $0.
- [ ] `docker compose up -d --build` again: your data and pages are still there (they live in the `leads-data` volume).
- [ ] Run a backup (below) and confirm the file exists.

## Importing your existing leads (untested here, like the rest of the Docker setup)
The database may have `-wal`/`-shm` side files, so do not copy the bare `.db`. Make one self-contained snapshot, then copy it in **as the app user**. A file copied in as root would be unwritable by the app, and `chown` is not available because the container drops all capabilities.
```sh
# on your laptop, from the project root:
DATA_DIR=./data node scripts/backup.mjs ./export          # writes ./export/leads-YYYY-MM-DD.db
scp ./export/leads-*.db you@server:/opt/leads/leads-import.db

# on the server, before the first "docker compose up":
docker compose run --rm -v "$PWD/leads-import.db:/import/leads.db:ro" app \
  sh -c 'if [ -e /data/leads.db ]; then echo "refusing to overwrite /data/leads.db"; exit 1; fi; cp /import/leads.db /data/leads.db && ls -l /data/leads.db'
rm leads-import.db
```
The listing should show the file owned by `app`.

## Backups
```sh
docker compose exec -T app node scripts/backup.mjs /data/backups     # keeps the 14 newest, safe while the app is running
```
Nightly, plus copy them off the server (the volume lives on the same disk):
```
0 3 * * * cd /opt/leads && docker compose exec -T app node scripts/backup.mjs /data/backups
```
The database holds sole traders' phone numbers and emails: keep the backups private and the VPS disk encrypted if you can.

## Updating
```sh
git pull && docker compose up -d --build
```

## Rotating the key
```sh
docker compose run --rm app node scripts/gen-key.mjs   # new key + hash
# put the new APP_API_KEY_HASH in .env, then:
docker compose up -d                                   # the old key stops working immediately
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
